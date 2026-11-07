import type { Entry } from './types.ts';
import type { LifecycleDefinition, LifecyclePort, RegistryFabric } from './fabric.ts';
import type { Violation } from '../kernel/errors.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { evaluateBoolean, isExpression } from '../rules/expression.ts';

/**
 * Lifecycle engine (C-18). Lifecycles are registered artifacts; this engine
 * contains no states of its own. A transition is legal iff it is declared in
 * the entry's lifecycle (UCI-008) and its registered guard expression holds
 * over the computed transition scope.
 */
export class LifecycleEngine implements LifecyclePort {
  private readonly defs = new Map<string, LifecycleDefinition>();
  private readonly fabric: RegistryFabric;
  /** Scope facts computed by other engines (quorum, dependents, derivation…). */
  private readonly factProviders: ((entry: Entry, to: string, scope: Record<string, unknown>) => Record<string, unknown>)[] = [];

  constructor(fabric: RegistryFabric) {
    this.fabric = fabric;
  }

  define(def: LifecycleDefinition): void {
    const problems = LifecycleEngine.structuralViolations(def);
    if (problems.length) throw new ConstitutionalError(problems[0].rule, `lifecycle ${def.id} is malformed: ${problems.map((p) => p.message).join('; ')}`);
    this.defs.set(def.id, def);
  }

  addFactProvider(fn: (entry: Entry, to: string, scope: Record<string, unknown>) => Record<string, unknown>): void {
    this.factProviders.push(fn);
  }

  get(ref: string): LifecycleDefinition {
    const d = this.defs.get(ref);
    if (!d) throw new ConstitutionalError('V-LC-01', `lifecycle ${ref} is not registered`);
    return d;
  }

  all(): LifecycleDefinition[] {
    return [...this.defs.values()];
  }

  hydrate(): void {
    for (const e of this.fabric.iterate('Lifecycle')) {
      const def = e.content.definition as LifecycleDefinition | undefined;
      if (def && e.classification.namespace === 'UCOS') this.defs.set(def.id, def);
    }
  }

  checkTransition(entry: Entry, to: string, scope: Record<string, unknown>): Violation[] {
    const def = this.get(entry.lifecycle.lifecycleRef);
    const from = entry.lifecycle.status;
    if (!def.states.includes(to)) return [{ rule: 'UCI-008', message: `${to} is not a state of lifecycle ${def.id}` }];
    const candidates = def.transitions.filter((t) => (t.from === from || t.from === '*') && t.to === to);
    if (candidates.length === 0) return [{ rule: 'UCI-008', message: `transition ${from} → ${to} is not admissible under lifecycle ${def.id}` }];
    if (def.terminals.includes(from) && !candidates.some((t) => t.from === from)) {
      return [{ rule: 'UCI-008', message: `${from} is terminal in lifecycle ${def.id}` }];
    }
    let facts: Record<string, unknown> = { ...scope, entry, from, to };
    for (const p of this.factProviders) facts = { ...facts, ...p(entry, to, facts) };
    const violations: Violation[] = [];
    for (const t of candidates) {
      if (!t.guard) return [];
      try {
        if (evaluateBoolean(t.guard, { scope: facts })) return [];
        violations.push({ rule: t.guardRule ?? 'UCI-008', message: `guard failed for ${from} → ${to}: ${t.guard}` });
      } catch (err) {
        violations.push({ rule: 'V-LC-01', message: `guard of ${from} → ${to} unevaluable: ${(err as Error).message}` });
      }
    }
    return violations;
  }

  /** V-LC-01..04: guards are rules, a terminal exists, every state reachable, cycles designated. */
  static structuralViolations(def: LifecycleDefinition): Violation[] {
    const out: Violation[] = [];
    if (!def.states.includes(def.initial)) out.push({ rule: 'V-LC-03', message: `initial state ${def.initial} is not declared` });
    if (def.terminals.length === 0) out.push({ rule: 'V-LC-02', message: 'no terminal state declared' });
    for (const t of def.terminals) if (!def.states.includes(t)) out.push({ rule: 'V-LC-02', message: `terminal ${t} is not declared` });
    for (const t of def.transitions) {
      if (t.from !== '*' && !def.states.includes(t.from)) out.push({ rule: 'UCI-008', message: `transition from undeclared state ${t.from}` });
      if (!def.states.includes(t.to)) out.push({ rule: 'UCI-008', message: `transition to undeclared state ${t.to}` });
      if (t.guard) {
        const ok = isExpression(t.guard);
        if (!ok.ok) out.push({ rule: 'V-LC-01', message: `guard "${t.guard}" is not a registered rule expression: ${ok.error}` });
      }
    }
    const reachable = new Set([def.initial]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of def.transitions) {
        if ((t.from === '*' ? reachable.size > 0 : reachable.has(t.from)) && !reachable.has(t.to)) {
          reachable.add(t.to);
          grew = true;
        }
      }
    }
    for (const s of def.states) if (!reachable.has(s)) out.push({ rule: 'V-LC-03', message: `state ${s} is unreachable from ${def.initial}` });
    // V-LC-04: with the transitions flagged `cycle` removed, the graph must be acyclic.
    const adj = new Map<string, string[]>();
    for (const t of def.transitions) if (t.from !== '*' && !t.cycle) adj.set(t.from, [...(adj.get(t.from) ?? []), t.to]);
    const stackSet = new Set<string>();
    const done = new Set<string>();
    const path: string[] = [];
    const dfs = (s: string) => {
      stackSet.add(s);
      path.push(s);
      for (const n of adj.get(s) ?? []) {
        if (stackSet.has(n)) out.push({ rule: 'V-LC-04', message: `undesignated cycle ${[...path.slice(path.indexOf(n)), n].join(' → ')}` });
        else if (!done.has(n)) dfs(n);
      }
      stackSet.delete(s);
      path.pop();
      done.add(s);
    };
    for (const s of def.states) if (!done.has(s)) dfs(s);
    return out;
  }
}
