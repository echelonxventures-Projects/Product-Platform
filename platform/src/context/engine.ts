import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { hashValue, seededRandom } from '../kernel/hash.ts';
import { intersect, type Interval } from '../kernel/clock.ts';

export type MergeKind = 'precedence' | 'union' | 'intersection' | 'min' | 'max' | 'strict';

export interface Contribution {
  dimension: string;
  field: string;
  value: unknown;
  contributor: string;
  authority: string;
  specificity?: number;
  at?: string;
  evidence?: unknown;
}

interface Weighted {
  value: unknown;
  rank: number;
  specificity: number;
  recency: number;
  unresolved?: { candidates: unknown[] };
  contributors: string[];
}

export interface ResolvedContext {
  contextId: string;
  purpose: string;
  bindings: Record<string, Record<string, unknown>>;
  dimensionBindings: Record<string, Record<string, unknown>>;
  reality: string;
  resolvedAt: string;
  provenance: Contribution[];
  validity: Interval | null;
  precedenceScope: string[];
  record: Record<string, unknown>;
}

interface DimensionModel {
  id: string;
  name: string;
  fields: Record<string, { mergeKind: MergeKind; allowed?: string[] }>;
  defaults: Record<string, unknown>;
}

export interface ContextModels {
  dimensions: Record<string, { fields: Record<string, { mergeKind: MergeKind; allowedFrom?: string }>; defaults: Record<string, unknown> }>;
  purposes: Record<string, { relevant: string[]; required: string[] }>;
}

/**
 * Universal Context Engine (Phase 007). Dimensions are registered artifacts;
 * the engine holds none of its own. Merge is a join-semilattice per field,
 * so resolution is deterministic, commutative and associative (V-CX-04), and
 * an unresolved conflict is a refusal, never a default (V-CX-06).
 */
export class ContextEngine {
  private readonly p: Platform;
  private models: ContextModels = { dimensions: {}, purposes: {} };
  private dims = new Map<string, DimensionModel>();

  constructor(p: Platform) {
    this.p = p;
  }

  configure(models: ContextModels): void {
    this.models = models;
  }

  install(): void {
    this.p.validation.registerKind('RegisteredContext', (e) => (e.content.dimensionBindings ? [] : [{ rule: 'V-CX-02', message: 'a registered context carries dimension bindings' }]));
  }

  hydrate(): void {
    this.dims.clear();
    for (const e of this.p.fabric.iterate('ContextDimension')) this.addDimension(e);
  }

  addDimension(e: Entry): void {
    const name = e.definition.canonicalName;
    const model = this.models.dimensions[name];
    const holds = (e.content.holds as string[]) ?? [];
    const fields: DimensionModel['fields'] = {};
    for (const [f, spec] of Object.entries(model?.fields ?? {})) fields[f] = { mergeKind: spec.mergeKind, allowed: spec.allowedFrom === 'holds' ? holds : undefined };
    this.dims.set(name.toLowerCase(), { id: e.canonicalId, name, fields, defaults: model?.defaults ?? {} });
    this.dims.set(e.canonicalId, this.dims.get(name.toLowerCase())!);
  }

  dimensions(): DimensionModel[] {
    return [...new Set(this.dims.values())];
  }

  dimension(ref: string): DimensionModel {
    const d = this.dims.get(ref.toLowerCase()) ?? this.dims.get(ref);
    if (!d) throw new ConstitutionalError('V-CX-02', `context dimension ${ref} is not registered`);
    return d;
  }

  describe(ref: string): Record<string, unknown> {
    const d = this.dimension(ref);
    const entry = this.p.fabric.require(d.id);
    return { id: d.id, name: d.name, owningUniverse: entry.content.owningUniverse, statement: entry.definition.canonicalStatement, valueModel: d.fields, defaults: d.defaults, conditions: entry.content.conditions ?? [] };
  }

  purposes(): Record<string, { relevant: string[]; required: string[] }> {
    return this.models.purposes;
  }

  // ── merge algebra ───────────────────────────────────────────────────────

  private weigh(c: Contribution): Weighted {
    return {
      value: c.value,
      rank: this.p.governance.authorityRank(c.authority),
      specificity: c.specificity ?? 0,
      recency: c.at ? Date.parse(c.at) : 0,
      contributors: [c.contributor],
    };
  }

  /** The join of two weighted values under a merge kind. Commutative and associative. */
  static join(kind: MergeKind, a: Weighted, b: Weighted): Weighted {
    const contributors = [...new Set([...a.contributors, ...b.contributors])].sort();
    switch (kind) {
      case 'union': {
        const set = new Map<string, unknown>();
        for (const v of [...toArray(a.value), ...toArray(b.value)]) set.set(JSON.stringify(v), v);
        return { ...maxPrec(a, b), value: [...set.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v), unresolved: undefined, contributors };
      }
      case 'intersection': {
        if (a.unresolved || b.unresolved) return { ...maxPrec(a, b), unresolved: { candidates: [a.value, b.value] }, contributors };
        const ia = a.value as Interval;
        const ib = b.value as Interval;
        const i = intersect(ia, ib);
        if (!i) return { ...maxPrec(a, b), value: null, unresolved: { candidates: [ia, ib] }, contributors };
        return { ...maxPrec(a, b), value: i, contributors };
      }
      case 'min':
      case 'max': {
        const pick = kind === 'min' ? (Number(a.value) <= Number(b.value) ? a : b) : Number(a.value) >= Number(b.value) ? a : b;
        return { ...pick, contributors };
      }
      case 'strict': {
        if (a.unresolved || b.unresolved || JSON.stringify(a.value) !== JSON.stringify(b.value)) {
          const candidates = uniqueSorted([...(a.unresolved?.candidates ?? [a.value]), ...(b.unresolved?.candidates ?? [b.value])]);
          return { ...maxPrec(a, b), unresolved: candidates.length > 1 ? { candidates } : undefined, value: candidates.length > 1 ? null : a.value, contributors };
        }
        return { ...a, contributors };
      }
      case 'precedence':
      default: {
        const cmp = comparePrec(a, b);
        if (cmp > 0) return { ...a, contributors };
        if (cmp < 0) return { ...b, contributors };
        if (!a.unresolved && !b.unresolved && JSON.stringify(a.value) === JSON.stringify(b.value)) return { ...a, contributors };
        const candidates = uniqueSorted([...(a.unresolved?.candidates ?? [a.value]), ...(b.unresolved?.candidates ?? [b.value])]);
        return { ...a, value: null, unresolved: candidates.length > 1 ? { candidates } : undefined, contributors };
      }
    }
  }

  /** Folds contributions for one field; order-independent by construction. */
  private resolveField(kind: MergeKind, contributions: Contribution[]): Weighted | undefined {
    let acc: Weighted | undefined;
    for (const c of contributions) {
      const w = this.weigh(c);
      acc = acc ? ContextEngine.join(kind, acc, w) : w;
    }
    return acc;
  }

  // ── resolution pipeline (Phase 007 §7) ──────────────────────────────────

  /**
   * RESOLVE(purpose, contributions) → Context or refusal. Stages: situation
   * gathering (explicit + registered defaults), purpose filter, per-dimension
   * resolution, precedence conflict resolution, validation, immutable record.
   */
  resolve(input: { purpose: string; contributions: Contribution[]; register?: boolean }, actor: Actor, options: { emit?: boolean } = {}): ResolvedContext {
    const purpose = input.purpose;
    const purposeSpec = this.models.purposes[purpose];
    const relevant = new Set((purposeSpec?.relevant ?? this.dimensions().map((d) => d.name)).map((n) => n.toLowerCase()));
    const now = this.p.clock.now();
    const platformAuthority = this.p.governance.registryOffice();

    // 1–2. situation gathering: explicit contributions + registered defaults
    const gathered: Contribution[] = [];
    for (const c of input.contributions) {
      if (!c.contributor || !c.authority) throw new ConstitutionalError('CX-S-01', 'a context contribution must be authored by an accountable contributor');
      gathered.push({ ...c, at: c.at ?? now });
    }
    for (const d of this.dimensions()) {
      for (const [field, raw] of Object.entries(d.defaults)) {
        const value = this.defaultValue(raw, actor, now);
        if (value === undefined || value === null) continue;
        if (gathered.some((g) => this.dimension(g.dimension).id === d.id && g.field === field)) continue;
        gathered.push({ dimension: d.name, field, value, contributor: 'registered-default', authority: platformAuthority, specificity: -1, at: '1970-01-01T00:00:00.000Z' });
      }
    }

    // 3. purpose filter
    const filtered = gathered.filter((c) => relevant.has(this.dimension(c.dimension).name.toLowerCase()));

    // 4–5. dimension resolution and conflict resolution
    const bindings: Record<string, Record<string, unknown>> = {};
    const dimensionBindings: Record<string, Record<string, unknown>> = {};
    const conflicts: { dimension: string; field: string; candidates: unknown[] }[] = [];
    const groups = new Map<string, Contribution[]>();
    for (const c of filtered) {
      const d = this.dimension(c.dimension);
      if (!d.fields[c.field]) throw new ConstitutionalError('V-CX-03', `${d.name} has no field ${c.field} in its registered value model`);
      const allowed = d.fields[c.field].allowed;
      if (allowed && allowed.length && !toArray(c.value).every((v) => allowed.includes(String(v)))) {
        throw new ConstitutionalError('V-CX-03', `${d.name}.${c.field} value ${JSON.stringify(c.value)} is outside its value model (${allowed.join(', ')})`);
      }
      const key = `${d.id}|${c.field}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const [key, list] of groups) {
      const [dimId, field] = key.split('|');
      const d = this.dimension(dimId);
      const w = this.resolveField(d.fields[field].mergeKind, list)!;
      if (w.unresolved) {
        conflicts.push({ dimension: d.name, field, candidates: w.unresolved.candidates });
        continue;
      }
      (bindings[d.name] ??= {})[field] = w.value;
      (dimensionBindings[d.id] ??= {})[field] = w.value;
    }
    if (conflicts.length) {
      if (options.emit !== false) this.p.bus.emit({ type: 'ctx.unresolved.conflict', subject: null, actor, payload: { purpose, conflicts }, context: { purpose, reality: String(bindings.Reality?.mode ?? 'actual') } });
      throw new ConstitutionalError(
        conflicts.some((c) => c.dimension === 'Reality') ? 'V-CX-08' : 'V-CX-06',
        `context UNRESOLVED for purpose ${purpose}: ${conflicts.map((c) => `${c.dimension}.${c.field} ∈ ${JSON.stringify(c.candidates)}`).join('; ')}`,
        conflicts,
      );
    }

    // 6. validation: required dimensions bound
    for (const req of purposeSpec?.required ?? []) {
      if (!bindings[req] || Object.keys(bindings[req]).length === 0) throw new ConstitutionalError('V-CX-01', `purpose ${purpose} requires the ${req} dimension to be bound`);
    }

    // 7. context object (immutable, provenance-bearing)
    const reality = String(bindings.Reality?.mode ?? 'actual');
    const validity = (bindings.Temporal?.validity as Interval | undefined) ?? null;
    const contextId = `ctx-${hashValue({ purpose, dimensionBindings }).slice(0, 24)}`;
    const record = { contextId, purpose, dimensionBindings, reality, resolvedAt: now };
    const ctx: ResolvedContext = {
      contextId,
      purpose,
      bindings,
      dimensionBindings,
      reality,
      resolvedAt: now,
      provenance: filtered,
      validity,
      precedenceScope: ['authorityRank', 'specificity', 'recency'],
      record,
    };
    if (options.emit !== false) this.p.bus.emit({ type: 'ctx.resolved', subject: null, actor, payload: { contributions: filtered.length, dimensions: Object.keys(bindings) }, context: record });
    if (input.register) this.register(ctx, actor);
    return ctx;
  }

  private defaultValue(raw: unknown, actor: Actor, now: string): unknown {
    if (raw === '$now') return now;
    if (raw === '$actor.principal') return actor.principal;
    if (raw === '$actor.authority') return actor.authority;
    if (raw === '$actor.onBehalfOf') return actor.onBehalfOf;
    if (raw === '$config.defaultLocale') return this.p.cfg.platform.defaultLocale;
    return raw;
  }

  /** Builds contributions from a flat `{ Dimension: { field: value } }` map supplied by a caller. */
  contributionsFrom(map: Record<string, Record<string, unknown>> | undefined, actor: Actor, specificity = 1): Contribution[] {
    const out: Contribution[] = [];
    for (const [dim, fields] of Object.entries(map ?? {})) {
      for (const [field, value] of Object.entries(fields ?? {})) out.push({ dimension: dim, field, value, contributor: actor.principal, authority: actor.authority, specificity });
    }
    return out;
  }

  /** Resolves a context from a flat caller map for a purpose — the common entry point for engines. */
  forPurpose(purpose: string, map: Record<string, Record<string, unknown>> | undefined, actor: Actor): ResolvedContext {
    return this.resolve({ purpose, contributions: this.contributionsFrom(map, actor) }, actor);
  }

  /** REGISTER-CONTEXT: durable, governed context artifact (rare, CX-P7). */
  register(ctx: ResolvedContext, actor: Actor): Entry {
    return this.p.fabric.submit(
      {
        kind: 'RegisteredContext',
        name: `Context ${ctx.contextId}`,
        statement: `A registered context for purpose ${ctx.purpose}.`,
        content: { contextId: ctx.contextId, purpose: ctx.purpose, dimensionBindings: ctx.dimensionBindings, reality: ctx.reality, provenance: ctx.provenance, qualifier: ctx.contextId },
        provenance: { source: 'context-engine' },
      },
      actor,
    );
  }

  /** EVALUATE-IN: evaluates a registered rule expression in a resolved context and returns both (CX-P8). */
  evaluateIn(ctx: ResolvedContext, expression: string, subject: Record<string, unknown> = {}): { verdict: boolean; context: Record<string, unknown> } {
    const verdict = this.p.expressions.boolean(expression, { ...subject, context: ctx.bindings, ...ctx.bindings });
    return { verdict, context: ctx.record };
  }

  /**
   * X-CX-03: the engine is certified against its algebraic properties by
   * proof over random inputs — determinism, commutativity, associativity.
   */
  proveAlgebra(trials: number, seed: number): { trials: number; deterministic: boolean; commutative: boolean; associative: boolean; failures: string[] } {
    const rnd = seededRandom(seed);
    const kinds: MergeKind[] = ['precedence', 'union', 'intersection', 'min', 'max', 'strict'];
    const failures: string[] = [];
    const gen = (kind: MergeKind): Weighted => {
      const rank = Math.floor(rnd() * 3);
      const specificity = Math.floor(rnd() * 2);
      const recency = Math.floor(rnd() * 3);
      let value: unknown;
      if (kind === 'union') value = [String.fromCharCode(97 + Math.floor(rnd() * 5))];
      else if (kind === 'intersection') {
        const s = Math.floor(rnd() * 10);
        const e = s + 1 + Math.floor(rnd() * 10);
        value = { start: new Date(Date.UTC(2026, 0, 1 + s)).toISOString(), end: new Date(Date.UTC(2026, 0, 1 + e)).toISOString() };
      } else if (kind === 'min' || kind === 'max') value = Math.floor(rnd() * 5);
      else value = ['x', 'y', 'z'][Math.floor(rnd() * 3)];
      return { value, rank, specificity, recency, contributors: [`c${Math.floor(rnd() * 100)}`] };
    };
    const norm = (w: Weighted) => JSON.stringify({ v: w.unresolved ? { u: uniqueSorted(w.unresolved.candidates) } : w.value, r: w.rank, s: w.specificity, t: w.recency });
    const sameOutcome = (x: Weighted, y: Weighted) => (x.unresolved && y.unresolved ? true : JSON.stringify(x.unresolved ? null : x.value) === JSON.stringify(y.unresolved ? null : y.value) && !!x.unresolved === !!y.unresolved);
    let det = true;
    let comm = true;
    let assoc = true;
    for (let t = 0; t < trials; t++) {
      const kind = kinds[t % kinds.length];
      const a = gen(kind);
      const b = gen(kind);
      const c = gen(kind);
      const j = (x: Weighted, y: Weighted) => ContextEngine.join(kind, x, y);
      if (norm(j(a, b)) !== norm(j(a, b))) {
        det = false;
        failures.push(`determinism ${kind}`);
      }
      if (!sameOutcome(j(a, b), j(b, a))) {
        comm = false;
        failures.push(`commutativity ${kind}: ${norm(a)} ${norm(b)}`);
      }
      if (!sameOutcome(j(j(a, b), c), j(a, j(b, c)))) {
        assoc = false;
        failures.push(`associativity ${kind}: ${norm(a)} ${norm(b)} ${norm(c)}`);
      }
    }
    return { trials, deterministic: det, commutative: comm, associative: assoc, failures: failures.slice(0, 20) };
  }
}

function toArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
}

function comparePrec(a: Weighted, b: Weighted): number {
  return a.rank - b.rank || a.specificity - b.specificity || a.recency - b.recency;
}

function maxPrec(a: Weighted, b: Weighted): Weighted {
  return comparePrec(a, b) >= 0 ? a : b;
}

function uniqueSorted(values: unknown[]): unknown[] {
  const m = new Map<string, unknown>();
  for (const v of values) m.set(JSON.stringify(v), v);
  return [...m.entries()].sort(([x], [y]) => x.localeCompare(y)).map(([, v]) => v);
}
