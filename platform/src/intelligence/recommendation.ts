import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { evaluate } from '../rules/expression.ts';

export interface Criterion {
  expression: string;
  weight: number;
  direction?: 'maximize' | 'minimize';
}

/**
 * Recommendation Engine (Phase 010 §5.5). A recommendation is a Value
 * relationship — who values what, for which purpose, in which context, on
 * what evidence — and is never presented as fact. No purpose, no
 * recommendation.
 */
export class RecommendationEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  /** Scores candidates by registered or supplied criteria; records each result as a Value. */
  recommend(input: { purpose: string; candidates: string[]; criteria?: Criterion[]; objective?: string; limit?: number; record?: boolean }, actor: Actor, ctx: ResolvedContext): { purpose: string; recommendations: { subject: string; name: string; magnitude: number; basis: Record<string, number>; value: string | null }[] } {
    if (!input.purpose?.trim()) throw new ConstitutionalError('Phase010-§3.3', 'a recommendation requires a purpose; value is purpose-relative');
    let criteria = input.criteria ?? [];
    if (input.objective) {
      const obj = this.p.fabric.resolve(input.objective).entry;
      criteria = (obj.content.criteria as Criterion[]) ?? criteria;
    }
    if (!criteria.length) throw new ConstitutionalError('Phase010-§5.5', 'no valuation criteria: register an objective with criteria or supply them');
    const rows = input.candidates.map((ref) => {
      const e = this.p.fabric.resolve(ref).entry;
      const { scope, functions } = this.p.taxonomy.scopeFor(e, ctx);
      const basis: Record<string, number> = {};
      let magnitude = 0;
      for (const c of criteria) {
        let v = 0;
        try {
          v = Number(evaluate(c.expression, { scope: { ...scope, ...ctx.bindings }, functions })) || 0;
        } catch {
          v = 0;
        }
        const signed = (c.direction === 'minimize' ? -1 : 1) * c.weight * v;
        basis[c.expression] = Math.round(signed * 1e6) / 1e6;
        magnitude += signed;
      }
      return { subject: e.canonicalId, name: e.definition.canonicalName, magnitude: Math.round(magnitude * 1e6) / 1e6, basis, value: null as string | null };
    });
    rows.sort((a, b) => b.magnitude - a.magnitude || a.subject.localeCompare(b.subject));
    const top = rows.slice(0, input.limit ?? 10);
    if (input.record !== false) {
      for (const r of top) {
        const v = this.p.measure.value({ subject: r.subject, valuer: actor.authority, purpose: `recommendation:${input.purpose}`, magnitude: r.magnitude, unit: '1', basis: JSON.stringify(r.basis), confidence: 1 }, actor, ctx);
        r.value = v.canonicalId;
      }
    }
    this.p.bus.emit({ type: 'int.recommendation.issued', subject: top[0]?.subject ?? null, actor, payload: { purpose: input.purpose, count: top.length }, context: { ...ctx.record, purpose: input.purpose } });
    return { purpose: input.purpose, recommendations: top };
  }

  /** Withdraws a recommendation whose evidence no longer holds (Phase 010 §5.5 degrade). */
  withdraw(valueId: string, reason: string, actor: Actor): Entry {
    const out = this.p.fabric.transition(valueId, 'WITHDRAWN', actor, { reason });
    this.p.bus.emit({ type: 'int.recommendation.withdrawn', subject: valueId, actor, payload: { reason, purpose: 'recommendation' }, context: { purpose: 'recommendation', reality: 'actual' } });
    return out;
  }

  /**
   * MATCH: offers whose subject's facets and roles satisfy a need and whose
   * quoted consideration (in the requester's context) fits a budget.
   */
  matchOffers(input: { need: Record<string, unknown>; purpose: string; limit: number }, actor: Actor, ctx: ResolvedContext): { purpose: string; matches: { offer: string; subject: string; name: string; magnitude: number; quote: { magnitude: number; unit: string } | null; reasons: string[] }[] } {
    const need = input.need as { facets?: Record<string, string>; roles?: string[]; budget?: { magnitude: number; unit: string }; query?: string };
    const offers = this.p.fabric.query({ kind: 'Offer', status: 'ACTIVE', limit: 10_000 }).entries;
    const textHits = need.query ? new Set(this.p.discovery.search(need.query, { kinds: ['ExchangeableEntity'], limit: 200 }).results.map((r) => r.id)) : null;
    const matches: { offer: string; subject: string; name: string; magnitude: number; quote: { magnitude: number; unit: string } | null; reasons: string[] }[] = [];
    for (const o of offers) {
      const subject = this.p.fabric.get(String(o.content.subjectRef));
      if (!subject) continue;
      const reasons: string[] = [];
      let score = 0;
      const facets = this.p.commerce.facetScope((subject.content.facetBindings as Record<string, string>) ?? {});
      for (const [k, v] of Object.entries(need.facets ?? {})) {
        const have = facets[k] ?? facets[this.p.commerce.facets().find((f) => f.name.toLowerCase() === k.toLowerCase())?.alias ?? ''];
        if (have === v) {
          score += 1;
          reasons.push(`${k}=${v}`);
        } else score -= 2;
      }
      const roles = this.p.taxonomy.effectiveAssertions(subject.canonicalId).map((a) => String(a.content.taxonName));
      for (const r of need.roles ?? []) {
        if (roles.includes(r)) {
          score += 1;
          reasons.push(`role ${r}`);
        } else score -= 2;
      }
      if (textHits) {
        if (textHits.has(subject.canonicalId)) {
          score += 1;
          reasons.push('matches query');
        } else score -= 1;
      }
      let quote: { magnitude: number; unit: string } | null = null;
      try {
        const q = this.p.commerce.quote(o.canonicalId, actor, undefined, ctx);
        quote = q.total;
        if (need.budget && quote) {
          const inBudgetUnit = quote.unit === need.budget.unit ? quote.magnitude : this.p.measure.convert(quote.magnitude, quote.unit, need.budget.unit, ctx).magnitude;
          if (inBudgetUnit <= need.budget.magnitude) {
            score += 1 + (need.budget.magnitude - inBudgetUnit) / Math.max(need.budget.magnitude, 1);
            reasons.push(`within budget (${inBudgetUnit} ${need.budget.unit})`);
          } else score -= 3;
        }
      } catch (e) {
        reasons.push(`not quotable here: ${(e as Error).message.slice(0, 80)}`);
        score -= 5;
      }
      if (score > 0) matches.push({ offer: o.canonicalId, subject: subject.canonicalId, name: subject.definition.canonicalName, magnitude: Math.round(score * 1000) / 1000, quote, reasons });
    }
    matches.sort((a, b) => b.magnitude - a.magnitude || a.offer.localeCompare(b.offer));
    const top = matches.slice(0, input.limit);
    this.p.bus.emit({ type: 'int.recommendation.issued', subject: top[0]?.offer ?? null, actor, payload: { purpose: input.purpose, matches: top.length }, context: { ...ctx.record, purpose: input.purpose } });
    return { purpose: input.purpose, matches: top };
  }
}
