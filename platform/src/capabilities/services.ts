import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { intersect, overlaps, type Interval } from '../kernel/clock.ts';
import { seededRandom, hashValue } from '../kernel/hash.ts';

// ─────────────────────────────────────────────────────────────────────────────
// Trust and reputation (C-26): justified expectation from evidence.
// ─────────────────────────────────────────────────────────────────────────────

export class TrustService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Rating', (e) => {
      const c = e.content as Record<string, unknown>;
      const out = [];
      if (!c.evidence || !this.p.fabric.exists(String(c.evidence))) out.push({ rule: 'UCL-G02', message: 'a rating must be evidenced by a registered artifact (trust is never implicit)' });
      if (typeof c.magnitude !== 'number' || Number(c.magnitude) < Number(c.scaleMin ?? 1) || Number(c.magnitude) > Number(c.scaleMax ?? 5)) out.push({ rule: 'V-VL-02', message: 'rating magnitude outside its registered scale' });
      if (!c.purpose) out.push({ rule: 'V-VL-01', message: 'a rating is purpose-relative' });
      return out;
    });
  }

  /** Records an evidenced rating; the rater must be party to the evidence (an entitlement or contract). */
  rate(input: { subject: string; magnitude: number; purpose: string; evidence: string; scaleMin?: number; scaleMax?: number; comment?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const evidence = this.p.fabric.resolve(input.evidence).entry;
    const parties = [evidence.content.holder, evidence.content.grantor, ...(((evidence.content.parties as string[]) ?? []))].filter(Boolean).map(String);
    if (!parties.includes(actor.principal) && !parties.includes(actor.authority)) throw new ConstitutionalError('UCL-G02', 'only a party to the evidencing artifact may rate');
    const subject = this.p.fabric.resolve(input.subject).entry;
    const r = this.p.fabric.submit(
      {
        kind: 'Rating',
        namespace: this.p.namespaceOf(subject.canonicalId),
        name: `Rating of ${subject.definition.canonicalName} by ${actor.principal} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: { subject: subject.canonicalId, rater: actor.principal, magnitude: input.magnitude, scaleMin: input.scaleMin ?? 1, scaleMax: input.scaleMax ?? 5, purpose: input.purpose, evidence: evidence.canonicalId, comment: input.comment ?? null, context: ctx.record },
        provenance: { source: 'reputation-capability' },
        relationships: [{ type: 'RATES', target: subject.canonicalId }],
      },
      actor,
    );
    this.p.bus.emit({ type: 'trust.rated', subject: subject.canonicalId, actor, payload: { rating: r.canonicalId, magnitude: input.magnitude, purpose: input.purpose }, context: ctx.record });
    return this.p.fabric.transition(r.canonicalId, 'EFFECTIVE', actor);
  }

  /** Purpose-relative standing: Bayesian mean with prior weight, count and confidence. */
  standing(subjectRef: string, purpose: string, priorWeight = 2): { subject: string; purpose: string; mean: number | null; count: number; confidence: number; scale: [number, number] } {
    const subject = this.p.fabric.resolve(subjectRef).entry.canonicalId;
    const ratings = this.p.fabric.query({ kind: 'Rating', status: 'EFFECTIVE', contentPath: 'subject', contentEquals: subject, limit: 100_000 }).entries.filter((r) => r.content.purpose === purpose);
    if (!ratings.length) return { subject, purpose, mean: null, count: 0, confidence: 0, scale: [1, 5] };
    const min = Number(ratings[0].content.scaleMin);
    const max = Number(ratings[0].content.scaleMax);
    const mid = (min + max) / 2;
    const sum = ratings.reduce((s, r) => s + Number(r.content.magnitude), 0);
    const mean = (sum + priorWeight * mid) / (ratings.length + priorWeight);
    return { subject, purpose, mean: Math.round(mean * 1000) / 1000, count: ratings.length, confidence: Math.round((ratings.length / (ratings.length + priorWeight)) * 1000) / 1000, scale: [min, max] };
  }

  /**
   * Trust assessment: a Beta-distributed expectation that the subject acts
   * within constraint, from positive evidence (fulfilled contracts, active
   * entitlements honoured, high ratings) and negative evidence (breaches,
   * disputes resolved against, revocations).
   */
  assess(subjectRef: string, actor: Actor, ctx: ResolvedContext, constraint = 'acts within its stated obligations'): Entry {
    const subject = this.p.fabric.resolve(subjectRef).entry;
    const id = subject.canonicalId;
    const q = (kind: string, path: string) => this.p.fabric.query({ kind, contentPath: path, contentEquals: id, limit: 100_000 }).entries;
    const contracts = this.p.fabric.query({ kind: 'Contract', limit: 100_000 }).entries.filter((c) => ((c.content.parties as string[]) ?? []).includes(id));
    const fulfilled = contracts.filter((c) => c.lifecycle.status === 'FULFILLED').length;
    const breached = contracts.filter((c) => c.lifecycle.status === 'BREACHED' || (c.content.breaches as unknown[] | undefined)?.length).length;
    const ratings = q('Rating', 'subject');
    const good = ratings.filter((r) => Number(r.content.magnitude) > (Number(r.content.scaleMin) + Number(r.content.scaleMax)) / 2).length;
    const bad = ratings.length - good;
    const disputesAgainst = this.p.fabric.query({ kind: 'Dispute', status: 'RESOLVED', contentPath: 'respondent', contentEquals: id, limit: 100_000 }).entries.filter((d) => d.content.outcome === 'upheld').length;
    const revoked = q('Entitlement', 'holder').filter((e) => e.lifecycle.status === 'REVOKED').length;
    const alpha = 1 + fulfilled + good;
    const beta = 1 + breached + bad + disputesAgainst + revoked;
    const expectation = alpha / (alpha + beta);
    const variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1));
    const a = this.p.fabric.submit(
      {
        kind: 'TrustAssessment',
        namespace: this.p.namespaceOf(id),
        name: `Trust in ${subject.definition.canonicalName} @${this.p.clock.now()} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: { subject: id, constraint, expectation: Math.round(expectation * 1000) / 1000, uncertainty: Math.round(Math.sqrt(variance) * 1000) / 1000, evidence: { fulfilled, breached, goodRatings: good, badRatings: bad, disputesAgainst, revoked }, method: 'beta-expectation', valuer: actor.authority, purpose: 'trust', context: ctx.record },
        provenance: { source: 'trust-capability' },
        relationships: [{ type: 'MEASURES', target: id }],
      },
      actor,
    );
    this.p.bus.emit({ type: 'trust.assessed', subject: id, actor, payload: { assessment: a.canonicalId, expectation, purpose: 'trust' }, context: ctx.record });
    return this.p.fabric.transition(a.canonicalId, 'EFFECTIVE', actor);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disputes (Phase 004 §8.3, Phase 007 §5.7): open disputes suspend effect.
// ─────────────────────────────────────────────────────────────────────────────

export class DisputeService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.lifecycles.addFactProvider((entry) => ({ openDispute: this.openDisputes(entry.canonicalId).length > 0 }));
  }

  openDisputes(subjectId: string): Entry[] {
    return this.p.store
      .edgesTo(subjectId, 'DISPUTES')
      .map((e) => this.p.fabric.get(e.source))
      .filter((d): d is Entry => !!d && ['OPENED', 'UNDER-REVIEW', 'ESCALATED'].includes(d.lifecycle.status));
  }

  open(input: { subject: string; claim: string; respondent?: string; evidence?: string[] }, actor: Actor, ctx: ResolvedContext): Entry {
    const subject = this.p.fabric.resolve(input.subject).entry;
    const d = this.p.fabric.submit(
      {
        kind: 'Dispute',
        namespace: this.p.namespaceOf(subject.canonicalId),
        name: `Dispute over ${subject.definition.canonicalName} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: input.claim,
        content: { subject: subject.canonicalId, claimant: actor.principal, respondent: input.respondent ?? subject.ownership.canonicalOwner, claim: input.claim, evidence: input.evidence ?? [], context: ctx.record },
        provenance: { source: 'dispute-resolution-capability' },
        relationships: [{ type: 'DISPUTES', target: subject.canonicalId }],
      },
      actor,
    );
    this.p.bus.emit({ type: 'reg.dispute.opened', subject: subject.canonicalId, actor, payload: { dispute: d.canonicalId, claim: input.claim }, context: ctx.record });
    return d;
  }

  review(id: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'UNDER-REVIEW', actor, {}, (e) => {
      e.content.reviewer = actor.principal;
    });
  }

  escalate(id: string, to: string, reason: string, actor: Actor): Entry {
    const target = this.p.governance.body(to);
    const out = this.p.fabric.transition(id, 'ESCALATED', actor, { escalatedTo: target.name }, (e) => {
      e.content.escalatedTo = target.name;
      e.content.escalationReason = reason;
    });
    this.p.fabric.relate('ESCALATED-TO', id, target.canonicalId, actor);
    return out;
  }

  resolve(id: string, outcome: 'upheld' | 'rejected' | 'settled', rationale: string, actor: Actor, ctx?: ResolvedContext): Entry {
    const d = this.p.fabric.require(id);
    const decision = this.p.decisions.record({ subject: String(d.content.subject), authority: actor.authority, objective: 'dispute-resolution', alternatives: ['upheld', 'rejected', 'settled'], selection: outcome, rationale, context: ctx, outcome: 'EXECUTED' }, actor);
    const out = this.p.fabric.transition(id, 'RESOLVED', actor, { decision: decision.canonicalId }, (e) => {
      e.content.outcome = outcome;
      e.content.decision = decision.canonicalId;
    });
    this.p.bus.emit({ type: 'reg.dispute.resolved', subject: String(d.content.subject), actor, payload: { dispute: id, outcome, decision: decision.canonicalId }, context: ctx?.record ?? {} });
    return out;
  }

  dismiss(id: string, reason: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'DISMISSED', actor, { reason }, (e) => {
      e.content.dismissal = reason;
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resources, availability and allocation (C-19, V-RS-01..03).
// ─────────────────────────────────────────────────────────────────────────────

export interface AllocationRequest {
  holder: string;
  quantity: number;
  window: Interval;
  purpose: string;
  priority?: number;
  bid?: number;
  requestId?: string;
}

export class ResourceService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Allocation', (e) => {
      const c = e.content as Record<string, unknown>;
      const out = [];
      if (!c.purpose) out.push({ rule: 'C-19', message: 'scarcity is relative to a purpose; an allocation states it' });
      if (!(Number(c.quantity) > 0)) out.push({ rule: 'V-RS-01', message: 'allocated quantity must be positive' });
      return out;
    });
  }

  /** Assigns the Resource role: capacity as a Measurement plus declared allocation and contention policies. */
  defineResource(input: { entity: string; capacity: { magnitude: number; unit: string }; contentionPolicy: 'queue' | 'priority' | 'price' | 'auction' | 'lottery'; allocationPolicy?: string; scarcityContext?: string }, actor: Actor): Entry {
    this.p.measure.unit(input.capacity.unit);
    if (!['queue', 'priority', 'price', 'auction', 'lottery'].includes(input.contentionPolicy)) throw new ConstitutionalError('V-RS-03', 'contention policy must be declared (queue, priority, price, auction or lottery)');
    return this.p.fabric.amend(this.p.fabric.resolve(input.entity).entry.canonicalId, actor, (e) => {
      e.content.resource = { capacity: input.capacity, contentionPolicy: input.contentionPolicy, allocationPolicy: input.allocationPolicy ?? null, scarcityContext: input.scarcityContext ?? null };
    }, 'RESOURCE-ROLE', 'res.role.assigned');
  }

  private resourceOf(ref: string): { entry: Entry; capacity: number; unit: string; contention: string } {
    const e = this.p.fabric.resolve(ref).entry;
    const r = e.content.resource as { capacity: { magnitude: number; unit: string }; contentionPolicy: string } | undefined;
    if (!r) throw new ConstitutionalError('C-19', `${e.canonicalId} has not been assigned the Resource role (capacity + contention policy)`);
    return { entry: e, capacity: r.capacity.magnitude, unit: r.capacity.unit, contention: r.contentionPolicy };
  }

  allocations(resourceId: string, window?: Interval): Entry[] {
    return this.p.fabric
      .query({ kind: 'Allocation', status: ['ALLOCATED', 'COMMITTED'], contentPath: 'resource', contentEquals: resourceId, limit: 100_000 })
      .entries.filter((a) => !window || overlaps(a.content.window as Interval, window));
  }

  /** Peak concurrent load over a window (sweep line over allocations). */
  load(resourceId: string, window: Interval): number {
    const points: [number, number][] = [];
    for (const a of this.allocations(resourceId, window)) {
      const w = intersect(a.content.window as Interval, window)!;
      points.push([Date.parse(w.start), Number(a.content.quantity)]);
      points.push([w.end === null ? Infinity : Date.parse(w.end), -Number(a.content.quantity)]);
    }
    points.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    let cur = 0;
    let peak = 0;
    for (const [, d] of points) {
      cur += d;
      peak = Math.max(peak, cur);
    }
    return peak;
  }

  /** Free windows: segments of the requested window with their remaining capacity. */
  availability(resourceRef: string, window: Interval): { resource: string; capacity: number; unit: string; segments: { start: string; end: string | null; free: number }[] } {
    const r = this.resourceOf(resourceRef);
    const cuts = new Set<number>([Date.parse(window.start), window.end === null ? Infinity : Date.parse(window.end)]);
    for (const a of this.allocations(r.entry.canonicalId, window)) {
      const w = intersect(a.content.window as Interval, window)!;
      cuts.add(Date.parse(w.start));
      cuts.add(w.end === null ? Infinity : Date.parse(w.end));
    }
    const sorted = [...cuts].sort((a, b) => a - b);
    const segments: { start: string; end: string | null; free: number }[] = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const seg: Interval = { start: new Date(sorted[i]).toISOString(), end: sorted[i + 1] === Infinity ? null : new Date(sorted[i + 1]).toISOString() };
      const used = this.allocations(r.entry.canonicalId, seg).reduce((s, a) => s + Number(a.content.quantity), 0);
      segments.push({ ...seg, free: r.capacity - used });
    }
    return { resource: r.entry.canonicalId, capacity: r.capacity, unit: r.unit, segments };
  }

  /**
   * Resolves contention among requests under the resource's declared policy
   * (V-RS-03) and records each granted Allocation. Refused requests are
   * recorded decisions, never silent drops.
   */
  allocate(resourceRef: string, requests: AllocationRequest[], actor: Actor, ctx: ResolvedContext): { granted: Entry[]; refused: { request: AllocationRequest; reason: string }[] } {
    return this.p.store.tx(() => {
      const r = this.resourceOf(resourceRef);
      const ordered = [...requests].map((q, i) => ({ ...q, requestId: q.requestId ?? `req-${i}` }));
      switch (r.contention) {
        case 'priority':
          ordered.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.requestId.localeCompare(b.requestId));
          break;
        case 'price':
        case 'auction':
          ordered.sort((a, b) => (b.bid ?? 0) - (a.bid ?? 0) || a.requestId.localeCompare(b.requestId));
          break;
        case 'lottery': {
          const rnd = seededRandom(parseInt(hashValue(ordered.map((q) => q.requestId)).slice(0, 8), 16));
          for (let i = ordered.length - 1; i > 0; i--) {
            const j = Math.floor(rnd() * (i + 1));
            [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
          }
          break;
        }
        default:
          break;
      }
      const granted: Entry[] = [];
      const refused: { request: AllocationRequest; reason: string }[] = [];
      for (const q of ordered) {
        const peak = this.load(r.entry.canonicalId, q.window);
        if (peak + q.quantity > r.capacity) {
          refused.push({ request: q, reason: `capacity ${r.capacity} ${r.unit} exceeded in window (load ${peak}) under ${r.contention} policy` });
          this.p.decisions.record({ subject: r.entry.canonicalId, authority: actor.authority, objective: 'allocation', alternatives: ['GRANT', 'REFUSE'], selection: 'REFUSE', rationale: refused[refused.length - 1].reason, context: ctx }, actor);
          continue;
        }
        const a = this.p.fabric.submit(
          {
            kind: 'Allocation',
            namespace: this.p.namespaceOf(r.entry.canonicalId),
            name: `Allocation ${q.requestId} of ${r.entry.definition.canonicalName} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
            statement: '',
            content: { resource: r.entry.canonicalId, holder: q.holder, quantity: q.quantity, unit: r.unit, window: q.window, purpose: q.purpose, contentionPolicy: r.contention, priority: q.priority ?? null, bid: q.bid ?? null, context: ctx.record },
            provenance: { source: 'resource-capability' },
            relationships: [{ type: 'ALLOCATES', target: r.entry.canonicalId }],
          },
          actor,
        );
        granted.push(a);
        this.p.bus.emit({ type: 'res.allocated', subject: r.entry.canonicalId, actor, payload: { allocation: a.canonicalId, quantity: q.quantity, window: q.window }, context: ctx.record });
      }
      return { granted, refused };
    });
  }

  commit(allocationId: string, actor: Actor): Entry {
    return this.p.fabric.transition(allocationId, 'COMMITTED', actor);
  }
  consume(allocationId: string, actor: Actor): Entry {
    return this.p.fabric.transition(allocationId, 'CONSUMED', actor);
  }
  release(allocationId: string, actor: Actor): Entry {
    const out = this.p.fabric.transition(allocationId, 'RELEASED', actor);
    this.p.bus.emit({ type: 'res.released', subject: String(out.content.resource), actor, payload: { allocation: allocationId } });
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow runtime (Action lifecycle, C-13): governed progression along a
// registered Flow or Lifecycle; compensation registered alongside.
// ─────────────────────────────────────────────────────────────────────────────

export class WorkflowService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  definitions(namespace?: string): { id: string; name: string; kind: string; steps: number; namespace: string }[] {
    const out: { id: string; name: string; kind: string; steps: number; namespace: string }[] = [];
    for (const kind of ['Flow', 'Lifecycle']) {
      for (const e of this.p.fabric.query({ kind, namespace, limit: 100_000 }).entries) out.push({ id: e.canonicalId, name: e.definition.canonicalName, kind, steps: this.stepsOf(e).length, namespace: e.classification.namespace });
    }
    return out;
  }

  stepsOf(def: Entry): string[] {
    if (def.kind === 'Flow') return (def.content.steps as string[]) ?? [];
    const lc = def.content.definition as { states: string[] } | undefined;
    return lc?.states ?? ((def.content.states as string[]) ?? []);
  }

  start(input: { definition: string; subject?: string; input?: Record<string, unknown>; compensations?: Record<string, string> }, actor: Actor, ctx: ResolvedContext): Entry {
    const def = this.p.fabric.resolve(input.definition).entry;
    const steps = this.stepsOf(def);
    if (steps.length === 0) throw new ConstitutionalError('UEL-002', `definition ${def.canonicalId} declares no steps; every workflow must have a terminal state`);
    const verdict = this.p.policy.enforce({ action: 'workflow.start', subject: def, actor, context: ctx });
    const wf = this.p.fabric.submit(
      {
        kind: 'WorkflowInstance',
        namespace: this.p.operationalNamespace(),
        name: `${def.definition.canonicalName} run #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: { definition: def.canonicalId, subject: input.subject ?? null, steps, position: 0, history: [], input: input.input ?? {}, compensations: input.compensations ?? {}, initiator: actor.principal, context: ctx.record, purpose: actor.purpose ?? def.definition.canonicalName },
        provenance: { source: 'workflow-capability' },
        relationships: [{ type: 'REFERENCES', target: def.canonicalId }],
      },
      actor,
    );
    this.p.fabric.transition(wf.canonicalId, 'AUTHORISED', actor, { policyPermits: verdict.decision === 'PERMIT' });
    const running = this.p.fabric.transition(wf.canonicalId, 'EXECUTING', actor);
    this.p.bus.emit({ type: 'wf.started', subject: wf.canonicalId, actor, payload: { definition: def.canonicalId, steps: steps.length, purpose: actor.purpose ?? def.definition.canonicalName }, context: ctx.record });
    return running;
  }

  /** Advances one step, recording who executed it with what result. Completes after the terminal step. */
  advance(id: string, result: Record<string, unknown>, actor: Actor): Entry {
    return this.p.store.tx(() => {
      const wf = this.p.fabric.require(id);
      if (wf.lifecycle.status !== 'EXECUTING') throw new ConstitutionalError('UCI-008', `workflow ${id} is ${wf.lifecycle.status}`);
      const steps = wf.content.steps as string[];
      const pos = Number(wf.content.position);
      const updated = this.p.fabric.transition(id, 'EXECUTING', actor, {}, (e) => {
        (e.content.history as unknown[]).push({ step: steps[pos], by: actor.principal, at: this.p.clock.now(), result });
        e.content.position = pos + 1;
      });
      this.p.bus.emit({ type: 'wf.advanced', subject: id, actor, payload: { step: steps[pos], position: pos + 1, of: steps.length, purpose: wf.content.purpose }, context: wf.content.context as Record<string, unknown> });
      if (pos + 1 >= steps.length) {
        const done = this.p.fabric.transition(id, 'COMPLETED', actor);
        this.p.bus.emit({ type: 'wf.completed', subject: id, actor, payload: { steps: steps.length, purpose: wf.content.purpose }, context: wf.content.context as Record<string, unknown> });
        return done;
      }
      return updated;
    });
  }

  fail(id: string, cause: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'FAILED', actor, { cause }, (e) => {
      e.content.failure = cause;
    }, 'wf.failed');
  }

  /** Runs the registered compensations of every executed step in reverse order. */
  compensate(id: string, cause: string, actor: Actor): Entry {
    return this.p.store.tx(() => {
      const wf = this.p.fabric.require(id);
      const history = (wf.content.history as { step: string }[]) ?? [];
      const comps = (wf.content.compensations as Record<string, string>) ?? {};
      const executed = [...history].reverse().map((h) => ({ step: h.step, compensation: comps[h.step] ?? `compensate:${h.step}` }));
      for (const c of executed) this.p.bus.emit({ type: 'wf.compensated', subject: id, actor, payload: { step: c.step, compensation: c.compensation, cause, purpose: wf.content.purpose }, context: wf.content.context as Record<string, unknown> });
      return this.p.fabric.transition(id, 'COMPENSATED', actor, { cause }, (e) => {
        e.content.compensated = executed;
        e.content.compensationCause = cause;
      });
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Notifications: governed outbox with deployment-contract channels.
// ─────────────────────────────────────────────────────────────────────────────

export class NotificationService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  notify(input: { recipient: string; message: string; subject?: string; channel?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const recipient = this.p.fabric.resolve(input.recipient).entry.canonicalId;
    const n = this.p.fabric.submit(
      {
        kind: 'Notification',
        namespace: this.p.operationalNamespace(),
        name: `Notification to ${recipient} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: { recipient, message: input.message, subject: input.subject ?? null, channel: input.channel ?? 'outbox', context: ctx.record, attempts: 0 },
        provenance: { source: 'notification-capability' },
        relationships: [{ type: 'REFERENCES', target: recipient, context: { role: 'recipient' } }],
      },
      actor,
    );
    this.p.bus.emit({ type: 'ntf.queued', subject: n.canonicalId, actor, payload: { recipient, channel: input.channel ?? 'outbox' }, context: ctx.record });
    return n;
  }

  outbox(recipient?: string): Entry[] {
    const all = this.p.fabric.query({ kind: 'Notification', limit: 10_000 }).entries;
    return recipient ? all.filter((n) => n.content.recipient === recipient) : all;
  }

  /**
   * Dispatches a queued notification. The channel's endpoint and credentials
   * come from the deployment contract (environment), never from metadata
   * (GN-S-03). The 'outbox' channel completes on recording.
   */
  async dispatch(id: string, actor: Actor): Promise<Entry> {
    const n = this.p.fabric.require(id);
    if (n.lifecycle.status === 'REQUESTED') this.p.fabric.transition(id, 'AUTHORISED', actor, { policyPermits: true });
    this.p.fabric.transition(id, 'EXECUTING', actor);
    const channel = String(n.content.channel);
    if (channel === 'outbox') {
      const out = this.p.fabric.transition(id, 'COMPLETED', actor);
      this.p.bus.emit({ type: 'ntf.dispatched', subject: id, actor, payload: { channel } });
      return out;
    }
    const endpoint = process.env[`UCOS_CHANNEL_${channel.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_URL`];
    const secret = process.env[`UCOS_CHANNEL_${channel.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`];
    if (!endpoint) return this.p.fabric.transition(id, 'FAILED', actor, { cause: `channel ${channel} has no endpoint in the deployment contract` }, (e) => (e.content.failure = 'no endpoint'), 'ntf.failed');
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) }, body: JSON.stringify({ id, recipient: n.content.recipient, message: n.content.message, subject: n.content.subject }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = this.p.fabric.transition(id, 'COMPLETED', actor);
      this.p.bus.emit({ type: 'ntf.dispatched', subject: id, actor, payload: { channel, status: res.status } });
      return out;
    } catch (err) {
      return this.p.fabric.transition(id, 'FAILED', actor, { cause: (err as Error).message }, (e) => (e.content.failure = (err as Error).message), 'ntf.failed');
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ordering (C-08/C-09 unified): temporal intervals, recurrence, spatial.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecurrenceScheme {
  freq: 'HOURLY' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval?: number;
  byWeekday?: number[];
  count?: number;
  until?: string;
  duration?: { magnitude: number; unit: string };
  exceptions?: string[];
}

export class OrderingService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  compare(a: string, b: string): -1 | 0 | 1 {
    const d = Date.parse(a) - Date.parse(b);
    return d < 0 ? -1 : d > 0 ? 1 : 0;
  }

  intersect(a: Interval, b: Interval): Interval | null {
    return intersect(a, b);
  }

  shift(instant: string, by: { magnitude: number; unit: string }): string {
    const seconds = this.p.measure.convert(by.magnitude, by.unit, 's').magnitude;
    return new Date(Date.parse(instant) + seconds * 1000).toISOString();
  }

  /** Expands a recurrence into half-open intervals; bounds are mandatory (V-TM-03). */
  expand(anchor: string, scheme: RecurrenceScheme, limit = 1000): Interval[] {
    if (scheme.count === undefined && !scheme.until) throw new ConstitutionalError('V-TM-03', 'recurrence bounds must be declared (count or until), never infinite by default');
    const durationMs = scheme.duration ? this.p.measure.convert(scheme.duration.magnitude, scheme.duration.unit, 's').magnitude * 1000 : 0;
    const step = scheme.interval ?? 1;
    const out: Interval[] = [];
    const exceptions = new Set((scheme.exceptions ?? []).map((x) => new Date(x).toISOString()));
    const until = scheme.until ? Date.parse(scheme.until) : Infinity;
    const cursor = new Date(anchor);
    let guard = 0;
    while (out.length < Math.min(scheme.count ?? Infinity, limit) && guard++ < 100_000) {
      if (cursor.getTime() >= until) break;
      const okDay = !scheme.byWeekday?.length || scheme.byWeekday.includes(cursor.getUTCDay());
      const iso = cursor.toISOString();
      if (okDay && !exceptions.has(iso)) out.push({ start: iso, end: durationMs ? new Date(cursor.getTime() + durationMs).toISOString() : iso });
      switch (scheme.freq) {
        case 'HOURLY':
          cursor.setUTCHours(cursor.getUTCHours() + step);
          break;
        case 'DAILY':
          cursor.setUTCDate(cursor.getUTCDate() + step);
          break;
        case 'WEEKLY':
          cursor.setUTCDate(cursor.getUTCDate() + (scheme.byWeekday?.length ? 1 : 7 * step));
          break;
        case 'MONTHLY':
          cursor.setUTCMonth(cursor.getUTCMonth() + step);
          break;
        case 'YEARLY':
          cursor.setUTCFullYear(cursor.getUTCFullYear() + step);
          break;
      }
    }
    return out;
  }

  /** Great-circle distance on a registered frame's ellipsoid mean radius. */
  distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }, frameRef = 'WGS84'): { magnitude: number; unit: string } {
    const frame = this.p.fabric.query({ kind: 'SpatialFrame', nameLike: frameRef, limit: 1 }).entries[0];
    const radius = Number(frame?.content.meanRadiusMetres ?? NaN);
    if (!isFinite(radius)) throw new ConstitutionalError('V-SP-01', `spatial frame ${frameRef} is not registered`);
    const rad = (x: number) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return { magnitude: 2 * radius * Math.asin(Math.sqrt(h)), unit: 'm' };
  }

  /** Ray-casting point-in-polygon over a ring of [lon, lat] pairs. */
  contains(ring: [number, number][], point: { lat: number; lon: number }): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > point.lat !== yj > point.lat && point.lon < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /**
   * Regions containing a point at an instant. Jurisdiction is a contextual
   * computation from geometry plus temporal validity — never a stored
   * attribute (Phase 007 §5.3, V-SP-03).
   */
  regionsAt(point: { lat: number; lon: number }, instant?: string): { id: string; name: string; jurisdiction: string | null }[] {
    const t = Date.parse(instant ?? this.p.clock.now());
    return this.p.fabric
      .query({ kind: 'Region', status: ['CERTIFIED', 'ADMISSIBLE'], limit: 100_000 })
      .entries.filter((r) => {
        const v = r.content.validity as Interval | undefined;
        if (v && !(Date.parse(v.start) <= t && (v.end === null || t < Date.parse(v.end)))) return false;
        const ring = (r.content.geometry as { ring?: [number, number][] } | undefined)?.ring;
        return !!ring && this.contains(ring, point);
      })
      .map((r) => ({ id: r.canonicalId, name: r.definition.canonicalName, jurisdiction: (r.content.jurisdiction as string) ?? null }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Contracts (C-30): mutually binding obligations between authorities.
// ─────────────────────────────────────────────────────────────────────────────

export class ContractService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
    p.lifecycles.addFactProvider((entry) => {
      if (entry.kind !== 'Contract') return {};
      const parties = (entry.content.parties as string[]) ?? [];
      const accepted = (entry.content.acceptances as { party: string }[]) ?? [];
      const obligations = (entry.content.obligations as { discharged?: boolean }[]) ?? [];
      return { allPartiesAccepted: parties.every((pt) => accepted.some((a) => a.party === pt)), obligationsDischarged: obligations.length > 0 && obligations.every((o) => o.discharged) };
    });
  }

  draft(input: { name: string; parties: string[]; obligations: { party: string; statement: string; dueBy?: string }[]; prohibitions?: string[]; terminationConditions?: string[]; namespace?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    if (input.parties.length < 2) throw new ConstitutionalError('C-30', 'a contract binds at least two authorities');
    for (const pt of input.parties) this.p.fabric.resolve(pt);
    const c = this.p.fabric.submit(
      {
        kind: 'Contract',
        namespace: input.namespace ?? this.p.operationalNamespace(),
        name: input.name,
        statement: `A mutually binding specification between ${input.parties.length} parties.`,
        content: { parties: input.parties.map((pt) => this.p.fabric.resolve(pt).entry.canonicalId), obligations: input.obligations.map((o, i) => ({ id: `OBL-${i + 1}`, ...o, discharged: false })), prohibitions: input.prohibitions ?? [], terminationConditions: input.terminationConditions ?? [], acceptances: [], breaches: [], context: ctx.record },
        provenance: { source: 'contract-capability' },
      },
      actor,
    );
    for (const pt of c.content.parties as string[]) this.p.fabric.relate('PARTY-TO', pt, c.canonicalId, actor);
    return c;
  }

  propose(id: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'PROPOSED', actor);
  }

  accept(id: string, party: string, actor: Actor): Entry {
    const c = this.p.fabric.require(id);
    const partyId = this.p.fabric.resolve(party).entry.canonicalId;
    if (!(c.content.parties as string[]).includes(partyId)) throw new ConstitutionalError('C-30', `${partyId} is not a party to ${id}`);
    const updated = this.p.fabric.amend(id, actor, (e) => {
      (e.content.acceptances as unknown[]).push({ party: partyId, by: actor.principal, at: this.p.clock.now() });
    }, 'ACCEPTANCE', 'contract.accepted');
    const parties = updated.content.parties as string[];
    const acc = updated.content.acceptances as { party: string }[];
    if (updated.lifecycle.status === 'PROPOSED' && parties.every((pt) => acc.some((a) => a.party === pt))) return this.p.fabric.transition(id, 'ACTIVE', actor, {}, undefined, 'contract.activated');
    return updated;
  }

  fulfil(id: string, obligationId: string, evidence: string, actor: Actor): Entry {
    const updated = this.p.fabric.amend(id, actor, (e) => {
      const o = (e.content.obligations as { id: string; discharged: boolean; evidence?: string }[]).find((x) => x.id === obligationId);
      if (!o) throw new ConstitutionalError('C-30', `obligation ${obligationId} is not part of ${id}`);
      o.discharged = true;
      o.evidence = evidence;
    }, 'DISCHARGE', 'contract.obligation.discharged');
    if ((updated.content.obligations as { discharged: boolean }[]).every((o) => o.discharged) && updated.lifecycle.status === 'ACTIVE') return this.p.fabric.transition(id, 'FULFILLED', actor, {}, undefined, 'contract.fulfilled');
    return updated;
  }

  breach(id: string, evidence: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'BREACHED', actor, { evidence }, (e) => {
      (e.content.breaches as unknown[]).push({ evidence, at: this.p.clock.now(), by: actor.principal });
    }, 'contract.breached');
  }

  remedy(id: string, remedy: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'ACTIVE', actor, { remedy }, (e) => {
      e.content.remedy = remedy;
    }, 'contract.remedied');
  }

  terminate(id: string, cause: string, actor: Actor): Entry {
    return this.p.fabric.transition(id, 'TERMINATED', actor, { cause }, (e) => {
      e.content.termination = cause;
    }, 'contract.terminated');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Risk policy: expected loss with uncertainty (UMQSOL-008: every forecast
// includes uncertainty), plus flags from registered risk rules.
// ─────────────────────────────────────────────────────────────────────────────

export class RiskService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }

  assess(input: { subject: string; exposures: { name: string; magnitude: number; unit: string; probability: number; uncertainty?: number }[]; policies?: string[] }, actor: Actor, ctx: ResolvedContext): { decision: Entry; expectedLoss: number; standardDeviation: number; unit: string; flags: string[] } {
    if (!input.exposures.length) throw new ConstitutionalError('UMQSOL-007', 'risk assessment requires explicitly represented exposures');
    const unit = input.exposures[0].unit;
    let mean = 0;
    let variance = 0;
    for (const x of input.exposures) {
      if (x.probability < 0 || x.probability > 1) throw new ConstitutionalError('UMQSOI-007', `probability of ${x.name} must lie in [0, 1]`);
      const m = x.unit === unit ? x.magnitude : this.p.measure.convert(x.magnitude, x.unit, unit, ctx).magnitude;
      const sd = (x.uncertainty ?? 0) * (x.unit === unit ? 1 : m / x.magnitude);
      mean += x.probability * m;
      variance += x.probability * (sd ** 2 + m ** 2) - (x.probability * m) ** 2;
    }
    const flags: string[] = [];
    const subject = this.p.fabric.resolve(input.subject).entry;
    const policyIds = new Set([...(input.policies ?? []), ...this.p.taxonomy.policiesFor(subject.canonicalId).map((x) => x.policy)]);
    for (const pid of policyIds) {
      const pol = this.p.fabric.tryResolve(pid)?.entry;
      for (const rule of (pol?.content.riskRules as { when: string; flag: string }[]) ?? []) if (this.p.expressions.boolean(rule.when, { expectedLoss: mean, standardDeviation: Math.sqrt(Math.max(variance, 0)), ...ctx.bindings })) flags.push(rule.flag);
    }
    const sd = Math.sqrt(Math.max(variance, 0));
    const decision = this.p.decisions.record({ subject: subject.canonicalId, authority: actor.authority, objective: 'risk-assessment', alternatives: input.exposures.map((x) => x.name), selection: { expectedLoss: mean, standardDeviation: sd, unit, flags }, rationale: 'expected loss Σ p·m with variance Σ p(σ²+m²) − (p·m)²', context: ctx, confidence: mean === 0 ? 1 : Math.max(0, 1 - sd / (mean + sd)) }, actor);
    this.p.bus.emit({ type: 'risk.assessed', subject: subject.canonicalId, actor, payload: { expectedLoss: mean, standardDeviation: sd, unit, flags }, context: ctx.record });
    return { decision, expectedLoss: mean, standardDeviation: sd, unit, flags };
  }
}
