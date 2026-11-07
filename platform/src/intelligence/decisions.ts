import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';

export interface DecisionInput {
  subject: string;
  authority: string;
  objective: string;
  alternatives: unknown[];
  selection: unknown;
  rationale: string;
  context?: ResolvedContext;
  evidence?: unknown;
  confidence?: number;
  outcome?: 'EXECUTED' | 'REFUSED' | 'VALIDATED';
}

/**
 * Decision recorder (C-24, UCL-G05): every decision — including every refusal
 * — is an owned, versioned, auditable artifact with an accountable authority
 * (UCI-006) and the context that produced it (CX-P8).
 */
export class DecisionService {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  record(input: DecisionInput, actor: Actor): Entry {
    return this.p.store.tx(() => {
      const refusal = input.selection === 'REFUSE' || input.outcome === 'REFUSED';
      const d = this.p.fabric.submit(
        {
          kind: 'Decision',
          namespace: this.p.namespaceOf(input.subject),
          name: `Decision ${input.objective} on ${input.subject} #${this.p.fabric.newCorrelationId().slice(0, 12)}`,
          statement: '',
          content: {
            subject: input.subject,
            authority: input.authority,
            actor: actor.principal,
            objective: input.objective,
            alternatives: input.alternatives,
            selection: input.selection,
            rationale: input.rationale,
            context: input.context?.record ?? { purpose: input.objective, reality: 'actual' },
            evidence: input.evidence ?? null,
            confidence: input.confidence ?? 1,
            purpose: actor.purpose ?? input.objective,
          },
          provenance: { source: 'decision-recorder' },
        },
        actor,
      );
      if (this.p.fabric.exists(input.subject)) this.p.fabric.relate('REFERENCES', d.canonicalId, input.subject, actor, { context: { role: 'decision-subject' } });
      const ctx = { ...(input.context?.record ?? { purpose: input.objective, reality: 'actual' }), purpose: actor.purpose ?? input.objective };
      if (refusal) {
        const out = this.p.fabric.transition(d.canonicalId, 'REFUSED', actor, { reason: input.rationale });
        this.p.bus.emit({ type: 'int.decision.recorded', subject: d.canonicalId, actor, payload: { selection: 'REFUSE', objective: input.objective, purpose: actor.purpose ?? input.objective }, context: ctx });
        this.p.bus.emit({ type: 'int.decision.refusal', subject: input.subject, actor, payload: { decision: d.canonicalId, rationale: input.rationale, purpose: actor.purpose ?? input.objective }, context: ctx });
        return out;
      }
      const validated = this.p.fabric.transition(d.canonicalId, 'VALIDATED', actor);
      this.p.bus.emit({ type: 'int.decision.recorded', subject: d.canonicalId, actor, payload: { selection: input.selection, objective: input.objective, purpose: actor.purpose ?? input.objective }, context: ctx });
      if (input.outcome === 'EXECUTED') return this.p.fabric.transition(validated.canonicalId, 'EXECUTED', actor, { policyPermits: true });
      return validated;
    });
  }
}
