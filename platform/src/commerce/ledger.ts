import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';

/**
 * Settlement capability. Accounts and postings are registered artifacts;
 * every transfer is two postings that sum to zero, postings are immutable,
 * and correction is a compensating transfer (V-EV-05). Postings created in a
 * non-actual Reality context are recorded but never count toward actual
 * balances (CX-S-04, IN-S-04).
 */
export class Ledger {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('LedgerPosting', (e) => {
      const c = e.content as Record<string, unknown>;
      const out = [];
      if (typeof c.amount !== 'number' || !isFinite(c.amount)) out.push({ rule: 'C-FR-01', message: 'posting amount must be a finite number' });
      if (!c.account || !this.p.fabric.exists(String(c.account))) out.push({ rule: 'UCI-005', message: 'posting account does not resolve' });
      if (!c.transferId) out.push({ rule: 'UCI-004', message: 'posting must belong to a balanced transfer' });
      return out;
    });
    this.p.validation.registerKind('Account', (e) => (e.content.holder && e.content.unit ? [] : [{ rule: 'UCI-002', message: 'an account has one holder and one unit' }]));
  }

  account(holder: string, unit: string, actor: Actor, namespace?: string): Entry {
    this.p.measure.unit(unit);
    const ns = namespace ?? this.p.operationalNamespace();
    const name = `Account ${holder} ${unit}`;
    const existing = this.p.store.headByQualifiedName(`${ns}:Account:${name}`);
    if (existing) return JSON.parse(existing.body) as Entry;
    return this.p.fabric.submit(
      { kind: 'Account', namespace: ns, name, statement: '', content: { holder, unit }, provenance: { source: 'settlement-capability' }, relationships: this.p.fabric.exists(holder) ? [{ type: 'REFERENCES', target: holder, context: { role: 'holder' } }] : [] },
      actor,
    );
  }

  /** Posts a balanced transfer between two holders in one registered unit. */
  transfer(input: { from: string; to: string; magnitude: number; unit: string; reference?: string; memo?: string; namespace?: string }, actor: Actor, ctx: ResolvedContext): { transferId: string; postings: Entry[]; simulated: boolean } {
    if (!(input.magnitude > 0)) throw new ConstitutionalError('C-FR-01', 'a transfer magnitude must be positive');
    return this.p.store.tx(() => {
      const transferId = `TRF-${this.p.fabric.newCorrelationId()}`;
      const simulated = ctx.reality !== 'actual';
      const legs: [string, number][] = [
        [input.from, -input.magnitude],
        [input.to, input.magnitude],
      ];
      const postings = legs.map(([holder, amount]) => {
        const acct = this.account(holder, input.unit, actor, input.namespace);
        const posting = this.p.fabric.submit(
          {
            kind: 'LedgerPosting',
            namespace: input.namespace ?? this.p.operationalNamespace(),
            name: `${transferId} ${amount > 0 ? 'credit' : 'debit'} ${holder}`,
            statement: '',
            content: { account: acct.canonicalId, holder, amount, unit: input.unit, transferId, reference: input.reference ?? null, memo: input.memo ?? null, reality: ctx.reality, simulated, context: ctx.record },
            provenance: { source: 'settlement-capability' },
            relationships: [{ type: 'REFERENCES', target: acct.canonicalId, context: { role: 'account' } }],
          },
          actor,
        );
        if (input.reference && this.p.fabric.exists(input.reference)) this.p.fabric.relate('SETTLES', posting.canonicalId, input.reference, actor);
        return this.p.fabric.transition(posting.canonicalId, 'POSTED', actor);
      });
      this.p.bus.emit({ type: 'settlement.transfer.posted', subject: input.reference ?? null, actor, payload: { transferId, from: input.from, to: input.to, magnitude: input.magnitude, unit: input.unit, simulated }, context: ctx.record });
      return { transferId, postings, simulated };
    });
  }

  /** Compensating transfer: the original postings remain; their effect is reversed. */
  reverse(transferId: string, cause: string, actor: Actor, ctx: ResolvedContext): { transferId: string; postings: Entry[] } {
    const legs = this.postingsOf(transferId);
    if (legs.length !== 2) throw new ConstitutionalError('UCI-005', `transfer ${transferId} does not resolve to a balanced pair`);
    const debit = legs.find((l) => Number(l.content.amount) < 0)!;
    const credit = legs.find((l) => Number(l.content.amount) > 0)!;
    const out = this.transfer({ from: String(credit.content.holder), to: String(debit.content.holder), magnitude: Number(credit.content.amount), unit: String(credit.content.unit), reference: String(credit.content.reference ?? ''), memo: `compensates ${transferId}: ${cause}` }, actor, ctx);
    this.p.bus.emit({ type: 'settlement.transfer.compensated', subject: transferId, actor, payload: { compensatedBy: out.transferId, cause }, context: ctx.record });
    return out;
  }

  postingsOf(transferId: string): Entry[] {
    return this.p.fabric.query({ kind: 'LedgerPosting', contentPath: 'transferId', contentEquals: transferId, limit: 10 }).entries;
  }

  balance(holder: string, unit: string, namespace?: string): { holder: string; unit: string; balance: number; postings: number } {
    const ns = namespace ?? this.p.operationalNamespace();
    const acct = this.p.store.headByQualifiedName(`${ns}:Account:Account ${holder} ${unit}`);
    if (!acct) return { holder, unit, balance: 0, postings: 0 };
    const rows = this.p.store
      .prepare("SELECT json_extract(body, '$.content.amount') amount FROM heads WHERE kind = 'LedgerPosting' AND status = 'POSTED' AND json_extract(body, '$.content.account') = ? AND json_extract(body, '$.content.simulated') = 0")
      .all(acct.canonical_id) as { amount: number }[];
    const minor = Number(this.p.measure.unit(unit)!.content.minorUnits ?? 6);
    const balance = Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 10 ** minor) / 10 ** minor;
    return { holder, unit, balance, postings: rows.length };
  }

  settledAmount(reference: string): Record<string, number> {
    const rows = this.p.store
      .prepare("SELECT json_extract(body, '$.content.amount') amount, json_extract(body, '$.content.unit') unit FROM heads WHERE kind = 'LedgerPosting' AND status = 'POSTED' AND json_extract(body, '$.content.reference') = ? AND json_extract(body, '$.content.simulated') = 0 AND json_extract(body, '$.content.amount') > 0")
      .all(reference) as { amount: number; unit: string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.unit] = (out[r.unit] ?? 0) + Number(r.amount);
    return out;
  }
}
