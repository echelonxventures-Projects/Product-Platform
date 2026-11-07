import { randomUUID } from 'node:crypto';
import type { Store, EventRow } from './store.ts';
import type { Clock } from './clock.ts';
import { ConstitutionalError } from './errors.ts';

/** The accountable party behind every action (UCI-006). */
export interface Actor {
  /** Canonical id of the acting principal. */
  principal: string;
  /** Governance body under whose authority the action is taken. */
  authority: string;
  /** Beneficial principal when acting on behalf of another (Phase 007 §5.1). */
  onBehalfOf?: string;
  /** Registered purpose — mandatory for autonomous actions (UCI-020). */
  purpose?: string;
  /** Whether the actor is an autonomous intelligence capability. */
  autonomous?: boolean;
}

export interface PlatformEvent {
  eventId: string;
  seq: number;
  type: string;
  subject: string | null;
  actor: string;
  authority: string;
  occurredAt: string;
  reality: string;
  canonical: boolean;
  causationId: string | null;
  correlationId: string | null;
  payload: unknown;
  context: unknown;
}

export interface EmitInput {
  type: string;
  subject?: string | null;
  payload?: unknown;
  actor: Actor;
  context?: { reality?: string; [k: string]: unknown };
  causationId?: string | null;
  correlationId?: string | null;
}

type Listener = (e: PlatformEvent) => void;

/**
 * Event emission and the in-process bus. Every event carries temporal
 * context (UCI-007), an accountable actor and authority (UCI-006) and its
 * Reality dimension, so simulated events are structurally non-canonical
 * (Phase 007 §5.9, Phase 009 §6.3).
 */
export class EventBus {
  private readonly store: Store;
  private readonly clock: Clock;
  private readonly listeners = new Set<Listener>();
  private pending: PlatformEvent[] = [];
  private dispatching = false;

  constructor(store: Store, clock: Clock) {
    this.store = store;
    this.clock = clock;
    // Listeners only ever see committed events: dispatch waits for the
    // outermost commit, and events rolled back with a savepoint are dropped.
    store.onCommit(() => this.flushCommitted());
    store.onRollback(() => {
      this.pending = [];
    });
  }

  private flushCommitted(): void {
    if (!this.pending.length) return;
    const ids = this.pending.map((e) => e.eventId);
    const present = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      for (const r of this.store.db.prepare(`SELECT event_id FROM events WHERE event_id IN (${chunk.map(() => '?').join(',')})`).all(...chunk) as { event_id: string }[]) present.add(r.event_id);
    }
    this.pending = this.pending.filter((e) => present.has(e.eventId));
    this.flush();
  }

  emit(input: EmitInput): PlatformEvent {
    if (!input.actor?.principal || !input.actor.authority) {
      throw new ConstitutionalError('V-EV-04', `event ${input.type} lacks an accountable actor and authority`);
    }
    const reality = String(input.context?.reality ?? 'actual');
    // Every action by an actor with a registered purpose carries it (UCI-020).
    const context = input.actor.purpose && !input.context?.purpose ? { ...(input.context ?? { reality }), purpose: input.actor.purpose } : input.context;
    const row = this.store.appendEvent({
      event_id: randomUUID(),
      type: input.type,
      subject: input.subject ?? null,
      actor: input.actor.principal,
      authority: input.actor.authority,
      occurred_at: this.clock.now(),
      reality,
      canonical: reality === 'actual' ? 1 : 0,
      causation_id: input.causationId ?? null,
      correlation_id: input.correlationId ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      context: JSON.stringify(context ?? { reality }),
    });
    const evt = toEvent(row);
    this.pending.push(evt);
    this.flush();
    return evt;
  }

  private flush(): void {
    if (this.dispatching || this.store.inTransaction()) return;
    this.dispatching = true;
    try {
      while (this.pending.length > 0) {
        const evt = this.pending.shift()!;
        for (const l of this.listeners) {
          try {
            l(evt);
          } catch (err) {
            process.emitWarning(`event listener failed on ${evt.type}: ${(err as Error).message}`);
          }
        }
      }
    } finally {
      this.dispatching = false;
    }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  query(filter: { subject?: string; type?: string; correlationId?: string; afterSeq?: number; limit?: number }): PlatformEvent[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (filter.subject) {
      where.push('subject = ?');
      args.push(filter.subject);
    }
    if (filter.type) {
      where.push(filter.type.endsWith('*') ? 'type LIKE ?' : 'type = ?');
      args.push(filter.type.endsWith('*') ? filter.type.slice(0, -1) + '%' : filter.type);
    }
    if (filter.correlationId) {
      where.push('correlation_id = ?');
      args.push(filter.correlationId);
    }
    if (filter.afterSeq !== undefined) {
      where.push('seq > ?');
      args.push(filter.afterSeq);
    }
    const limit = Math.min(filter.limit ?? 200, 5000);
    const sql = `SELECT * FROM events ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY seq DESC LIMIT ${limit}`;
    return (this.store.db.prepare(sql).all(...args) as unknown as EventRow[]).map(toEvent);
  }

  count(): number {
    return (this.store.prepare('SELECT COUNT(*) n FROM events').get() as { n: number }).n;
  }
}

export function toEvent(row: EventRow): PlatformEvent {
  return {
    eventId: row.event_id,
    seq: row.seq,
    type: row.type,
    subject: row.subject,
    actor: row.actor,
    authority: row.authority,
    occurredAt: row.occurred_at,
    reality: row.reality,
    canonical: row.canonical === 1,
    causationId: row.causation_id,
    correlationId: row.correlation_id,
    payload: JSON.parse(row.payload),
    context: JSON.parse(row.context),
  };
}
