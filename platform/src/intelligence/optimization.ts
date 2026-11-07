import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { parseExpression, evaluateNode, type Node } from '../rules/expression.ts';
import { seededRandom } from '../kernel/hash.ts';

export interface Variable {
  name: string;
  domain: 'continuous' | 'integer' | 'binary';
  lower?: number;
  upper?: number;
}

export interface ModelContent {
  variables: Variable[];
  constraints: { name: string; expression: string }[];
  parameters?: Record<string, { value: number; uncertainty?: number; unit?: string }>;
  assumptions: string[];
}

interface Linear {
  coef: number[];
  constant: number;
}

interface LP {
  c: number[];
  rows: { a: number[]; sense: '<=' | '>=' | '='; b: number }[];
  maximize: boolean;
}

type LPResult = { status: 'optimal'; x: number[]; value: number } | { status: 'infeasible' | 'unbounded' };

const EPS = 1e-9;

/**
 * Two-phase primal simplex with Bland's anti-cycling rule. Variables are
 * non-negative; bounds are expressed as rows by the caller.
 */
export function simplex(lp: LP): LPResult {
  const n = lp.c.length;
  const rows = lp.rows.map((r) => (r.b < 0 ? { a: r.a.map((x) => -x), sense: (r.sense === '<=' ? '>=' : r.sense === '>=' ? '<=' : '=') as LP['rows'][number]['sense'], b: -r.b } : { ...r, a: [...r.a] }));
  const m = rows.length;
  let slackCount = 0;
  let artCount = 0;
  for (const r of rows) {
    if (r.sense !== '=') slackCount++;
    if (r.sense !== '<=') artCount++;
  }
  const total = n + slackCount + artCount;
  const T: number[][] = [];
  const basis: number[] = [];
  let si = n;
  let ai = n + slackCount;
  const artificial: number[] = [];
  for (const r of rows) {
    const row = new Array(total + 1).fill(0);
    r.a.forEach((v, j) => (row[j] = v));
    row[total] = r.b;
    if (r.sense === '<=') {
      row[si] = 1;
      basis.push(si++);
    } else if (r.sense === '>=') {
      row[si++] = -1;
      row[ai] = 1;
      artificial.push(ai);
      basis.push(ai++);
    } else {
      row[ai] = 1;
      artificial.push(ai);
      basis.push(ai++);
    }
    T.push(row);
  }
  const pivot = (r: number, c: number) => {
    const pv = T[r][c];
    for (let j = 0; j <= total; j++) T[r][j] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === r || Math.abs(T[i][c]) < EPS) continue;
      const f = T[i][c];
      for (let j = 0; j <= total; j++) T[i][j] -= f * T[r][j];
    }
    basis[r] = c;
  };
  const run = (obj: number[], allowed: (j: number) => boolean): 'optimal' | 'unbounded' => {
    for (let iter = 0; iter < 10_000; iter++) {
      // reduced costs for maximisation of obj
      let enter = -1;
      for (let j = 0; j < total; j++) {
        if (!allowed(j) || basis.includes(j)) continue;
        let rc = obj[j];
        for (let i = 0; i < m; i++) rc -= obj[basis[i]] * T[i][j];
        if (rc > EPS) {
          enter = j;
          break;
        }
      }
      if (enter === -1) return 'optimal';
      let leave = -1;
      let best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][enter] > EPS) {
          const ratio = T[i][total] / T[i][enter];
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) {
            best = ratio;
            leave = i;
          }
        }
      }
      if (leave === -1) return 'unbounded';
      pivot(leave, enter);
    }
    return 'optimal';
  };
  if (artificial.length) {
    const phase1 = new Array(total).fill(0);
    for (const a of artificial) phase1[a] = -1;
    run(phase1, () => true);
    const infeas = artificial.reduce((s, a) => {
      const r = basis.indexOf(a);
      return s + (r >= 0 ? T[r][total] : 0);
    }, 0);
    if (infeas > 1e-7) return { status: 'infeasible' };
    for (let i = 0; i < m; i++) {
      if (artificial.includes(basis[i])) {
        const j = [...Array(n + slackCount).keys()].find((k) => Math.abs(T[i][k]) > EPS);
        if (j !== undefined) pivot(i, j);
      }
    }
  }
  const obj = new Array(total).fill(0);
  lp.c.forEach((v, j) => (obj[j] = lp.maximize ? v : -v));
  const status = run(obj, (j) => !artificial.includes(j));
  if (status === 'unbounded') return { status: 'unbounded' };
  const x = new Array(n).fill(0);
  for (let i = 0; i < m; i++) if (basis[i] < n) x[basis[i]] = T[i][total];
  const value = lp.c.reduce((s, v, j) => s + v * x[j], 0);
  return { status: 'optimal', x, value };
}

/** Branch and bound over integer variables (depth-first, best-bound pruning). */
export function branchAndBound(lp: LP, integer: boolean[], maxNodes = 20_000): LPResult & { nodes?: number } {
  let best: { x: number[]; value: number } | null = null;
  let nodes = 0;
  let unbounded = false;
  const stack: LP[] = [lp];
  while (stack.length && nodes < maxNodes) {
    const cur = stack.pop()!;
    nodes++;
    const r = simplex(cur);
    if (r.status === 'unbounded') {
      unbounded = true;
      continue;
    }
    if (r.status !== 'optimal') continue;
    if (best && (lp.maximize ? r.value <= best.value + EPS : r.value >= best.value - EPS)) continue;
    const frac = r.x.findIndex((v, j) => integer[j] && Math.abs(v - Math.round(v)) > 1e-6);
    if (frac === -1) {
      best = { x: r.x.map((v, j) => (integer[j] ? Math.round(v) : v)), value: r.value };
      continue;
    }
    const v = r.x[frac];
    const unit = new Array(lp.c.length).fill(0);
    unit[frac] = 1;
    stack.push({ ...cur, rows: [...cur.rows, { a: unit, sense: '>=', b: Math.ceil(v) }] });
    stack.push({ ...cur, rows: [...cur.rows, { a: unit, sense: '<=', b: Math.floor(v) }] });
  }
  if (best) return { status: 'optimal', x: best.x, value: best.value, nodes };
  return { status: unbounded ? 'unbounded' : 'infeasible', nodes };
}

/**
 * Optimization Engine (Phase 010 §5.6). The model is owned by its universe;
 * this engine owns selection. No registered objective ⇒ refusal. No feasible
 * region ⇒ refusal. Constraints are never dropped to obtain a solution
 * (V-IN-11). Every result carries uncertainty (UMQSOL-008).
 */
export class OptimizationEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('DecisionModel', (e) => {
      if (e.classification.namespace !== 'UCOS' && !e.content.variables) return [];
      const c = e.content as unknown as ModelContent;
      if (!c.variables) return [];
      const out = [];
      if (!Array.isArray(c.assumptions) || c.assumptions.length === 0) out.push({ rule: 'UMQSOL-005', message: 'every model possesses assumptions' });
      for (const k of c.constraints ?? []) {
        try {
          this.parseConstraint(k.expression, c.variables.map((v) => v.name), this.paramValues(c));
        } catch (err) {
          out.push({ rule: 'UMQSOL-006', message: `constraint ${k.name}: ${(err as Error).message}` });
        }
      }
      return out;
    });
    this.p.validation.registerKind('Objective', (e) => (e.content.sense && (e.content.expression || e.content.criteria) ? [] : [{ rule: 'UMQSOL-007', message: 'an objective is explicitly represented (sense and expression, or criteria)' }]));
  }

  private paramValues(c: ModelContent, override?: Record<string, number>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(c.parameters ?? {})) out[k] = v.value;
    return { ...out, ...(override ?? {}) };
  }

  /** Extracts a linear form Σcᵢxᵢ + k from an expression, proving linearity numerically. */
  linearForm(node: Node, vars: string[], params: Record<string, number>): Linear {
    const at = (x: number[]) => Number(evaluateNode(node, { scope: { ...params, ...Object.fromEntries(vars.map((v, i) => [v, x[i]])) }, strict: true }));
    const zero = vars.map(() => 0);
    const constant = at(zero);
    const coef = vars.map((_, i) => {
      const e = [...zero];
      e[i] = 1;
      return at(e) - constant;
    });
    const probe = vars.map((_, i) => 1.7 + i * 0.3);
    const predicted = constant + coef.reduce((s, c, i) => s + c * probe[i], 0);
    if (!isFinite(constant) || coef.some((c) => !isFinite(c)) || Math.abs(at(probe) - predicted) > 1e-6 * Math.max(1, Math.abs(predicted))) throw new ConstitutionalError('UMQSOL-006', 'expression is not linear in the decision variables');
    return { coef, constant };
  }

  parseConstraint(expression: string, vars: string[], params: Record<string, number>): { a: number[]; sense: '<=' | '>=' | '='; b: number } {
    const node = parseExpression(expression);
    if (node.t !== 'bin' || !['<=', '>=', '=', '<', '>'].includes(node.op)) throw new ConstitutionalError('UMQSOL-006', `constraint "${expression}" must compare two linear expressions`);
    const l = this.linearForm(node.a, vars, params);
    const r = this.linearForm(node.b, vars, params);
    const sense = node.op === '<' ? '<=' : node.op === '>' ? '>=' : (node.op as '<=' | '>=' | '=');
    return { a: l.coef.map((c, i) => c - r.coef[i]), sense, b: r.constant - l.constant };
  }

  registerModel(input: { name: string; statement: string; namespace?: string; variables: Variable[]; constraints: { name: string; expression: string }[]; parameters?: ModelContent['parameters']; assumptions: string[]; owner?: string }, actor: Actor): Entry {
    const roles = this.p.governance.pipelineRoles(input.namespace ?? 'UCOS');
    return this.p.fabric.admitCertified(
      { kind: 'DecisionModel', namespace: input.namespace ?? 'UCOS', name: input.name, statement: input.statement, content: { variables: input.variables, constraints: input.constraints, parameters: input.parameters ?? {}, assumptions: input.assumptions, owningUniverse: input.owner ?? 'UMQSOCR', registeredBy: actor.principal }, provenance: { source: 'model-registry' } },
      roles,
      'MODEL',
    );
  }

  registerObjective(input: { name: string; statement: string; model?: string; sense?: 'maximize' | 'minimize'; expression?: string; criteria?: { expression: string; weight: number; direction?: string }[]; namespace?: string }, actor: Actor): Entry {
    const roles = this.p.governance.pipelineRoles(input.namespace ?? 'UCOS');
    return this.p.fabric.admitCertified(
      { kind: 'Objective', namespace: input.namespace ?? 'UCOS', name: input.name, statement: input.statement, content: { model: input.model ?? null, sense: input.sense ?? 'maximize', expression: input.expression ?? null, criteria: input.criteria ?? null, ratifiedFor: actor.authority }, provenance: { source: 'objective-registry' }, dependencies: input.model ? [{ target: input.model, type: 'SEMANTIC' }] : [] },
      roles,
      'OBJECTIVE',
    );
  }

  private solveOnce(model: ModelContent, objective: Entry, extra: { name: string; expression: string }[], params: Record<string, number>): LPResult & { nodes?: number } {
    const vars = model.variables.map((v) => v.name);
    const obj = this.linearForm(parseExpression(String(objective.content.expression)), vars, params);
    const rows: LP['rows'] = [];
    for (const k of [...model.constraints, ...extra]) rows.push(this.parseConstraint(k.expression, vars, params));
    model.variables.forEach((v, i) => {
      const unit = vars.map((_, j) => (j === i ? 1 : 0));
      const lower = v.domain === 'binary' ? 0 : (v.lower ?? 0);
      const upper = v.domain === 'binary' ? 1 : v.upper;
      if (lower !== 0) rows.push({ a: unit, sense: '>=', b: lower });
      if (upper !== undefined) rows.push({ a: unit, sense: '<=', b: upper });
    });
    const lp: LP = { c: obj.coef, rows, maximize: objective.content.sense !== 'minimize' };
    const integer = model.variables.map((v) => v.domain !== 'continuous');
    const r = integer.some(Boolean) ? branchAndBound(lp, integer) : simplex(lp);
    return r.status === 'optimal' ? { ...r, value: r.value + obj.constant } : r;
  }

  /**
   * OPTIMIZE(model, objective, constraints, context) → Decision or REFUSAL.
   * Parameter uncertainty is propagated by seeded Monte Carlo re-solution.
   */
  optimize(input: { model: string; objective?: string; constraints?: { name: string; expression: string }[]; samples?: number; seed?: number }, actor: Actor, ctx: ResolvedContext): { status: string; decision: Entry; solution?: Record<string, number>; objectiveValue?: number; uncertainty?: { mean: number; standardDeviation: number; samples: number; feasibleShare: number } } {
    const modelEntry = this.p.fabric.resolve(input.model).entry;
    const model = modelEntry.content as unknown as ModelContent;
    const refuse = (type: string, reason: string) => {
      const decision = this.p.decisions.record({ subject: modelEntry.canonicalId, authority: actor.authority, objective: 'optimization', alternatives: ['SOLVE', 'REFUSE'], selection: 'REFUSE', rationale: reason, context: ctx }, actor);
      this.p.bus.emit({ type, subject: modelEntry.canonicalId, actor, payload: { reason, decision: decision.canonicalId, purpose: 'optimization' }, context: { ...ctx.record, purpose: 'optimization' } });
      return { status: 'REFUSED', decision };
    };
    if (!input.objective) return refuse('int.optimization.refused-no-objective', 'no registered objective; there is no optimum without a stated purpose (Phase 010 §3.3)');
    const objective = this.p.fabric.resolve(input.objective).entry;
    if (objective.kind !== 'Objective' || !['CERTIFIED', 'ADMISSIBLE'].includes(objective.lifecycle.status)) return refuse('int.optimization.refused-no-objective', 'the objective is not a ratified, certified Objective');
    if (!objective.content.expression) return refuse('int.optimization.refused-no-objective', 'the objective has no linear expression');
    const extra = input.constraints ?? [];
    const base = this.solveOnce(model, objective, extra, this.paramValues(model));
    if (base.status !== 'optimal') {
      return refuse(
        'int.optimization.refused-infeasible',
        base.status === 'infeasible' ? 'no feasible region under every registered constraint; constraints are never dropped (V-IN-11)' : 'the objective is unbounded over the feasible region; the model is under-constrained',
      );
    }
    const samples = Math.min(input.samples ?? 200, 5000);
    const uncertain = Object.entries(model.parameters ?? {}).filter(([, v]) => (v.uncertainty ?? 0) > 0);
    const values: number[] = [];
    let feasible = 0;
    if (uncertain.length) {
      const rnd = seededRandom(input.seed ?? this.p.cfg.validation.randomSeed);
      const normal = () => {
        const u = Math.max(rnd(), 1e-12);
        const v = rnd();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
      };
      for (let s = 0; s < samples; s++) {
        const override: Record<string, number> = {};
        for (const [k, v] of uncertain) override[k] = v.value + normal() * (v.uncertainty ?? 0);
        const r = this.solveOnce(model, objective, extra, this.paramValues(model, override));
        if (r.status === 'optimal') {
          feasible++;
          values.push(r.value);
        }
      }
    } else {
      values.push(base.value);
      feasible = 1;
    }
    const mean = values.reduce((s, v) => s + v, 0) / Math.max(values.length, 1);
    const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(values.length - 1, 1));
    const solution = Object.fromEntries(model.variables.map((v, i) => [v.name, Math.round(base.x[i] * 1e9) / 1e9]));
    const uncertainty = { mean: Math.round(mean * 1e6) / 1e6, standardDeviation: Math.round(sd * 1e6) / 1e6, samples: uncertain.length ? samples : 0, feasibleShare: uncertain.length ? feasible / samples : 1 };
    const decision = this.p.decisions.record(
      {
        subject: modelEntry.canonicalId,
        authority: actor.authority,
        objective: objective.canonicalId,
        alternatives: [{ constraints: [...model.constraints, ...extra].map((k) => k.name) }],
        selection: { solution, objectiveValue: base.value },
        rationale: `${objective.content.sense} ${String(objective.content.expression)} subject to ${model.constraints.length + extra.length} constraints; feasible`,
        evidence: { uncertainty, assumptions: model.assumptions },
        confidence: uncertainty.feasibleShare,
        context: ctx,
      },
      actor,
    );
    return { status: 'OPTIMAL', decision, solution, objectiveValue: Math.round(base.value * 1e9) / 1e9, uncertainty };
  }
}
