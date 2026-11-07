import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { Violation } from '../kernel/errors.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { findCycle } from '../validation/engine.ts';

export interface Port {
  name: string;
  type: string;
  optional?: boolean;
  contextProvided?: boolean;
  terminal?: boolean;
}

export interface Binding {
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
  contract: string;
  contextConditions: string[];
  failurePolicy: 'fail' | 'degrade' | 'retry' | 'compensate';
}

export interface CompositionInput {
  label: string;
  intent: string;
  scope?: string;
  capabilities: string[];
  compositions?: string[];
  contextBounds?: Record<string, Record<string, unknown>>;
  policies?: string[];
  failurePolicy?: Binding['failurePolicy'];
  namespace?: string;
  bindingsOverride?: Binding[];
}

/**
 * Universal Composition Engine (Phase 008). A system is a certified
 * composition of registered capabilities: no application logic exists for
 * any named system (UCL-C01). Wiring is derived from registered contracts,
 * the binding graph must be a DAG (CM-P5), and the policy envelope is the
 * strictest of its parts (CM-P4), owned by an authority other than the
 * capability providers (Phase 008 §9).
 */
export class CompositionEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Capability', (e) => this.validateCapability(e));
    this.p.validation.registerKind('CapabilityContract', (e) => this.validatePorts((e.content.inputs as Port[]) ?? [], (e.content.outputs as Port[]) ?? []));
    this.p.lifecycles.addFactProvider((entry) => (entry.kind === 'Composition' ? { compositionValid: this.check(entry).length === 0, revalidationRequired: true } : {}));
    this.p.fabric.hooks.onStatusChange.push((entry, _from, to) => {
      if (entry.kind === 'Capability' && (to === 'PROPOSED' || to === 'DEPRECATED' || to === 'RETIRED')) this.cascadeCapability(entry.canonicalId, to);
    });
  }

  private validateCapability(e: Entry): Violation[] {
    const out: Violation[] = [];
    if (!e.content.purpose) out.push({ rule: 'C-12', message: 'a capability states its purpose' });
    out.push(...this.validatePorts((e.content.inputs as Port[]) ?? [], (e.content.outputs as Port[]) ?? []));
    for (const dep of (e.content.dependencies as string[]) ?? []) if (!this.p.fabric.exists(dep)) out.push({ rule: 'V-CB-01', message: `dependency ${dep} is not a registered capability` });
    for (const ev of (e.content.events as string[]) ?? []) if (!/^[a-z]+(\.[a-z0-9-]+)+$/.test(ev)) out.push({ rule: 'V-CB-02', message: `event ${ev} is not a registered event type name` });
    return out;
  }

  private validatePorts(inputs: Port[], outputs: Port[]): Violation[] {
    const out: Violation[] = [];
    for (const port of [...inputs, ...outputs]) {
      if (/^(string|int|integer|number|float|boolean|text|json)$/i.test(port.type)) out.push({ rule: 'V-CB-03', message: `port ${port.name} is typed by storage type ${port.type}` });
      else if (!this.typeKnown(port.type)) out.push({ rule: 'V-CB-03', message: `port ${port.name} type ${port.type} is not a registered construct` });
    }
    return out;
  }

  private typeKnown(type: string): boolean {
    return !!this.p.ontology.lookup(type) || this.p.fabric.registryDefinitions().some((r) => r.envelope.kinds.includes(type));
  }

  capabilityByName(name: string): Entry {
    const row = this.p.store.headByQualifiedName(`UCOS:Capability:${name}`);
    const e = row ? (JSON.parse(row.body) as Entry) : this.p.fabric.tryResolve(name)?.entry;
    if (!e || e.kind !== 'Capability') throw new ConstitutionalError('V-CM-01', `capability ${name} is not registered`);
    return e;
  }

  // ── composition pipeline ────────────────────────────────────────────────

  /** COMPOSE(intent, constraints, context) → candidate composition (DRAFT) or refusal. */
  compose(input: CompositionInput, actor: Actor): Entry {
    return this.p.store.tx(() => {
      const ctx = this.p.context.forPurpose('composition', input.contextBounds, actor);
      this.p.policy.enforce({ action: 'composition.compose', actor, context: ctx });
      const nested = (input.compositions ?? []).map((c) => this.p.fabric.resolve(c).entry);
      for (const n of nested) if (n.kind !== 'Composition') throw new ConstitutionalError('CM-P7', `${n.canonicalId} is not a composition`);
      const directCaps = input.capabilities.map((c) => this.capabilityByName(c));
      const nestedCaps = nested.flatMap((n) => this.allCapabilities(n).map((id) => this.p.fabric.require(id)));
      const caps = [...new Map([...directCaps, ...nestedCaps].map((c) => [c.canonicalId, c])).values()];
      const bindings = input.bindingsOverride ?? this.wire(caps, input.failurePolicy ?? 'fail');
      const envelope = this.envelope(caps, input.policies ?? [], actor.authority);
      const comp = this.p.fabric.submit(
        {
          kind: 'Composition',
          namespace: input.namespace ?? 'UCOS',
          name: input.label,
          statement: input.intent,
          ownerOverride: actor.authority,
          content: {
            label: input.label,
            intent: input.intent,
            scope: input.scope ?? input.intent,
            capabilities: directCaps.map((c) => c.canonicalId),
            capabilityNames: directCaps.map((c) => c.definition.canonicalName),
            compositions: nested.map((n) => n.canonicalId),
            bindings,
            policyEnvelope: envelope,
            contextBounds: input.contextBounds ?? {},
            events: [...new Set(caps.flatMap((c) => (c.content.events as string[]) ?? []))],
            deploymentContract: null,
            context: ctx.record,
          },
          provenance: { source: 'composition-engine' },
          relationships: [...directCaps.map((c) => ({ type: 'BINDS', target: c.canonicalId })), ...nested.map((n) => ({ type: 'DEPENDS-ON', target: n.canonicalId })), ...(input.policies ?? []).map((pol) => ({ type: 'GOVERNED-BY', target: pol }))],
        },
        actor,
      );
      this.p.bus.emit({ type: 'cmp.intent.resolved', subject: comp.canonicalId, actor, payload: { capabilities: caps.length, bindings: bindings.length }, context: ctx.record });
      this.p.bus.emit({ type: 'cmp.envelope.computed', subject: comp.canonicalId, actor, payload: envelope, context: ctx.record });
      return comp;
    });
  }

  /** Every capability of a composition, including nested compositions (CM-P7). */
  allCapabilities(comp: Entry, seen = new Set<string>()): string[] {
    if (seen.has(comp.canonicalId)) throw new ConstitutionalError('UCI-014', `composition recursion cycle at ${comp.canonicalId}`);
    seen.add(comp.canonicalId);
    const own = (comp.content.capabilities as string[]) ?? [];
    const nested = ((comp.content.compositions as string[]) ?? []).flatMap((n) => this.allCapabilities(this.p.fabric.require(n), new Set(seen)));
    return [...new Set([...own, ...nested])];
  }

  /**
   * Derives bindings from contracts: each input port is bound to a producing
   * capability of the same type, choosing a producer that keeps the graph
   * acyclic; ports with no producer remain for validation to judge.
   */
  wire(caps: Entry[], failurePolicy: Binding['failurePolicy']): Binding[] {
    const bindings: Binding[] = [];
    const adj = new Map<string, Set<string>>();
    const reaches = (from: string, to: string): boolean => {
      const stack = [from];
      const seen = new Set<string>();
      while (stack.length) {
        const n = stack.pop()!;
        if (n === to) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        stack.push(...(adj.get(n) ?? []));
      }
      return false;
    };
    for (const consumer of caps) {
      for (const input of (consumer.content.inputs as Port[]) ?? []) {
        const producers = caps.filter((c) => c.canonicalId !== consumer.canonicalId && ((c.content.outputs as Port[]) ?? []).some((o) => o.type === input.type));
        const producer = producers.find((pr) => !reaches(consumer.canonicalId, pr.canonicalId));
        if (!producer) continue;
        const port = ((producer.content.outputs as Port[]) ?? []).find((o) => o.type === input.type)!;
        bindings.push({ source: producer.canonicalId, sourcePort: port.name, target: consumer.canonicalId, targetPort: input.name, contract: String(consumer.content.contract ?? ''), contextConditions: [], failurePolicy });
        if (!adj.has(producer.canonicalId)) adj.set(producer.canonicalId, new Set());
        adj.get(producer.canonicalId)!.add(consumer.canonicalId);
      }
    }
    return bindings;
  }

  /** CM-P4: the whole is governed at least as strictly as its strictest part. */
  envelope(caps: Entry[], compositionPolicies: string[], owner: string): { owner: string; providers: string[]; policies: string[]; securityLevel: string; autonomyCeiling: string } {
    const order = ['PUBLIC', 'INTEGRITY-FIRST', 'PROTECTED', 'CONFIDENTIAL', 'RESTRICTED', 'MAXIMAL'];
    const levels = caps.map((c) => c.securityPosture.level);
    const strictest = levels.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a), 'PUBLIC');
    const autonomy = ['escalation-only', 'advisory', 'supervised', 'conditional-autonomous', 'autonomous'];
    const ceilings = caps.map((c) => String(c.content.autonomyCeiling ?? 'autonomous'));
    const ceiling = ceilings.reduce((a, b) => (autonomy.indexOf(b) < autonomy.indexOf(a) ? b : a), 'autonomous');
    return {
      owner,
      providers: [...new Set(caps.map((c) => c.ownership.canonicalOwner))],
      policies: [...new Set([...caps.flatMap((c) => (c.content.policies as string[]) ?? []), ...compositionPolicies])],
      securityLevel: strictest,
      autonomyCeiling: ceiling,
    };
  }

  /** V-CM-01..10. */
  check(comp: Entry): Violation[] {
    const out: Violation[] = [];
    const c = comp.content as Record<string, unknown>;
    let capIds: string[] = [];
    try {
      capIds = this.allCapabilities(comp);
    } catch (e) {
      out.push({ rule: 'V-CM-03', message: (e as Error).message });
      return out;
    }
    const caps = capIds.map((id) => this.p.fabric.get(id)).filter((x): x is Entry => !!x);
    for (const cap of caps) if (!['CERTIFIED', 'ADMISSIBLE'].includes(cap.lifecycle.status)) out.push({ rule: 'V-CM-01', message: `capability ${cap.definition.canonicalName} is ${cap.lifecycle.status}, not certified` });
    const bindings = (c.bindings as Binding[]) ?? [];
    for (const b of bindings) {
      if (!capIds.includes(b.source) || !capIds.includes(b.target)) out.push({ rule: 'V-CM-02', message: `binding ${b.source}→${b.target} references a capability outside the composition` });
      if (!b.failurePolicy) out.push({ rule: 'V-CM-08', message: `binding ${b.sourcePort}→${b.targetPort} declares no failure policy` });
      const src = caps.find((x) => x.canonicalId === b.source);
      const tgt = caps.find((x) => x.canonicalId === b.target);
      const outPort = ((src?.content.outputs as Port[]) ?? []).find((pt) => pt.name === b.sourcePort);
      const inPort = ((tgt?.content.inputs as Port[]) ?? []).find((pt) => pt.name === b.targetPort);
      if (!outPort || !inPort) out.push({ rule: 'V-CM-02', message: `binding ${b.sourcePort}→${b.targetPort} names ports absent from the contracts` });
      else if (outPort.type !== inPort.type) out.push({ rule: 'V-CM-02', message: `contract incompatibility: ${outPort.type} → ${inPort.type}` });
    }
    const cycle = findCycle(bindings.map((b) => [b.source, b.target] as [string, string]));
    if (cycle) {
      out.push({ rule: 'V-CM-03', message: `binding cycle: ${cycle.map((id) => this.p.fabric.get(id)?.definition.canonicalName ?? id).join(' → ')}` });
      this.p.bus.emit({ type: 'cmp.cycle.detected', subject: comp.canonicalId, actor: this.p.systemActor(), payload: { cycle } });
    }
    for (const cap of caps) {
      for (const input of (cap.content.inputs as Port[]) ?? []) {
        const bound = bindings.some((b) => b.target === cap.canonicalId && b.targetPort === input.name);
        if (!bound && !input.optional && !input.contextProvided) {
          out.push({ rule: 'V-CM-04', message: `orphan input port ${cap.definition.canonicalName}.${input.name} (${input.type}) — no producer, not context-provided, not optional` });
          this.p.bus.emit({ type: 'cmp.orphan.port.detected', subject: comp.canonicalId, actor: this.p.systemActor(), payload: { capability: cap.canonicalId, port: input.name } });
        }
      }
      for (const output of (cap.content.outputs as Port[]) ?? []) {
        const consumed = bindings.some((b) => b.source === cap.canonicalId && b.sourcePort === output.name);
        if (!consumed && !output.terminal) out.push({ rule: 'V-CM-05', message: `orphan output port ${cap.definition.canonicalName}.${output.name} (${output.type}) — not consumed and not declared terminal` });
      }
    }
    const env = c.policyEnvelope as { owner: string; providers: string[]; policies: string[] } | undefined;
    if (!env) out.push({ rule: 'V-CM-06', message: 'no policy envelope computed' });
    else {
      const required = new Set(caps.flatMap((x) => (x.content.policies as string[]) ?? []));
      for (const r of required) if (!env.policies.includes(r)) out.push({ rule: 'V-CM-06', message: `envelope omits part policy ${r} (strictest-of-parts)` });
      if (env.providers.includes(env.owner)) out.push({ rule: 'Phase008-§9', message: `envelope owner ${env.owner} is also a capability provider; no provider may govern a system it supplies` });
    }
    try {
      this.p.context.forPurpose('composition', (c.contextBounds as Record<string, Record<string, unknown>>) ?? {}, this.p.systemActor());
    } catch (e) {
      out.push({ rule: 'V-CM-07', message: `context bounds unresolvable: ${(e as Error).message}` });
    }
    const hits = this.p.ontology.prohibitedTerms(String(c.intent ?? ''));
    if (hits.length) out.push({ rule: 'V-CM-09', message: `intent contains ${hits.map((h) => `${h.cls} noun "${h.term}"`).join(', ')}` });
    if (JSON.stringify(c).match(/function\s*\(|=>\s*\{|\beval\(/)) out.push({ rule: 'V-CM-10', message: 'imperative code appears in the composition' });
    return out;
  }

  validate(compRef: string, actor: Actor): { composition: Entry; violations: Violation[] } {
    const comp = this.p.fabric.resolve(compRef).entry;
    const ctx = this.p.context.forPurpose('composition', (comp.content.contextBounds as Record<string, Record<string, unknown>>) ?? {}, actor);
    this.p.policy.enforce({ action: 'composition.validate', subject: comp, actor, context: ctx });
    const violations = this.check(comp);
    for (const b of (comp.content.bindings as Binding[]) ?? []) this.p.bus.emit({ type: violations.length ? 'cmp.binding.rejected' : 'cmp.binding.validated', subject: comp.canonicalId, actor, payload: { source: b.source, target: b.target, port: b.targetPort } });
    if (violations.length) return { composition: comp, violations };
    const next = comp.lifecycle.status === 'DRAFT' ? this.p.fabric.transition(comp.canonicalId, 'VALIDATED', actor, {}, (e) => (e.evidence.validation = { at: this.p.clock.now(), passed: true, rules: ['V-CM-01..10'], violations: [] })) : comp;
    return { composition: next, violations };
  }

  certify(compRef: string, certifier: Actor): Entry {
    const comp = this.p.fabric.resolve(compRef).entry;
    const ctx = this.p.context.forPurpose('composition', (comp.content.contextBounds as Record<string, Record<string, unknown>>) ?? {}, certifier);
    this.p.policy.enforce({ action: 'composition.certify', subject: comp, actor: certifier, context: ctx });
    const out = this.p.fabric.certify(comp.canonicalId, certifier, 'COMPOSITION', `envelope+context: ${JSON.stringify(comp.content.contextBounds ?? {})}`);
    this.p.bus.emit({ type: 'cmp.composition.certified', subject: comp.canonicalId, actor: certifier, payload: { capabilities: (comp.content.capabilities as string[]).length } });
    return out;
  }

  /** INSTANTIATE: selects a deployment contract and requests generation for each target. */
  instantiate(compRef: string, deployment: { targets: { generator: string; variant?: string }[]; channels?: Record<string, string>; region?: string }, actor: Actor): { composition: Entry; artifacts: Entry[] } {
    return this.p.store.tx(() => {
      const comp = this.p.fabric.resolve(compRef).entry;
      if (!['CERTIFIED', 'INSTANTIATED'].includes(comp.lifecycle.status)) throw new ConstitutionalError('Phase008-§8', `composition is ${comp.lifecycle.status}; only certified compositions may be instantiated`);
      const ctx = this.p.context.forPurpose('generation', { Linguistic: { locale: this.p.cfg.platform.defaultLocale } }, actor);
      this.p.policy.enforce({ action: 'composition.instantiate', subject: comp, actor, context: ctx });
      const artifacts = deployment.targets.map((t) => this.p.generation.generate({ subject: comp.canonicalId, generator: t.generator, variant: t.variant }, actor, ctx));
      const updated = this.p.fabric.transition(comp.canonicalId, 'INSTANTIATED', actor, { deploymentContract: deployment }, (e) => {
        e.content.deploymentContract = { ...deployment, artifacts: artifacts.map((a) => a.canonicalId), at: this.p.clock.now() };
      }, 'cmp.composition.instantiated');
      return { composition: updated, artifacts };
    });
  }

  /** SUSPEND: actions blocked, events continue (CM-S-05). */
  suspend(compRef: string, cause: string, actor: Actor): Entry {
    const comp = this.p.fabric.resolve(compRef).entry;
    return this.p.fabric.transition(comp.canonicalId, 'SUSPENDED', actor, { cause }, (e) => {
      e.content.suspension = { cause, at: this.p.clock.now(), by: actor.principal };
    }, 'cmp.composition.suspended');
  }

  resume(compRef: string, cause: string, actor: Actor): Entry {
    const comp = this.p.fabric.resolve(compRef).entry;
    return this.p.fabric.transition(comp.canonicalId, 'CERTIFIED', actor, { cause }, (e) => {
      e.content.suspension = null;
    }, 'cmp.composition.resumed');
  }

  /** E-CM-05 / X-CM-03: a capability's evolution re-validates every binding composition, computed. */
  private cascadeCapability(capabilityId: string, to: string): void {
    const actor = this.p.systemActor();
    for (const edge of this.p.store.edgesTo(capabilityId, 'BINDS')) {
      const comp = this.p.fabric.get(edge.source);
      if (!comp || !['VALIDATED', 'CERTIFIED', 'INSTANTIATED'].includes(comp.lifecycle.status)) continue;
      const violations = this.check(comp);
      this.p.bus.emit({ type: 'cmp.binding.revalidated', subject: comp.canonicalId, actor, payload: { capability: capabilityId, capabilityStatus: to, violations } });
      if (violations.length && comp.lifecycle.status !== 'INSTANTIATED') this.p.fabric.transition(comp.canonicalId, 'DRAFT', actor, { revalidationRequired: true });
    }
  }

  /** DISCOVER-CAPABILITIES(need, context) → ranked certified candidates (D-CM-03). */
  discoverCapabilities(need: string, limit = 10): { capability: string; name: string; purpose: string; score: number }[] {
    return this.p.discovery
      .search(need, { kinds: ['Capability'], limit })
      .results.filter((r) => ['CERTIFIED', 'ADMISSIBLE'].includes(r.status))
      .map((r) => ({ capability: r.id, name: r.name, purpose: String(this.p.fabric.require(r.id).content.purpose ?? ''), score: r.score }));
  }
}
