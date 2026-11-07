import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';

export interface InferenceRule {
  name: string;
  statement: string;
  premises: { type: string; from: string; to: string }[];
  conclusion: { type: string; from: string; to: string };
  confidence: number;
}

export interface DerivedFact {
  type: string;
  source: string;
  target: string;
  confidence: number;
  rule: string;
  derivationChain: { type: string; source: string; target: string; asserted: boolean }[];
}

interface Fact {
  type: string;
  source: string;
  target: string;
  confidence: number;
  asserted: boolean;
  chain: { type: string; source: string; target: string; asserted: boolean }[];
  rule: string;
}

/**
 * Reasoning Engine (Phase 010 §5.2): infer with a derivation chain and a
 * confidence, evaluate registered rules, explain, and detect contradictions.
 * A contradiction against an invariant is a constitutional failure — it is
 * escalated, never smoothed over.
 */
export class ReasoningEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  rules(): InferenceRule[] {
    return this.p.fabric
      .query({ kind: 'Rule', status: ['CERTIFIED', 'ADMISSIBLE'], contentPath: 'ruleClass', contentEquals: 'inference', limit: 1000 })
      .entries.map((e) => e.content.inference as InferenceRule)
      .filter(Boolean);
  }

  private baseFacts(types?: string[]): Fact[] {
    const rows = types?.length ? types.flatMap((t) => this.p.store.edgesOfType(t)) : this.p.store.allEffectiveEdges();
    return rows.map((e) => {
      const body = JSON.parse(e.body) as { confidence?: number };
      return { type: e.type, source: e.source, target: e.target, confidence: body.confidence ?? 1, asserted: true, chain: [{ type: e.type, source: e.source, target: e.target, asserted: true }], rule: 'asserted' };
    });
  }

  /**
   * INFER(premises, context) → inferences with explanation. Forward chaining
   * to a fixed point (bounded by depth): transitive closure of transitive
   * types, then registered Horn rules.
   */
  infer(options: { types?: string[]; maxDepth?: number; record?: boolean; limit?: number }, actor: Actor, ctx: ResolvedContext): { derived: DerivedFact[]; recorded: string[]; rounds: number } {
    const transitive = new Set(this.p.fabric.relationshipTypes().filter((t) => t.transitive).map((t) => t.type));
    const rules = this.rules();
    const involved = new Set<string>([...(options.types ?? [])]);
    if (options.types?.length) for (const r of rules) if (r.premises.some((pr) => involved.has(pr.type))) r.premises.forEach((pr) => involved.add(pr.type));
    const facts = new Map<string, Fact>();
    const key = (f: { type: string; source: string; target: string }) => `${f.type}|${f.source}|${f.target}`;
    for (const f of this.baseFacts(options.types?.length ? [...involved] : undefined)) facts.set(key(f), f);
    const maxDepth = Math.min(options.maxDepth ?? 4, 8);
    const limit = options.limit ?? 50_000;
    let rounds = 0;
    for (; rounds < maxDepth; rounds++) {
      const added: Fact[] = [];
      const byTypeSource = new Map<string, Fact[]>();
      for (const f of facts.values()) {
        const k = `${f.type}|${f.source}`;
        byTypeSource.set(k, [...(byTypeSource.get(k) ?? []), f]);
      }
      for (const f of facts.values()) {
        if (!transitive.has(f.type)) continue;
        for (const g of byTypeSource.get(`${f.type}|${f.target}`) ?? []) {
          if (g.target === f.source) continue;
          const nf: Fact = { type: f.type, source: f.source, target: g.target, confidence: f.confidence * g.confidence, asserted: false, chain: [...f.chain, ...g.chain], rule: `transitivity:${f.type}` };
          if (!facts.has(key(nf)) && !added.some((a) => key(a) === key(nf))) added.push(nf);
        }
      }
      for (const rule of rules) {
        const [p1, p2] = rule.premises;
        if (!p1 || !p2) continue;
        for (const f of facts.values()) {
          if (f.type !== p1.type) continue;
          const binding: Record<string, string> = { [p1.from]: f.source, [p1.to]: f.target };
          const joinVar = p2.from in binding ? p2.from : p2.to in binding ? p2.to : null;
          if (!joinVar) continue;
          const candidates = p2.from === joinVar ? (byTypeSource.get(`${p2.type}|${binding[joinVar]}`) ?? []) : [...facts.values()].filter((g) => g.type === p2.type && g.target === binding[joinVar]);
          for (const g of candidates) {
            const b = { ...binding, [p2.from]: g.source, [p2.to]: g.target };
            const src = b[rule.conclusion.from];
            const tgt = b[rule.conclusion.to];
            if (!src || !tgt || src === tgt) continue;
            const nf: Fact = { type: rule.conclusion.type, source: src, target: tgt, confidence: rule.confidence * f.confidence * g.confidence, asserted: false, chain: [...f.chain, ...g.chain], rule: rule.name };
            if (!facts.has(key(nf)) && !added.some((a) => key(a) === key(nf))) added.push(nf);
          }
        }
      }
      if (!added.length) break;
      for (const a of added) facts.set(key(a), a);
      if (facts.size > limit) break;
    }
    const derived: DerivedFact[] = [...facts.values()].filter((f) => !f.asserted).map((f) => ({ type: f.type, source: f.source, target: f.target, confidence: Math.round(f.confidence * 1e6) / 1e6, rule: f.rule, derivationChain: f.chain }));
    const recorded: string[] = [];
    if (options.record) for (const d of derived.slice(0, 1000)) recorded.push(this.recordInference(d, actor, ctx).canonicalId);
    this.p.bus.emit({ type: 'int.inference.completed', subject: null, actor, payload: { derived: derived.length, recorded: recorded.length, rounds, purpose: ctx.purpose }, context: ctx.record });
    return { derived, recorded, rounds };
  }

  /** Records an inference as Knowledge marked inferred, linked to its premises (IN-P7, V-IN-07). */
  recordInference(d: DerivedFact, actor: Actor, ctx: ResolvedContext): Entry {
    const name = (id: string) => this.p.store.head(id)?.canonical_name ?? id;
    const statement = `${name(d.source)} ${d.type} ${name(d.target)} (inferred by ${d.rule}).`;
    const inf = this.p.fabric.submit(
      {
        kind: 'Inference',
        namespace: this.p.namespaceOf(d.source),
        name: `Inference ${d.source} ${d.type} ${d.target}`,
        statement,
        content: { subject: d.source, premises: d.derivationChain, conclusion: { type: d.type, source: d.source, target: d.target }, derivationChain: d.derivationChain, confidence: d.confidence, inferred: true, justification: `derived by ${d.rule} from ${d.derivationChain.length} premises`, context: ctx.record, rule: d.rule },
        provenance: { source: 'reasoning-engine' },
      },
      actor,
    );
    for (const pr of d.derivationChain) {
      const edge = this.p.store.edgesFrom(pr.source, pr.type).find((e) => e.target === pr.target);
      if (edge) this.p.fabric.relate('INFERRED-FROM', inf.canonicalId, pr.source, actor, { context: { premiseEdge: edge.id } });
    }
    this.p.bus.emit({ type: 'int.inference.recorded', subject: inf.canonicalId, actor, payload: { confidence: d.confidence, rule: d.rule, purpose: ctx.purpose }, context: ctx.record });
    return this.p.fabric.transition(inf.canonicalId, 'EVIDENCED', actor, { justified: true });
  }

  /** EXPLAIN: the chain from premises to conclusion. */
  explain(inferenceId: string): { conclusion: unknown; chain: { type: string; source: string; sourceName: string; target: string; targetName: string; asserted: boolean }[]; confidence: number } {
    const inf = this.p.fabric.require(inferenceId);
    const chain = (inf.content.derivationChain as { type: string; source: string; target: string; asserted: boolean }[]).map((c) => ({ ...c, sourceName: this.p.store.head(c.source)?.canonical_name ?? c.source, targetName: this.p.store.head(c.target)?.canonical_name ?? c.target }));
    return { conclusion: inf.content.conclusion, chain, confidence: Number(inf.content.confidence) };
  }

  /**
   * DETECT: an artifact both narrower than / classified under two concepts
   * declared disjoint, or a concept declared disjoint with one of its own
   * ancestors. Each contradiction is escalated as a constitutional event.
   */
  contradictions(actor?: Actor): { contradictions: { subject: string; a: string; b: string; reason: string }[] } {
    const disjoint = this.p.store.edgesOfType('DISJOINT-WITH').map((e) => [e.source, e.target] as [string, string]);
    if (!disjoint.length) return { contradictions: [] };
    const up = (id: string): Set<string> => {
      const seen = new Set<string>();
      const stack = [id];
      while (stack.length) {
        const n = stack.pop()!;
        for (const t of ['NARROWER-THAN', 'IS-A', 'CLASSIFIED-AS']) for (const e of this.p.store.edgesFrom(n, t)) if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
      return seen;
    };
    const out: { subject: string; a: string; b: string; reason: string }[] = [];
    const pairs = new Set(disjoint.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    const candidates = new Set<string>();
    for (const [a, b] of disjoint) {
      for (const x of [a, b]) for (const t of ['NARROWER-THAN', 'IS-A', 'CLASSIFIED-AS']) for (const e of this.p.store.edgesTo(x, t)) candidates.add(e.source);
      if (up(a).has(b) || up(b).has(a)) out.push({ subject: a, a, b, reason: 'a concept is declared disjoint with one of its own ancestors' });
    }
    for (const c of candidates) {
      const ancestors = [...up(c)];
      for (let i = 0; i < ancestors.length; i++) for (let j = i + 1; j < ancestors.length; j++) if (pairs.has(`${ancestors[i]}|${ancestors[j]}`)) out.push({ subject: c, a: ancestors[i], b: ancestors[j], reason: 'placed under two disjoint concepts' });
    }
    if (out.length) this.p.bus.emit({ type: 'int.contradiction.detected', subject: out[0].subject, actor: actor ?? this.p.systemActor(), payload: { count: out.length, first: out[0], rule: 'UCI-013', purpose: 'consistency' }, context: { purpose: 'consistency', reality: 'actual' } });
    return { contradictions: out };
  }
}
