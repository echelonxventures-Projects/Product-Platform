import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { evaluateBoolean } from '../rules/expression.ts';

export interface ValueInput {
  subject: string;
  valuer: string;
  purpose: string;
  magnitude: number;
  unit: string;
  basis?: string;
  confidence?: number;
  contextConditions?: string[];
  validity?: { start: string; end: string | null };
  quoteOf?: string;
  /** For exchange-rate valuations: the currency being valued. */
  fromUnit?: string;
}

/**
 * Measurement (C-21), Unit and Value (C-20) services. A magnitude without a
 * registered unit is meaningless (V-MS-01); conversion follows registered
 * paths only (V-MS-04). Value is a four-place relation — valuer, subject,
 * purpose, context — never a field on the thing valued (V-VL-04).
 */
export class MeasureService {
  private readonly p: Platform;
  private unitIndex = new Map<string, Entry>();
  private conversions: { from: string; to: string; factor: number; offset: number }[] = [];

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('Measurement', (e) => {
      const c = e.content as Record<string, unknown>;
      const out = [];
      if (!this.unit(String(c.unit ?? ''), false)) out.push({ rule: 'V-MS-01', message: `unit ${String(c.unit)} is not registered` });
      if (!c.method || !this.p.fabric.exists(String(c.method))) out.push({ rule: 'V-MS-02', message: `method ${String(c.method)} is not registered` });
      if (typeof c.magnitude !== 'number' || !isFinite(c.magnitude)) out.push({ rule: 'C-21', message: 'magnitude must be a finite number' });
      const method = c.method ? this.p.fabric.tryResolve(String(c.method))?.entry : undefined;
      if (method?.content.admitsUncertainty === true && c.uncertainty === undefined) out.push({ rule: 'V-MS-03', message: 'the method admits uncertainty; uncertainty must be stated' });
      return out;
    });
    this.p.validation.registerKind('Value', (e) => {
      const c = e.content as Record<string, unknown>;
      const out = [];
      if (!c.valuer) out.push({ rule: 'V-VL-01', message: 'a value requires a valuer' });
      if (!c.purpose) out.push({ rule: 'V-VL-01', message: 'a value requires a purpose' });
      if (typeof c.magnitude !== 'number') out.push({ rule: 'V-VL-02', message: 'magnitude must be a number' });
      if (!this.unit(String(c.unit ?? ''), false)) out.push({ rule: 'V-VL-02', message: `unit ${String(c.unit)} is not registered (C-US-04)` });
      if (!c.context) out.push({ rule: 'V-VL-03', message: 'a value is conditioned by a context' });
      return out;
    });
  }

  hydrate(): void {
    this.unitIndex.clear();
    for (const u of this.p.fabric.iterate('Unit')) {
      this.unitIndex.set(String(u.content.symbol), u);
      this.unitIndex.set(u.canonicalId, u);
    }
    this.conversions = [];
    for (const c of this.p.fabric.iterate('UnitConversion')) {
      if (!['CERTIFIED', 'ADMISSIBLE'].includes(c.lifecycle.status)) continue;
      const from = this.unit(String(c.content.from))!;
      const to = this.unit(String(c.content.to))!;
      this.conversions.push({ from: String(from.content.symbol), to: String(to.content.symbol), factor: Number(c.content.factor), offset: Number(c.content.offset ?? 0) });
    }
  }

  unit(ref: string, required = true): Entry | undefined {
    const u = this.unitIndex.get(ref) ?? this.p.fabric.tryResolve(ref)?.entry;
    if (!u && required) throw new ConstitutionalError('V-MS-01', `unit ${ref} is not registered`);
    return u && u.kind === 'Unit' ? u : undefined;
  }

  units(dimension?: string): Entry[] {
    return [...new Set(this.unitIndex.values())].filter((u) => !dimension || u.content.dimension === dimension);
  }

  /**
   * Converts along registered conversion paths (V-MS-04). Linear conversions
   * compose as y = a·x + b; the path search is over the registered graph in
   * both directions.
   */
  convert(magnitude: number, fromRef: string, toRef: string, ctx?: ResolvedContext): { magnitude: number; path: string[]; via: 'identity' | 'registered-conversion' | 'valuation' } {
    const from = this.unit(fromRef)!;
    const to = this.unit(toRef)!;
    const f = String(from.content.symbol);
    const t = String(to.content.symbol);
    if (f === t) return { magnitude, path: [f], via: 'identity' };
    if (from.content.dimension !== to.content.dimension) throw new ConstitutionalError('V-MS-04', `cannot convert ${f} (${String(from.content.dimension)}) to ${t} (${String(to.content.dimension)})`);
    if (from.content.dimension === 'currency') return this.convertCurrency(magnitude, f, t, ctx);
    type Step = { unit: string; a: number; b: number; path: string[] };
    const queue: Step[] = [{ unit: f, a: 1, b: 0, path: [f] }];
    const seen = new Set([f]);
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.unit === t) return { magnitude: cur.a * magnitude + cur.b, path: cur.path, via: 'registered-conversion' };
      for (const c of this.conversions) {
        if (c.from === cur.unit && !seen.has(c.to)) {
          seen.add(c.to);
          queue.push({ unit: c.to, a: cur.a * c.factor, b: cur.b * c.factor + c.offset, path: [...cur.path, c.to] });
        } else if (c.to === cur.unit && !seen.has(c.from)) {
          seen.add(c.from);
          queue.push({ unit: c.from, a: cur.a / c.factor, b: (cur.b - c.offset) / c.factor, path: [...cur.path, c.from] });
        }
      }
    }
    throw new ConstitutionalError('V-MS-04', `no registered conversion path from ${f} to ${t}; an unregistered conversion is a fabrication`);
  }

  /** Currency conversion is a registered exchange-rate valuation, valid in context. */
  private convertCurrency(magnitude: number, f: string, t: string, ctx?: ResolvedContext): { magnitude: number; path: string[]; via: 'valuation' } {
    const rates = this.p.fabric.query({ kind: 'Value', status: ['QUOTED', 'EFFECTIVE'], contentPath: 'purpose', contentEquals: 'exchange-rate', limit: 10_000 }).entries;
    const instant = String(ctx?.bindings.Temporal?.instant ?? this.p.clock.now());
    const valid = (r: Entry) => {
      const v = r.content.validity as { start: string; end: string | null } | undefined;
      return !v || (Date.parse(v.start) <= Date.parse(instant) && (v.end === null || Date.parse(instant) < Date.parse(v.end)));
    };
    const direct = rates.find((r) => r.content.fromUnit === f && r.content.unit === t && valid(r));
    if (direct) return { magnitude: magnitude * Number(direct.content.magnitude), path: [f, t], via: 'valuation' };
    const inverse = rates.find((r) => r.content.fromUnit === t && r.content.unit === f && valid(r));
    if (inverse) return { magnitude: magnitude / Number(inverse.content.magnitude), path: [f, t], via: 'valuation' };
    throw new ConstitutionalError('V-MS-04', `no exchange-rate valuation from ${f} to ${t} is valid at ${instant}; currency conversion requires a registered Value`);
  }

  /** Records a Measurement: OBSERVED → VALIDATED when unit and method are registered. */
  record(input: { attribute: string; subject?: string; magnitude: number; unit: string; method: string; precision?: number; uncertainty?: number; observedAt?: string; instrument?: string; namespace?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const method = this.p.fabric.tryResolve(input.method)?.entry ?? this.p.fabric.query({ kind: 'Method', nameLike: input.method, limit: 1 }).entries[0];
    const m = this.p.fabric.submit(
      {
        kind: 'Measurement',
        namespace: input.namespace ?? this.p.operationalNamespace(),
        name: `${input.attribute} = ${input.magnitude} ${input.unit} @${input.observedAt ?? this.p.clock.now()} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: {
          attribute: input.attribute,
          subject: input.subject ?? null,
          magnitude: input.magnitude,
          unit: input.unit,
          method: method?.canonicalId ?? input.method,
          precision: input.precision ?? null,
          uncertainty: input.uncertainty,
          observedAt: input.observedAt ?? this.p.clock.now(),
          observer: actor.principal,
          instrument: input.instrument ?? null,
          context: ctx.record,
        },
        provenance: { source: 'measurement-capability' },
      },
      actor,
    );
    if (input.subject && this.p.fabric.exists(input.subject)) this.p.fabric.relate('MEASURES', m.canonicalId, input.subject, actor);
    return this.p.fabric.transition(m.canonicalId, 'VALIDATED', actor, { unitRegistered: true, methodRegistered: true });
  }

  /** Registers a Value relationship (valuer, subject, purpose, magnitude, unit, context). */
  value(input: ValueInput, actor: Actor, ctx: ResolvedContext, namespace?: string): Entry {
    this.unit(input.unit);
    const v = this.p.fabric.submit(
      {
        kind: 'Value',
        namespace: namespace ?? this.p.operationalNamespace(),
        name: `${input.purpose}: ${input.subject} = ${input.magnitude} ${input.unit} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
        statement: '',
        content: {
          subject: input.subject,
          valuer: input.valuer,
          purpose: input.purpose,
          magnitude: input.magnitude,
          unit: input.unit,
          basis: input.basis ?? null,
          confidence: input.confidence ?? 1,
          contextConditions: input.contextConditions ?? [],
          validity: input.validity ?? null,
          context: ctx.record,
          quoteOf: input.quoteOf ?? null,
          fromUnit: input.fromUnit ?? null,
        },
        provenance: { source: 'value-capability' },
      },
      actor,
    );
    if (this.p.fabric.exists(input.subject)) this.p.fabric.relate('REFERENCES', v.canonicalId, input.subject, actor, { context: { role: 'valued-subject' } });
    return v;
  }

  /** Registers an exchange-rate valuation between two currency units. */
  exchangeRate(input: { from: string; to: string; rate: number; valuer: string; validity?: { start: string; end: string | null }; basis?: string }, actor: Actor, ctx: ResolvedContext): Entry {
    const from = this.unit(input.from)!;
    const to = this.unit(input.to)!;
    if (from.content.dimension !== 'currency' || to.content.dimension !== 'currency') throw new ConstitutionalError('V-MS-04', 'exchange rates relate currency units');
    const v = this.value({ subject: from.canonicalId, valuer: input.valuer, purpose: 'exchange-rate', magnitude: input.rate, unit: String(to.content.symbol), basis: input.basis ?? 'registered rate', validity: input.validity, fromUnit: String(from.content.symbol) }, actor, ctx);
    return this.p.fabric.transition(v.canonicalId, 'EFFECTIVE', actor);
  }

  applicable(value: Entry, ctx: ResolvedContext): boolean {
    const conds = (value.content.contextConditions as string[]) ?? [];
    return conds.every((c) => {
      try {
        return evaluateBoolean(c, { scope: { ...ctx.bindings, context: ctx.bindings } });
      } catch {
        return false;
      }
    });
  }
}
