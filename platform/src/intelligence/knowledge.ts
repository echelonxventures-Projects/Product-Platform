import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { normaliseStatement, hashValue } from '../kernel/hash.ts';

/**
 * Knowledge Engine (Phase 010 §5.1): ingest with authority and evidence,
 * justify, reconcile duplicates (UCI-003), refine confidence, and refute by
 * supersession — never deletion (UCI-005).
 */
export class KnowledgeEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  private key(subject: string, statement: string, purpose: string): string {
    return hashValue([subject, normaliseStatement(statement), purpose]).slice(0, 24);
  }

  /** ASSERT(knowledge, evidence, authority): reconciles with an existing object for the same subject and context. */
  assert(input: { subject: string; statement: string; justification: string; evidence?: string[]; confidence?: number; inferred?: boolean; namespace?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    if (!input.justification?.trim()) throw new ConstitutionalError('V-KW-01', 'knowledge requires a justification; an unjustified assertion is a signal, not knowledge');
    for (const ev of input.evidence ?? []) if (!this.p.fabric.exists(ev)) throw new ConstitutionalError('V-KW-01', `evidence ${ev} does not resolve`);
    const subject = this.p.fabric.tryResolve(input.subject)?.entry.canonicalId ?? input.subject;
    const reconcileKey = this.key(subject, input.statement, ctx.purpose);
    const existing = this.p.fabric.query({ kind: 'Knowledge', contentPath: 'reconcileKey', contentEquals: reconcileKey, limit: 1 }).entries.find((k) => !['REFUTED', 'ARCHIVED'].includes(k.lifecycle.status));
    if (existing) {
      const refined = this.refine(existing.canonicalId, Math.max(Number(existing.content.confidence ?? 0), input.confidence ?? 1), input.evidence ?? [], actor);
      this.p.bus.emit({ type: 'int.knowledge.reconciled', subject: existing.canonicalId, actor, payload: { duplicateOf: existing.canonicalId, purpose: ctx.purpose }, context: ctx.record });
      return refined;
    }
    const k = this.p.fabric.submit(
      {
        kind: 'Knowledge',
        namespace: input.namespace ?? this.p.namespaceOf(subject),
        name: `${input.statement.slice(0, 80)} [${reconcileKey}]`,
        statement: input.statement,
        content: { subject, justification: input.justification, evidence: input.evidence ?? [], confidence: input.inferred ? Math.min(input.confidence ?? 0.5, 0.999) : (input.confidence ?? 1), inferred: input.inferred === true, context: ctx.record, reconcileKey, provenance: actor.principal },
        provenance: { source: 'knowledge-engine' },
        relationships: this.p.fabric.exists(subject) ? [{ type: 'REFERENCES', target: subject, context: { role: 'knowledge-subject' } }] : [],
      },
      actor,
    );
    const evidenced = this.p.fabric.transition(k.canonicalId, 'EVIDENCED', actor, { justified: true });
    this.p.bus.emit({ type: 'int.knowledge.asserted', subject: k.canonicalId, actor, payload: { subject, inferred: input.inferred === true, purpose: ctx.purpose }, context: ctx.record });
    return evidenced;
  }

  refine(id: string, confidence: number, evidence: string[], actor: Actor): Entry {
    const k = this.p.fabric.require(id);
    const apply = (e: Entry) => {
      e.content.confidence = confidence;
      e.content.evidence = [...new Set([...((e.content.evidence as string[]) ?? []), ...evidence])];
    };
    if (k.lifecycle.status === 'CERTIFIED') return this.p.fabric.transition(id, 'REFINED', actor, {}, apply, 'int.knowledge.refined');
    return this.p.fabric.amend(id, actor, apply, 'REFINE', 'int.knowledge.refined');
  }

  /** REFUTE: supersedes; every dependent inference is re-evaluated (E-IN-04). */
  refute(id: string, reason: string, actor: Actor, successor?: string): { refuted: Entry; cascaded: string[] } {
    return this.p.store.tx(() => {
      const refuted = this.p.fabric.transition(id, 'REFUTED', actor, { reason, successor }, (e) => {
        e.content.refutation = { reason, successor: successor ?? null, at: this.p.clock.now() };
        if (successor) e.supersededBy = successor;
      });
      this.p.bus.emit({ type: 'int.knowledge.refuted', subject: id, actor, payload: { reason, successor: successor ?? null, purpose: 'knowledge-governance' }, context: { purpose: 'knowledge-governance', reality: 'actual' } });
      const cascaded: string[] = [];
      for (const edge of this.p.store.edgesTo(id, 'INFERRED-FROM')) {
        const inf = this.p.fabric.get(edge.source);
        if (inf && !['REFUTED', 'ARCHIVED'].includes(inf.lifecycle.status)) {
          this.p.fabric.transition(inf.canonicalId, 'REFUTED', actor, { reason: `premise ${id} refuted` });
          this.p.bus.emit({ type: 'int.inference.refuted', subject: inf.canonicalId, actor, payload: { premise: id, purpose: 'knowledge-governance' }, context: { purpose: 'knowledge-governance', reality: 'actual' } });
          cascaded.push(inf.canonicalId);
        }
      }
      return { refuted, cascaded };
    });
  }

  about(subjectRef: string): Entry[] {
    const subject = this.p.fabric.tryResolve(subjectRef)?.entry.canonicalId ?? subjectRef;
    return this.p.fabric.query({ kind: ['Knowledge', 'Inference'], contentPath: 'subject', contentEquals: subject, limit: 10_000 }).entries;
  }
}
