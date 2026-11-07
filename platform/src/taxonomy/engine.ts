import type { Platform } from '../platform.ts';
import type { Entry } from '../registry/types.ts';
import type { Actor } from '../kernel/events.ts';
import type { Violation } from '../kernel/errors.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { evaluateBoolean, isExpression, referencedPaths, type ExprFunction } from '../rules/expression.ts';
import type { ResolvedContext } from '../context/engine.ts';

export interface ClassificationVerdict {
  taxon: string;
  taxonName: string;
  scheme: string;
  admitted: boolean;
  depth: number;
  reason: string;
}

export interface ClassificationResult {
  entity: string;
  verdicts: ClassificationVerdict[];
  assertions: Entry[];
  refused: { taxon: string; reason: string }[];
  attachedPolicies: string[];
}

/**
 * Universal Taxonomy Engine (Phase 005). The engine defines no category: it
 * evaluates registered admission rules over registered attributes, and
 * records classification as an owned, evidenced, context-qualified
 * relationship (TX-P2, TX-P4). Classification attaches the taxon's policies;
 * withdrawal cascades their re-evaluation (TX-G3).
 */
export class TaxonomyEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Taxon', (e) => this.validateTaxon(e));
    this.p.validation.registerKind('TaxonomyScheme', (e) => (e.content.purpose ? [] : [{ rule: 'TX-P5', message: 'a taxonomy scheme states why it exists (purpose)' }]));
    this.p.validation.registerKind('Classification', (e) => this.validateAssertion(e));
  }

  private validateTaxon(e: Entry): Violation[] {
    const out: Violation[] = [];
    const c = e.content as Record<string, unknown>;
    if (!c.scheme) out.push({ rule: 'TX-P5', message: 'a taxon belongs to a registered scheme' });
    else if (!this.p.fabric.exists(String(c.scheme))) out.push({ rule: 'V-TX-01', message: `scheme ${String(c.scheme)} is not registered` });
    const rule = c.admissionRule as string | undefined;
    if (rule) {
      const ok = isExpression(rule);
      if (!ok.ok) out.push({ rule: 'V-TX-01', message: `admission rule is not a registered rule expression: ${ok.error}` });
    }
    for (const a of (c.attributes as string[]) ?? []) if (!this.attributeKnown(a)) out.push({ rule: 'V-TX-02', message: `mandated attribute ${a} is not a registered Attribute` });
    for (const pol of (c.policies as string[]) ?? []) if (!this.p.fabric.exists(pol)) out.push({ rule: 'V-TX-03', message: `attached policy ${pol} is not registered` });
    const labels = e.labels ?? {};
    if (Object.keys(labels).length === 0) out.push({ rule: 'V-TX-06', message: 'a taxon label is a per-locale map on the artifact, never a bare literal' });
    if (c.scheme && e.lifecycle.status === 'DRAFT') {
      const key = e.definition.canonicalName.toLowerCase();
      const siblings = this.p.fabric.store.prepare("SELECT canonical_id FROM heads WHERE kind = 'Taxon' AND json_extract(body, '$.content.scheme') = ? AND lower(canonical_name) = ? AND canonical_id <> ?").all(String(c.scheme), key, e.canonicalId);
      if (siblings.length) out.push({ rule: 'V-TX-07', message: `taxon "${e.definition.canonicalName}" duplicates a sibling in its scheme` });
    }
    return out;
  }

  private attributeKnown(ref: string): boolean {
    return this.p.fabric.exists(ref) || this.p.fabric.query({ kind: ['Attribute', 'Facet'], nameLike: ref, limit: 1 }).total > 0;
  }

  private validateAssertion(e: Entry): Violation[] {
    const c = e.content as Record<string, unknown>;
    const out: Violation[] = [];
    if (!c.assertedBy) out.push({ rule: 'TX-G1', message: 'classification requires an accountable authority' });
    if (!c.assertedAt) out.push({ rule: 'UCI-007', message: 'classification requires temporal context' });
    if (!c.context) out.push({ rule: 'TX-P4', message: 'classification must be context-qualified' });
    if (!c.evidence) out.push({ rule: 'TX-G2', message: 'classification requires evidence' });
    return out;
  }

  // ── reading ─────────────────────────────────────────────────────────────

  schemes(): Entry[] {
    return this.p.fabric.query({ kind: 'TaxonomyScheme', limit: 10_000 }).entries;
  }

  taxaOf(schemeId: string): Entry[] {
    const scheme = this.p.fabric.resolve(schemeId).entry.canonicalId;
    return this.p.fabric.query({ kind: 'Taxon', contentPath: 'scheme', contentEquals: scheme, limit: 100_000 }).entries;
  }

  children(taxonId: string): string[] {
    return this.p.store.edgesTo(taxonId, 'NARROWER-THAN').map((e) => e.source);
  }

  parents(taxonId: string): string[] {
    return this.p.store.edgesFrom(taxonId, 'NARROWER-THAN').map((e) => e.target);
  }

  depth(taxonId: string): number {
    const ps = this.parents(taxonId);
    return ps.length === 0 ? 0 : 1 + Math.max(...ps.map((x) => this.depth(x)));
  }

  /** Scheme as a tree (childTaxa computed, V-TX-05). */
  tree(schemeId: string): { id: string; name: string; label: string; children: unknown[] }[] {
    const taxa = this.taxaOf(schemeId);
    const ids = new Set(taxa.map((t) => t.canonicalId));
    const locale = this.p.cfg.platform.defaultLocale;
    const build = (t: Entry): { id: string; name: string; label: string; children: unknown[] } => ({
      id: t.canonicalId,
      name: t.definition.canonicalName,
      label: t.labels[locale] ?? t.definition.canonicalName,
      children: this.children(t.canonicalId)
        .filter((c) => ids.has(c))
        .map((c) => build(this.p.fabric.require(c))),
    });
    return taxa.filter((t) => this.parents(t.canonicalId).filter((x) => ids.has(x)).length === 0).map(build);
  }

  /** RESOLVE-TAXON by id, alias, name or locale label (D-TX-01). */
  resolveTaxon(ref: string, locale?: string): Entry {
    const direct = this.p.fabric.tryResolve(ref);
    if (direct && direct.entry.kind === 'Taxon') return direct.entry;
    const lower = ref.toLowerCase();
    const loc = locale ?? this.p.cfg.platform.defaultLocale;
    for (const t of this.p.fabric.iterate('Taxon')) {
      if (t.definition.canonicalName.toLowerCase() === lower) return t;
      if ((t.labels[loc] ?? '').toLowerCase() === lower) return t;
      if (t.identity.aliases.some((a) => a.toLowerCase() === lower)) return t;
    }
    throw new ConstitutionalError('D-TX-01', `taxon ${ref} does not resolve`);
  }

  // ── classification ──────────────────────────────────────────────────────

  /** Evaluation scope over an entity: its attributes, facets and relationship counts. */
  scopeFor(entity: Entry, context?: ResolvedContext): { scope: Record<string, unknown>; functions: Record<string, ExprFunction> } {
    const content = entity.content as Record<string, unknown>;
    const facets = this.p.commerce.facetScope((content.facetBindings as Record<string, string>) ?? {});
    const attributes = (content.attributes as Record<string, unknown>) ?? {};
    const scope: Record<string, unknown> = {
      ...content,
      ...attributes,
      ...facets,
      facets,
      attributes,
      kind: entity.kind,
      name: entity.definition.canonicalName,
      status: entity.lifecycle.status,
      namespace: entity.classification.namespace,
      context: context?.bindings ?? {},
    };
    const store = this.p.store;
    const functions: Record<string, ExprFunction> = {
      rel: ([type]) => store.edgesFrom(entity.canonicalId, this.p.fabric.forwardOf(String(type)).type).map((e) => e.target),
      relCount: ([type]) => store.edgesFrom(entity.canonicalId, this.p.fabric.forwardOf(String(type)).type).length,
      hasRole: ([taxon]) => this.effectiveAssertions(entity.canonicalId).some((a) => a.content.taxonName === taxon || a.content.taxon === taxon),
      isKind: ([k]) => entity.kind === k,
    };
    return { scope, functions };
  }

  /**
   * CLASSIFY (Phase 005 §6): scheme select → candidate rank (deepest first)
   * → validate admission rule → context filter → assert, or refuse with the
   * reasons recorded.
   */
  classify(
    entityRef: string,
    actor: Actor,
    options: { schemes?: string[]; context?: ResolvedContext; inferred?: boolean; confidence?: number; evidence?: unknown; taxa?: string[] } = {},
  ): ClassificationResult {
    const entity = this.p.fabric.resolve(entityRef).entry;
    const context = options.context ?? this.p.context.resolve({ purpose: 'classification', contributions: [] }, actor);
    const schemeIds = options.schemes?.map((s) => this.p.fabric.resolve(s).entry.canonicalId) ?? this.schemesInScope(entity);
    const { scope, functions } = this.scopeFor(entity, context);
    const verdicts: ClassificationVerdict[] = [];
    const candidates: Entry[] = [];
    for (const sid of schemeIds) {
      for (const taxon of this.taxaOf(sid)) {
        if (!['CERTIFIED', 'ADMISSIBLE'].includes(taxon.lifecycle.status)) continue;
        if (options.taxa && !options.taxa.some((t) => t === taxon.canonicalId || t === taxon.definition.canonicalName)) continue;
        const rule = taxon.content.admissionRule as string | undefined;
        const depth = this.depth(taxon.canonicalId);
        if (!rule) {
          verdicts.push({ taxon: taxon.canonicalId, taxonName: taxon.definition.canonicalName, scheme: sid, admitted: false, depth, reason: 'no admission rule; placement requires explicit assertion' });
          if (options.taxa) candidates.push(taxon);
          continue;
        }
        let admitted = false;
        let reason = '';
        try {
          admitted = evaluateBoolean(rule, { scope, functions });
          reason = admitted ? `admission rule holds: ${rule}` : `admission rule does not hold: ${rule}`;
        } catch (err) {
          reason = `admission rule unevaluable: ${(err as Error).message}`;
        }
        if (admitted) {
          for (const cond of (taxon.content.contextConditions as string[]) ?? []) {
            if (!evaluateBoolean(cond, { scope: { ...context.bindings, context: context.bindings } })) {
              admitted = false;
              reason = `context filter excludes: ${cond} (C-TX-03)`;
            }
          }
        }
        verdicts.push({ taxon: taxon.canonicalId, taxonName: taxon.definition.canonicalName, scheme: sid, admitted, depth, reason });
        if (admitted) candidates.push(taxon);
      }
    }
    verdicts.sort((a, b) => b.depth - a.depth || a.taxonName.localeCompare(b.taxonName));
    candidates.sort((a, b) => this.depth(b.canonicalId) - this.depth(a.canonicalId));

    const assertions: Entry[] = [];
    const refused: { taxon: string; reason: string }[] = [];
    const existing = this.effectiveAssertions(entity.canonicalId);
    for (const taxon of candidates) {
      if (existing.some((a) => a.content.taxon === taxon.canonicalId)) continue;
      const exclusive = ((taxon.content.exclusiveWith as string[]) ?? []).filter((x) => existing.some((a) => a.content.taxon === x) || assertions.some((a) => a.content.taxon === x));
      if (exclusive.length && !context.bindings['discriminator']) {
        refused.push({ taxon: taxon.canonicalId, reason: `mutually exclusive with ${exclusive.join(', ')} without a discriminating context (V-CL-04)` });
        continue;
      }
      try {
        assertions.push(this.assert(entity, taxon, actor, context, options));
      } catch (err) {
        refused.push({ taxon: taxon.canonicalId, reason: (err as Error).message });
      }
    }
    for (const r of refused) {
      this.p.decisions.record({ subject: entity.canonicalId, authority: actor.authority, selection: 'REFUSE', alternatives: ['ASSERT', 'REFUSE'], rationale: r.reason, context, objective: 'classification' }, actor);
    }
    const attachedPolicies = this.policiesFor(entity.canonicalId).map((x) => x.policy);
    this.p.bus.emit({ type: 'tax.classification.evaluated', subject: entity.canonicalId, actor, payload: { operation: 'CLASSIFY', verdicts: verdicts.length, asserted: assertions.length, refused: refused.length }, context: context.record });
    return { entity: entity.canonicalId, verdicts, assertions, refused, attachedPolicies };
  }

  private schemesInScope(entity: Entry): string[] {
    return this.schemes()
      .filter((s) => {
        const scope = (s.content.scopeKinds as string[]) ?? [];
        return scope.length === 0 || scope.includes(entity.kind);
      })
      .map((s) => s.canonicalId);
  }

  /** Writes the Classification artifact and the CLASSIFIED-AS edge, then cascades policy. */
  assert(entity: Entry, taxon: Entry, actor: Actor, context: ResolvedContext, options: { inferred?: boolean; confidence?: number; evidence?: unknown } = {}): Entry {
    return this.p.store.tx(() => {
      const inferred = options.inferred === true;
      const confidence = inferred ? Math.min(options.confidence ?? 0.5, 0.999) : 1;
      const mandated = (taxon.content.attributes as string[]) ?? [];
      const attrs = { ...((entity.content.attributes as Record<string, unknown>) ?? {}), ...((entity.content.facetBindings as Record<string, unknown>) ?? {}) };
      const missing = mandated.filter((a) => attrs[a] === undefined && attrs[this.p.fabric.tryResolve(a)?.entry.definition.canonicalName ?? a] === undefined);
      const a = this.p.fabric.submit(
        {
          kind: 'Classification',
          namespace: entity.classification.namespace,
          name: `${entity.definition.canonicalName} ∈ ${taxon.definition.canonicalName} @${this.p.clock.now()}`,
          statement: `${entity.definition.canonicalName} is classified as ${taxon.definition.canonicalName}.`,
          content: {
            entity: entity.canonicalId,
            taxon: taxon.canonicalId,
            taxonName: taxon.definition.canonicalName,
            scheme: taxon.content.scheme,
            assertedBy: actor.principal,
            assertedAt: this.p.clock.now(),
            context: context.record,
            evidence: options.evidence ?? { admissionRule: taxon.content.admissionRule ?? 'explicit assertion', attributesEvaluated: Object.keys(attrs) },
            confidence,
            inferred,
            missingMandatedAttributes: missing,
          },
          provenance: { source: 'taxonomy-engine' },
        },
        actor,
      );
      this.p.fabric.relate('CLASSIFIED-AS', entity.canonicalId, taxon.canonicalId, actor, { context: { assertion: a.canonicalId }, confidence });
      let current = this.p.fabric.transition(a.canonicalId, 'VALIDATED', actor, { admitted: true });
      if (!inferred && missing.length === 0) {
        current = this.p.fabric.transition(a.canonicalId, 'EFFECTIVE', actor, { confirmed: true });
        this.p.bus.emit({ type: 'tax.assertion.effective', subject: a.canonicalId, actor, payload: { entity: entity.canonicalId, taxon: taxon.canonicalId, confidence }, context: context.record });
        this.p.bus.emit({ type: 'tax.policy.cascade.triggered', subject: entity.canonicalId, actor, payload: { cause: 'classification', taxon: taxon.canonicalId, policies: (taxon.content.policies as string[]) ?? [] }, context: context.record });
      } else if (missing.length) {
        this.p.bus.emit({ type: 'tax.assertion.conflict.detected', subject: entity.canonicalId, actor, payload: { taxon: taxon.canonicalId, missingMandatedAttributes: missing, rule: 'C-TX-01' }, context: context.record });
      }
      return current;
    });
  }

  /** Confirms an inferred or pending assertion (TX-S-03: only confirmation grants EFFECTIVE). */
  confirm(assertionId: string, actor: Actor): Entry {
    const a = this.p.fabric.require(assertionId);
    const missing = (a.content.missingMandatedAttributes as string[]) ?? [];
    if (missing.length) throw new ConstitutionalError('C-TX-01', `mandated attributes missing: ${missing.join(', ')}`);
    const out = this.p.fabric.transition(assertionId, 'EFFECTIVE', actor, { confirmed: true }, (e) => {
      e.content.confirmedBy = actor.principal;
      e.content.confirmedAt = this.p.clock.now();
    });
    this.p.bus.emit({ type: 'tax.assertion.effective', subject: assertionId, actor, payload: { entity: a.content.entity, taxon: a.content.taxon, confirmed: true }, context: a.content.context as Record<string, unknown> });
    this.p.bus.emit({ type: 'tax.policy.cascade.triggered', subject: String(a.content.entity), actor, payload: { cause: 'confirmation', assertion: assertionId }, context: a.content.context as Record<string, unknown> });
    return out;
  }

  /** WITHDRAW: audited; re-evaluates every policy attached through it (TX-G3). */
  withdraw(assertionId: string, reason: string, actor: Actor): { assertion: Entry; policiesReevaluated: string[] } {
    return this.p.store.tx(() => {
      const a = this.p.fabric.require(assertionId);
      if (a.kind !== 'Classification') throw new ConstitutionalError('TX-P2', `${assertionId} is not a classification assertion`);
      const before = this.policiesFor(String(a.content.entity)).map((x) => x.policy);
      const updated = this.p.fabric.transition(assertionId, 'WITHDRAWN', actor, { reason }, (e) => {
        e.content.withdrawnReason = reason;
      }, 'tax.assertion.withdrawn');
      for (const edge of this.p.store.edgesFrom(String(a.content.entity), 'CLASSIFIED-AS')) {
        const ctx = JSON.parse(edge.body).context as Record<string, unknown>;
        if (ctx?.assertion === assertionId) this.p.fabric.unrelate(edge.id, actor, reason);
      }
      const after = this.policiesFor(String(a.content.entity)).map((x) => x.policy);
      const reevaluated = before.filter((p) => !after.includes(p));
      this.p.bus.emit({ type: 'tax.policy.cascade.triggered', subject: String(a.content.entity), actor, payload: { cause: 'withdrawal', detached: reevaluated, remaining: after } });
      return { assertion: updated, policiesReevaluated: reevaluated };
    });
  }

  effectiveAssertions(entityId: string): Entry[] {
    return this.p.fabric.query({ kind: 'Classification', status: 'EFFECTIVE', contentPath: 'entity', contentEquals: entityId, limit: 10_000 }).entries;
  }

  assertions(entityId: string): Entry[] {
    return this.p.fabric.query({ kind: 'Classification', contentPath: 'entity', contentEquals: entityId, limit: 10_000 }).entries;
  }

  /** PATHS: every classification path, all schemes (Phase 005 §10). */
  paths(entityRef: string): { scheme: string; path: { id: string; name: string }[] }[] {
    const entity = this.p.fabric.resolve(entityRef).entry;
    const out: { scheme: string; path: { id: string; name: string }[] }[] = [];
    for (const a of this.effectiveAssertions(entity.canonicalId)) {
      const walk = (id: string, acc: { id: string; name: string }[]) => {
        const node = this.p.fabric.require(id);
        const next = [{ id, name: node.definition.canonicalName }, ...acc];
        const ps = this.parents(id);
        if (ps.length === 0) out.push({ scheme: String(a.content.scheme), path: next });
        for (const p of ps) walk(p, next);
      };
      walk(String(a.content.taxon), []);
    }
    return out;
  }

  /** POLICIES-FOR: policies attached through classification, including ancestors. */
  policiesFor(entityRef: string): { policy: string; via: string }[] {
    const entity = this.p.fabric.resolve(entityRef).entry;
    const out = new Map<string, { policy: string; via: string }>();
    for (const a of this.effectiveAssertions(entity.canonicalId)) {
      const stack = [String(a.content.taxon)];
      const seen = new Set<string>();
      while (stack.length) {
        const t = stack.pop()!;
        if (seen.has(t)) continue;
        seen.add(t);
        const taxon = this.p.fabric.get(t);
        for (const pol of (taxon?.content.policies as string[]) ?? []) {
          const id = this.p.fabric.tryResolve(pol)?.entry.canonicalId ?? pol;
          if (!out.has(id)) out.set(id, { policy: id, via: t });
        }
        stack.push(...this.parents(t));
      }
    }
    for (const edge of this.p.store.edgesFrom(entity.canonicalId, 'GOVERNED-BY')) if (!out.has(edge.target)) out.set(edge.target, { policy: edge.target, via: 'explicit' });
    return [...out.values()];
  }

  /** Attributes referenced by an admission rule (used to prove V-TX-02 / TX-P8). */
  ruleAttributes(taxonId: string): string[] {
    const rule = this.p.fabric.require(taxonId).content.admissionRule as string | undefined;
    return rule ? referencedPaths(rule) : [];
  }
}
