import type { Platform } from '../platform.ts';
import type { Actor, PlatformEvent } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError, AuthorizationError } from '../kernel/errors.ts';
import { hashValue } from '../kernel/hash.ts';

export const AUTONOMY_LEVELS = ['escalation-only', 'advisory', 'supervised', 'conditional-autonomous', 'autonomous'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export interface GovernanceRule {
  on: string;
  when?: string;
  action: 'suspend-composition' | 'escalate' | 'alert' | 'revoke-entitlement' | 'regenerate-stale' | 'propose-amendment' | 'withdraw-offer';
  target?: string;
  escalateTo?: string;
  message?: string;
}

/**
 * Autonomous Governance Engine and autonomy control (Phase 010 §5.7, §6).
 * The engine monitors events, evaluates ratified governance policy in a
 * resolved context and acts only inside an envelope owned by another
 * authority. It never ratifies, never certifies, never amends its own
 * envelope, and never infers its own objective (IN-A1..IN-A6).
 */
export class AutonomyEngine {
  private readonly p: Platform;
  private depth = 0;
  private enabled = false;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('IntelligenceCapability', (e) => this.validateCapability(e));
    this.p.validation.registerKind('Escalation', (e) => (e.content.escalatedTo && e.content.reason ? [] : [{ rule: 'IN-S-07', message: 'an escalation names the receiving authority and its reason' }]));
  }

  /** Starts continuous monitoring (the engine's Operating lifecycle state). */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.p.bus.subscribe((e) => this.onEvent(e));
  }

  private validateCapability(e: Entry): { rule: string; message: string }[] {
    const c = e.content as Record<string, unknown>;
    const out: { rule: string; message: string }[] = [];
    if (!c.objective) out.push({ rule: 'V-IN-01', message: 'objective is a registered purpose, present and ratified' });
    const env = c.policyEnvelope as { owner?: string } | undefined;
    if (!env?.owner) out.push({ rule: 'V-IN-02', message: 'policy envelope must resolve with an owner' });
    else if (env.owner === e.ownership.canonicalOwner) out.push({ rule: 'IN-A1', message: 'the envelope must be owned by a different authority than the capability (Phase 010 §6.1)' });
    if (!AUTONOMY_LEVELS.includes(c.autonomyLevel as AutonomyLevel)) out.push({ rule: 'V-IN-03', message: `autonomyLevel must be one of ${AUTONOMY_LEVELS.join(', ')}` });
    if (!c.escalationPath) out.push({ rule: 'V-IN-03', message: 'a defined escalation path is required' });
    return out;
  }

  capability(ref: string): Entry {
    const e = this.p.fabric.tryResolve(ref)?.entry ?? this.p.fabric.query({ kind: 'IntelligenceCapability', nameLike: ref, limit: 1 }).entries[0];
    if (!e || e.kind !== 'IntelligenceCapability') throw new ConstitutionalError('D-IN-01', `intelligence capability ${ref} is not registered`);
    return e;
  }

  private envelopeHash(cap: Entry): string {
    return hashValue(cap.content.policyEnvelope ?? {});
  }

  /** Records alignment evidence — by a principal other than the capability's owner. */
  recordAlignment(capRef: string, evidence: Record<string, unknown>, actor: Actor): Entry {
    const cap = this.capability(capRef);
    if (actor.authority === cap.ownership.canonicalOwner) throw new ConstitutionalError('GI-4', 'alignment evidence may not be supplied by the capability’s own authority');
    if (actor.autonomous) throw new ConstitutionalError('IN-A3', 'an autonomous principal may not attest alignment');
    const out = this.p.fabric.amend(cap.canonicalId, actor, (e) => {
      e.content.alignmentEvidence = { ...evidence, reviewer: actor.principal, authority: actor.authority, at: this.p.clock.now(), envelopeHash: this.envelopeHash(cap) };
    }, 'ALIGNMENT');
    this.p.bus.emit({ type: 'int.alignment.recorded', subject: cap.canonicalId, actor, payload: { reviewer: actor.principal, purpose: 'alignment' }, context: { purpose: 'alignment', reality: 'actual' } });
    return out;
  }

  /** IN-S-03: evidence exists and still matches the current envelope. */
  verifyAlignment(capRef: string): { capability: string; verified: boolean; reason: string } {
    const cap = this.capability(capRef);
    const ev = cap.content.alignmentEvidence as { envelopeHash?: string } | undefined;
    if (!ev?.envelopeHash) return { capability: cap.canonicalId, verified: false, reason: 'no alignment evidence' };
    if (ev.envelopeHash !== this.envelopeHash(cap)) {
      this.p.bus.emit({ type: 'int.alignment.evidence.failed', subject: cap.canonicalId, actor: this.p.systemActor(), payload: { reason: 'envelope changed since alignment evidence was recorded', purpose: 'alignment' }, context: { purpose: 'alignment', reality: 'actual' } });
      return { capability: cap.canonicalId, verified: false, reason: 'envelope changed; alignment must be re-verified (IN-S-03)' };
    }
    return { capability: cap.canonicalId, verified: true, reason: 'evidence matches the current envelope' };
  }

  /**
   * REQUEST-AUTONOMY(capability, context) → level + conditions. The level is
   * the minimum of the declared level, the composition ceiling and every
   * applicable autonomy policy for this context; above advisory it requires
   * verified alignment, otherwise it is downgraded (X-IN-03).
   */
  requestAutonomy(capRef: string, actor: Actor, ctx: ResolvedContext): { capability: string; level: AutonomyLevel; conditions: string[]; escalationPath: string; context: Record<string, unknown> } {
    const cap = this.capability(capRef);
    const declared = String(cap.content.autonomyLevel) as AutonomyLevel;
    let level: AutonomyLevel = declared;
    const conditions: string[] = [`declared ${declared}`];
    for (const pol of this.p.policy.policies()) {
      for (const rule of (pol.content.autonomy as { when: string; level: AutonomyLevel }[]) ?? []) {
        if (this.p.expressions.boolean(rule.when, { ...ctx.bindings, context: ctx.bindings, capability: cap.definition.canonicalName, cluster: cap.content.engineCluster })) {
          if (AUTONOMY_LEVELS.indexOf(rule.level) < AUTONOMY_LEVELS.indexOf(level)) {
            level = rule.level;
            conditions.push(`${pol.definition.canonicalName}: ${rule.level} when ${rule.when}`);
          }
        }
      }
    }
    if (AUTONOMY_LEVELS.indexOf(level) > AUTONOMY_LEVELS.indexOf('advisory')) {
      const v = this.verifyAlignment(cap.canonicalId);
      if (!v.verified) {
        level = 'advisory';
        conditions.push(`downgraded to advisory: ${v.reason} (X-IN-03)`);
      }
    }
    this.p.bus.emit({ type: 'int.autonomy.resolved', subject: cap.canonicalId, actor, payload: { level, conditions, purpose: 'autonomy' }, context: { ...ctx.record, purpose: 'autonomy' } });
    return { capability: cap.canonicalId, level, conditions, escalationPath: String(cap.content.escalationPath), context: ctx.record };
  }

  /** ESCALATE: a first-class behaviour, not an error path (IN-S-07). */
  escalate(input: { subject: string; to: string; reason: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const body = this.p.governance.body(input.to);
    const esc = this.p.fabric.submit(
      {
        kind: 'Escalation',
        namespace: this.p.namespaceOf(input.subject),
        name: `Escalation to ${body.name} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: input.reason,
        content: { subject: input.subject, escalatedTo: body.name, reason: input.reason, authority: actor.authority, purpose: actor.purpose ?? 'escalation', context: ctx.record },
        provenance: { source: 'autonomous-governance' },
      },
      actor,
    );
    this.p.fabric.relate('ESCALATED-TO', esc.canonicalId, body.canonicalId, actor);
    if (this.p.fabric.exists(input.subject)) this.p.fabric.relate('REFERENCES', esc.canonicalId, input.subject, actor, { context: { role: 'escalated-subject' } });
    this.p.bus.emit({ type: 'int.autonomy.escalated', subject: input.subject, actor, payload: { escalation: esc.canonicalId, to: body.name, reason: input.reason, purpose: actor.purpose ?? 'escalation' }, context: { ...ctx.record, purpose: actor.purpose ?? 'escalation' } });
    return this.p.fabric.transition(esc.canonicalId, 'VALIDATED', actor);
  }

  /** PROPOSE an amendment through the governance process — never applied by the engine (IN-A1). */
  proposeAmendment(input: { policy: string; change: Record<string, unknown>; rationale: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const pol = this.p.fabric.resolve(input.policy).entry;
    this.p.policy.enforce({ action: 'policy.propose-amendment', subject: pol, actor, context: ctx });
    return this.p.decisions.record({ subject: pol.canonicalId, authority: actor.authority, objective: 'policy-amendment', alternatives: ['AMEND', 'RETAIN'], selection: { proposal: input.change }, rationale: input.rationale, context: ctx, outcome: 'VALIDATED' }, actor);
  }

  /**
   * Amendment attempt by an intelligent actor on a policy in its own
   * envelope: always refused, recorded as security-relevant.
   */
  amendPolicy(input: { policy: string; change: Record<string, unknown> }, actor: Actor, ctx: ResolvedContext): never | Entry {
    const pol = this.p.fabric.resolve(input.policy).entry;
    if (actor.autonomous) {
      this.p.bus.emit({ type: 'int.envelope.amendment.attempted', subject: pol.canonicalId, actor, payload: { change: input.change, rule: 'IN-A1', purpose: actor.purpose ?? 'unstated' }, context: { ...ctx.record, purpose: actor.purpose ?? 'unstated' } });
      throw new AuthorizationError('IN-A1', 'an intelligent actor may not amend a policy envelope; propose an amendment instead');
    }
    this.p.policy.enforce({ action: 'policy.amend', subject: pol, actor, context: ctx });
    throw new ConstitutionalError('M-03', 'a certified policy is amended by supersession: register the amended policy and supersede this one');
  }

  /** Learning bounded by the learning policy (IN-S-05). */
  learn(capRef: string, change: { parameter: string; value: number }, actor: Actor): Entry {
    const cap = this.capability(capRef);
    const lp = (cap.content.learningPolicy as { allowed?: Record<string, { min: number; max: number }> }) ?? {};
    const bound = lp.allowed?.[change.parameter];
    if (!bound || change.value < bound.min || change.value > bound.max) {
      this.p.bus.emit({ type: 'int.learning.boundary.breached', subject: cap.canonicalId, actor, payload: { change, purpose: 'learning' }, context: { purpose: 'learning', reality: 'actual' } });
      throw new ConstitutionalError('IN-S-05', `learning outside the learning policy: ${change.parameter}=${change.value}`);
    }
    return this.p.fabric.amend(cap.canonicalId, actor, (e) => {
      e.content.learnedParameters = { ...((e.content.learnedParameters as Record<string, number>) ?? {}), [change.parameter]: change.value };
    }, 'LEARN', 'int.learning.applied');
  }

  // ── continuous governance ───────────────────────────────────────────────

  private governanceRules(): { policy: Entry; rule: GovernanceRule }[] {
    return this.p.policy.policies().flatMap((pol) => ((pol.content.governance as GovernanceRule[]) ?? []).map((rule) => ({ policy: pol, rule })));
  }

  private matches(pattern: string, type: string): boolean {
    return pattern === type || (pattern.endsWith('*') && type.startsWith(pattern.slice(0, -1)));
  }

  private onEvent(e: PlatformEvent): void {
    if (!this.enabled || this.depth > 0) return;
    const agent = this.p.governanceAgent();
    if (!agent || e.actor === agent.principal) return;
    const rules = this.governanceRules().filter((r) => this.matches(r.rule.on, e.type));
    if (!rules.length) return;
    this.depth++;
    try {
      for (const { policy, rule } of rules) {
        const scope = { event: { type: e.type, subject: e.subject, payload: e.payload, actor: e.actor, reality: e.reality }, payload: e.payload, subject: e.subject };
        if (rule.when && !this.p.expressions.boolean(rule.when, scope)) continue;
        try {
          this.act(policy, rule, e, agent);
        } catch (err) {
          this.p.bus.emit({ type: 'int.action.suspended', subject: e.subject, actor: agent, payload: { policy: policy.canonicalId, action: rule.action, reason: (err as Error).message, purpose: agent.purpose }, context: { purpose: agent.purpose, reality: 'actual' } });
        }
      }
    } finally {
      this.depth--;
    }
  }

  private act(policy: Entry, rule: GovernanceRule, e: PlatformEvent, agent: Actor): void {
    const ctx = this.p.context.resolve({ purpose: 'governance', contributions: this.p.context.contributionsFrom({ Governance: { policies: [policy.canonicalId] } }, agent) }, agent, { emit: false });
    const cap = this.p.fabric.query({ kind: 'IntelligenceCapability', nameLike: 'Autonomous Governance', limit: 1 }).entries[0];
    const autonomy = cap ? this.requestAutonomy(cap.canonicalId, agent, ctx) : { level: 'advisory' as AutonomyLevel };
    const target = rule.target ? this.resolveTarget(rule.target, e) : e.subject;
    if (autonomy.level === 'escalation-only' || rule.action === 'escalate') {
      this.escalate({ subject: target ?? 'UCOS', to: rule.escalateTo ?? policy.content.issuer as string, reason: rule.message ?? `${e.type} matched ${policy.definition.canonicalName}` }, agent, ctx);
      return;
    }
    if (autonomy.level === 'advisory') {
      this.p.decisions.record({ subject: target ?? policy.canonicalId, authority: agent.authority, objective: 'governance', alternatives: [rule.action, 'none'], selection: { proposed: rule.action }, rationale: `advisory: ${rule.action} proposed for ratification (${e.type})`, context: ctx, outcome: 'VALIDATED' }, agent);
      this.p.bus.emit({ type: 'int.action.proposed', subject: target, actor: agent, payload: { action: rule.action, policy: policy.canonicalId, purpose: agent.purpose }, context: { ...ctx.record, purpose: agent.purpose } });
      return;
    }
    this.p.policy.enforce({ action: `governance.${rule.action}`, subject: target ? this.p.fabric.get(target) : null, actor: agent, context: ctx });
    switch (rule.action) {
      case 'suspend-composition':
        if (target) this.p.composition.suspend(target, rule.message ?? `governance: ${e.type}`, agent);
        break;
      case 'revoke-entitlement':
        if (target) this.p.commerce.revoke(target, rule.message ?? `governance: ${e.type}`, agent);
        break;
      case 'withdraw-offer':
        if (target) this.p.commerce.withdrawOffer(target, rule.message ?? `governance: ${e.type}`, agent);
        break;
      case 'regenerate-stale':
        if (target) this.p.generation.regenerate(target, agent);
        break;
      case 'propose-amendment':
        this.proposeAmendment({ policy: policy.canonicalId, change: { trigger: e.type }, rationale: rule.message ?? 'observed condition warrants review' }, agent, ctx);
        break;
      case 'alert':
      default:
        this.p.bus.emit({ type: 'int.governance.alert', subject: target, actor: agent, payload: { policy: policy.canonicalId, message: rule.message ?? e.type, purpose: agent.purpose }, context: { ...ctx.record, purpose: agent.purpose } });
    }
    this.p.bus.emit({ type: 'int.action.executed', subject: target, actor: agent, payload: { action: rule.action, policy: policy.canonicalId, level: autonomy.level, trigger: e.eventId, purpose: agent.purpose }, context: { ...ctx.record, purpose: agent.purpose } });
    if (autonomy.level === 'supervised') this.p.bus.emit({ type: 'int.action.review.required', subject: target, actor: agent, payload: { action: rule.action, purpose: agent.purpose }, context: { ...ctx.record, purpose: agent.purpose } });
  }

  private resolveTarget(path: string, e: PlatformEvent): string | null {
    if (path === 'subject') return e.subject;
    const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), { payload: e.payload, event: e });
    return typeof v === 'string' ? v : null;
  }
}
