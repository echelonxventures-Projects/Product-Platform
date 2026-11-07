import type { RegistryFabric } from '../registry/fabric.ts';
import type { Violation } from '../kernel/errors.ts';

interface OntologyNode {
  canonicalId: string;
  alias: string;
  name: string;
  derivesFrom: string[];
  tier: number;
}

/**
 * The derivation lattice (Phase 002 §5). Primitives and concepts are loaded
 * from their registry seeds at start-up so the lattice is available before
 * any registry entry exists; entries registered later extend it. Tier is
 * computed, never assigned: tier(A) = 1 + max(tier(B)) over A → B.
 */
export class Ontology {
  private readonly nodes = new Map<string, OntologyNode>();
  private readonly fabric: RegistryFabric;
  lexicon: { appliesTo: string[]; terms: { term: string; cls: string }[] } = { appliesTo: [], terms: [] };

  constructor(fabric: RegistryFabric) {
    this.fabric = fabric;
  }

  loadSeeds(primitives: { id: string; alias: string; name: string }[], concepts: { id: string; alias: string; name: string; derivesFrom: string[] }[]): void {
    for (const p of primitives) this.add({ canonicalId: p.id, alias: p.alias, name: p.name, derivesFrom: [], tier: 0 });
    const pending = [...concepts];
    let guard = 0;
    while (pending.length && guard++ < 1000) {
      const c = pending.shift()!;
      const parents = c.derivesFrom.map((d) => this.lookup(d));
      if (parents.some((p) => !p)) {
        pending.push(c);
        continue;
      }
      this.add({ canonicalId: c.id, alias: c.alias, name: c.name, derivesFrom: c.derivesFrom, tier: 1 + Math.max(...parents.map((p) => p!.tier)) });
    }
    if (pending.length) throw new Error(`UCL-D02 derivation lattice cannot be ordered: ${pending.map((p) => p.alias).join(', ')}`);
  }

  loadLexicon(meta: { appliesTo: string[]; classes: Record<string, string[]> }): void {
    this.lexicon = { appliesTo: meta.appliesTo, terms: Object.entries(meta.classes).flatMap(([cls, terms]) => terms.map((term) => ({ term: term.toLowerCase(), cls }))) };
  }

  private add(n: OntologyNode): void {
    this.nodes.set(n.canonicalId, n);
    this.nodes.set(n.alias, n);
    this.nodes.set(n.name.toLowerCase(), n);
  }

  /** Resolves a derivation link: "FR-01", "FR-01 Existence", "C-04", a canonical id or a concept name. */
  lookup(ref: string): OntologyNode | undefined {
    const token = ref.trim().split(/\s+/)[0];
    const hit = this.nodes.get(token) ?? this.nodes.get(ref.trim()) ?? this.nodes.get(ref.trim().toLowerCase());
    if (hit) return hit;
    const resolved = this.fabric.tryResolve(token);
    if (resolved && (resolved.entry.kind === 'Concept' || resolved.entry.kind === 'Primitive')) {
      const e = resolved.entry;
      const parents = e.definition.derivationChain.map((d) => this.lookup(d));
      if (parents.some((p) => !p)) return undefined;
      const node: OntologyNode = {
        canonicalId: e.canonicalId,
        alias: e.identity.aliases[0] ?? e.canonicalId,
        name: e.definition.canonicalName,
        derivesFrom: e.definition.derivationChain,
        tier: e.kind === 'Primitive' ? 0 : 1 + Math.max(...parents.map((p) => p!.tier)),
      };
      this.add(node);
      return node;
    }
    return undefined;
  }

  primitives(): OntologyNode[] {
    return [...new Set(this.nodes.values())].filter((n) => n.tier === 0);
  }

  concepts(): OntologyNode[] {
    return [...new Set(this.nodes.values())].filter((n) => n.tier > 0);
  }

  /** The ordered chain from a reference down to Tier-0 (DERIVATION API). */
  derivation(ref: string): { chain: { alias: string; name: string; tier: number; derivesFrom: string[] }[]; terminates: boolean } {
    const out: { alias: string; name: string; tier: number; derivesFrom: string[] }[] = [];
    const seen = new Set<string>();
    const visit = (r: string): boolean => {
      const n = this.lookup(r);
      if (!n) return false;
      if (seen.has(n.canonicalId)) return true;
      seen.add(n.canonicalId);
      out.push({ alias: n.alias, name: n.name, tier: n.tier, derivesFrom: n.derivesFrom });
      if (n.tier === 0) return true;
      return n.derivesFrom.every(visit);
    };
    const terminates = visit(ref);
    return { chain: out.sort((a, b) => b.tier - a.tier), terminates };
  }

  /**
   * V-FR-02 / V-ON-03 / UCL-D01: every link resolves, the chain is acyclic and
   * terminates at Tier-0. Returns the computed tier (1 + max parent tier).
   */
  checkChain(chain: string[], kind: string, selfAliases: string[] = []): { violations: Violation[]; tier: number | null } {
    if (kind === 'Primitive') {
      return { violations: chain.length ? [{ rule: 'V-ON-03', message: 'a Tier-0 primitive derives from nothing' }] : [], tier: 0 };
    }
    if (chain.length === 0) return { violations: [{ rule: 'UCL-D01', message: 'derivation chain is empty; it must terminate in Tier-0' }], tier: null };
    const violations: Violation[] = [];
    let maxTier = -1;
    for (const link of chain) {
      const token = link.trim().split(/\s+/)[0];
      if (selfAliases.includes(token)) {
        violations.push({ rule: 'UCL-D02', message: `derivation chain contains itself (${token})` });
        continue;
      }
      const d = this.derivation(link);
      if (!d.terminates) violations.push({ rule: 'UCL-D03', message: `derivation link ${link} does not resolve to a chain terminating in Tier-0` });
      else maxTier = Math.max(maxTier, this.lookup(link)!.tier);
    }
    return { violations, tier: violations.length ? null : maxTier + 1 };
  }

  /** UCL-F09: prohibited nouns found in a statement. */
  prohibitedTerms(text: string): { term: string; cls: string }[] {
    const lower = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ')} `;
    return this.lexicon.terms.filter((t) => new RegExp(`[\\s-]${t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?[\\s-]`).test(lower));
  }
}
