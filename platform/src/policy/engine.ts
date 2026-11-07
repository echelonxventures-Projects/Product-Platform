import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { AuthorizationError } from '../kernel/errors.ts';
import { evaluateBoolean } from '../rules/expression.ts';

export interface PolicyRule {
  id: string;
  antecedent?: string;
  modality: 'permit' | 'prohibit' | 'oblige';
  action: string;
  obligation?: string;
  severity?: 'info' | 'warning' | 'error' | 'critical';
  remediation?: string;
}

export interface PolicyContent {
  issuer: string;
  purpose: string;
  scope: { actions?: string[]; kinds?: string[]; namespaces?: string[]; subjects?: string[] };
  contextConditions?: string[];
  rules: PolicyRule[];
  objectives?: string[];
  effectiveFrom?: string;
  effectiveTo?: string | null;
  exceptions?: { rule: string; condition: string; evidence: string }[];
  protectedActions?: boolean;
}

export interface Verdict {
  decision: 'PERMIT' | 'DENY';
  obligations: { policy: string; rule: string; obligation: string }[];
  matched: { policy: string; rule: string; modality: string; rank: number; specificity: number; recency: number }[];
  reason: string;
  context: Record<string, unknown>;
  evaluatedAt: string;
}

/**
 * Policy evaluation (C-16, UCL-G01). Policies are registered artifacts;
 * precedence is computed at evaluation time from (authority rank,
 * specificity, recency) and never stored (V-PL-01, CX-P6). Trust is never
 * implicit (UCL-G02): an action with no permitting policy is denied. A
 * prohibition and a permission with equal precedence resolve to denial —
 * resolution never depends on evaluation order (V-RU-03).
 */
export class PolicyEngine {
  private readonly p: Platform;
  private cache: { at: number; policies: Entry[] } | null = null;

  constructor(p: Platform) {
    this.p = p;
  }

  invalidate(): void {
    this.cache = null;
  }

  policies(): Entry[] {
    if (!this.cache) {
      const policies = this.p.fabric.query({ kind: 'Policy', status: ['CERTIFIED', 'ADMISSIBLE'], limit: 100_000 }).entries;
      this.cache = { at: Date.now(), policies };
    }
    return this.cache.policies;
  }

  private specificity(c: PolicyContent): number {
    return (c.scope.subjects?.length ? 8 : 0) + (c.scope.kinds?.length ? 4 : 0) + (c.scope.namespaces?.length ? 2 : 0) + (c.contextConditions?.length ?? 0);
  }

  /**
   * EVALUATE(action, subject, actor, context) → verdict with the context that
   * produced it (CX-P8). Every evaluation is recorded as an audited event.
   */
  evaluate(input: { action: string; subject?: Entry | null; actor: Actor; context: ResolvedContext; attributes?: Record<string, unknown> }, options: { record?: boolean } = {}): Verdict {
    const { action, subject, actor, context } = input;
    const now = this.p.clock.now();
    const principal = this.p.governance.principalList().find((pr) => pr.canonicalId === actor.principal);
    const scope: Record<string, unknown> = {
      action,
      actor: { principal: actor.principal, authority: actor.authority, bodies: principal?.bodies ?? [], kind: principal?.principalKind ?? 'unknown', autonomous: actor.autonomous === true, purpose: actor.purpose ?? null, onBehalfOf: actor.onBehalfOf ?? null },
      subject: subject ? { id: subject.canonicalId, kind: subject.kind, namespace: subject.classification.namespace, status: subject.lifecycle.status, owner: subject.ownership.canonicalOwner, posture: subject.securityPosture.level, content: subject.content } : null,
      context: context.bindings,
      ...context.bindings,
      ...(input.attributes ?? {}),
      now,
    };
    const attached = subject ? new Set(this.p.taxonomy.policiesFor(subject.canonicalId).map((x) => x.policy)) : new Set<string>();
    const matched: Verdict['matched'] = [];
    const obligations: Verdict['obligations'] = [];
    for (const pol of this.policies()) {
      const c = pol.content as unknown as PolicyContent;
      if (!this.inScope(c, action, subject, attached.has(pol.canonicalId))) continue;
      if (c.effectiveFrom && Date.parse(now) < Date.parse(c.effectiveFrom)) continue;
      if (c.effectiveTo && Date.parse(now) >= Date.parse(c.effectiveTo)) continue;
      if (!(c.contextConditions ?? []).every((cond) => safe(cond, scope))) continue;
      const rank = this.p.governance.authorityRank(c.issuer);
      const specificity = this.specificity(c) + (attached.has(pol.canonicalId) ? 16 : 0);
      const recency = Date.parse(c.effectiveFrom ?? pol.provenance.recordedAt ?? '1970-01-01');
      for (const r of c.rules) {
        if (r.action !== '*' && r.action !== action && !(r.action.endsWith('*') && action.startsWith(r.action.slice(0, -1)))) continue;
        if (r.antecedent && !safe(r.antecedent, scope)) continue;
        const excepted = (c.exceptions ?? []).some((ex) => ex.rule === r.id && safe(ex.condition, scope));
        if (excepted) continue;
        matched.push({ policy: pol.canonicalId, rule: r.id, modality: r.modality, rank, specificity, recency });
        if (r.modality === 'oblige') obligations.push({ policy: pol.canonicalId, rule: r.id, obligation: r.obligation ?? r.remediation ?? r.id });
      }
    }
    const decisive = matched.filter((m) => m.modality !== 'oblige');
    let decision: Verdict['decision'] = 'DENY';
    let reason = 'no policy permits this action; trust is never implicit (UCL-G02)';
    if (decisive.length) {
      decisive.sort((a, b) => b.rank - a.rank || b.specificity - a.specificity || b.recency - a.recency);
      const top = decisive[0];
      const peers = decisive.filter((m) => m.rank === top.rank && m.specificity === top.specificity && m.recency === top.recency);
      if (peers.some((m) => m.modality === 'prohibit')) {
        decision = 'DENY';
        reason = `prohibited by ${peers.find((m) => m.modality === 'prohibit')!.rule} (precedence: authority ${top.rank}, specificity ${top.specificity})`;
      } else {
        decision = 'PERMIT';
        reason = `permitted by ${top.rule} of ${top.policy}`;
      }
    }
    const verdict: Verdict = { decision, obligations, matched, reason, context: context.record, evaluatedAt: now };
    if (options.record !== false) {
      this.p.bus.emit({ type: 'pol.evaluated', subject: subject?.canonicalId ?? null, actor, payload: { action, decision, reason, matched: matched.length, obligations: obligations.map((o) => o.obligation), purpose: actor.purpose ?? null }, context: { ...context.record, purpose: context.purpose } });
    }
    return verdict;
  }

  private inScope(c: PolicyContent, action: string, subject: Entry | null | undefined, attached: boolean): boolean {
    const s = c.scope ?? {};
    if (s.actions?.length && !s.actions.some((a) => a === action || a === '*' || (a.endsWith('*') && action.startsWith(a.slice(0, -1))))) return false;
    if (s.subjects?.length && !(subject && s.subjects.includes(subject.canonicalId)) && !attached) return false;
    if (s.kinds?.length && !(subject && s.kinds.includes(subject.kind))) return false;
    if (s.namespaces?.length && !(subject && s.namespaces.includes(subject.classification.namespace))) return false;
    return true;
  }

  /** UCL-G01: policy evaluated before any protected action; a denial is a refusal. */
  enforce(input: { action: string; subject?: Entry | null; actor: Actor; context: ResolvedContext; attributes?: Record<string, unknown> }): Verdict {
    if (input.actor.autonomous && !input.actor.purpose) {
      this.p.bus.emit({ type: 'int.action.suspended', subject: input.subject?.canonicalId ?? null, actor: input.actor, payload: { action: input.action, reason: 'UCI-020 autonomous action without a registered purpose' }, context: input.context.record });
      throw new AuthorizationError('UCI-020', `autonomous action ${input.action} requires a registered purpose`);
    }
    if (input.context.reality !== 'actual' && /^(commerce\.accept|commerce\.transfer|settlement\.|entitlement\.grant)/.test(input.action)) {
      // CX-S-04 / IN-S-04: consequences created in a non-actual reality are not effective outside it — permitted only as simulation.
      input.attributes = { ...(input.attributes ?? {}), simulated: true };
    }
    const v = this.evaluate(input);
    if (v.decision === 'DENY') throw new AuthorizationError('UCL-G01', `${input.action} denied: ${v.reason}`, v);
    return v;
  }
}

function safe(expr: string, scope: Record<string, unknown>): boolean {
  try {
    return evaluateBoolean(expr, { scope });
  } catch {
    return false;
  }
}
