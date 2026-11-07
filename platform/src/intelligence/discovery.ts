import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';

export interface DiscoveryResult {
  id: string;
  name: string;
  kind: string;
  registry: string;
  namespace: string;
  status: string;
  statement: string;
  score: number;
  relevance: number;
  flags: string[];
  successor: string | null;
}

const STATUS_WEIGHT: Record<string, number> = { CERTIFIED: 1, ADMISSIBLE: 1, EFFECTIVE: 0.9, ACTIVE: 0.9, DEPLOYED: 0.85, RATIFIED: 0.6, PROPOSED: 0.4, DRAFT: 0.2, DEPRECATED: 0.15, SUPERSEDED: 0.1, RETIRED: 0.05 };

/**
 * Discovery Engine (Phase 004 §9, Phase 010 §5.3): intent → semantic match →
 * authority filter → supersession filter → ranking → resolution with
 * provenance. Superseded entries are returned flagged, never silently
 * current (D-RG-03); deprecated ones carry their successor (D-RG-04); and
 * DERIVES-FROM traversal suggests more primitive alternatives (D-RG-06).
 */
export class DiscoveryEngine {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  private ftsQuery(text: string): string | null {
    const words = text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .slice(0, 12);
    if (!words.length) return null;
    return words.map((w) => `"${w}"*`).join(' OR ');
  }

  search(query: string, options: { kinds?: string[]; namespace?: string; limit?: number; includeInstances?: boolean; actor?: Actor } = {}): { query: string; total: number; results: DiscoveryResult[]; suggestions: { alias: string; name: string; tier: number }[] } {
    const limit = Math.min(options.limit ?? this.p.cfg.discovery.defaultLimit, this.p.cfg.discovery.maxLimit);
    const fts = this.ftsQuery(query);
    const empty = { query, total: 0, results: [] as DiscoveryResult[], suggestions: [] as { alias: string; name: string; tier: number }[] };
    if (!fts) return empty;
    const rows = this.p.store.db
      .prepare(
        `SELECT s.canonical_id id, bm25(search, 0, 0, 10.0, 3.0, 2.0) rank, h.kind, h.registry_id, h.namespace, h.status, h.canonical_name, h.tier
         FROM search s JOIN heads h ON h.canonical_id = s.canonical_id
         WHERE search MATCH ? ${options.kinds?.length ? `AND h.kind IN (${options.kinds.map(() => '?').join(',')})` : ''} ${options.namespace ? 'AND h.namespace = ?' : ''}
         ORDER BY rank LIMIT ?`,
      )
      .all(fts, ...(options.kinds ?? []), ...(options.namespace ? [options.namespace] : []), limit * 4) as { id: string; rank: number; kind: string; registry_id: string; namespace: string; status: string; canonical_name: string; tier: number | null }[];
    const qLower = query.toLowerCase().trim();
    const scored = rows.map((r) => {
      const relevance = -r.rank;
      const exact = r.canonical_name.toLowerCase() === qLower ? 2 : r.canonical_name.toLowerCase().includes(qLower) ? 0.5 : 0;
      const authority = STATUS_WEIGHT[r.status] ?? 0.3;
      const specificity = r.tier === null ? 0 : Math.max(0, 5 - r.tier) * 0.05;
      const e = this.p.fabric.get(r.id)!;
      const flags: string[] = [];
      if (r.status === 'SUPERSEDED') flags.push(`SUPERSEDED by ${e.supersededBy}`);
      if (r.status === 'DEPRECATED') flags.push(`DEPRECATED; successor ${e.successor ?? 'unstated'}`);
      if (e.content.inferred === true) flags.push(`INFERRED (confidence ${String(e.content.confidence)})`);
      if (e.classification.namespace !== 'UCOS' && options.namespace && e.classification.namespace !== options.namespace) flags.push('REFERENCE (outside requested envelope)');
      return {
        id: r.id,
        name: r.canonical_name,
        kind: r.kind,
        registry: r.registry_id,
        namespace: r.namespace,
        status: r.status,
        statement: e.definition.canonicalStatement.slice(0, 400),
        score: Math.round((relevance * authority + exact + specificity) * 1000) / 1000,
        relevance: Math.round(relevance * 1000) / 1000,
        flags,
        successor: e.supersededBy ?? e.successor ?? null,
      };
    });
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const results = scored.slice(0, limit);
    const suggestions = results.length ? this.suggestPrimitive(results[0].name).chain.map((c) => ({ alias: c.alias, name: c.name, tier: c.tier })) : [];
    const actor = options.actor ?? this.p.systemActor();
    this.p.bus.emit({ type: 'int.discovery.resolved', subject: results[0]?.id ?? null, actor, payload: { query, results: results.length, purpose: 'discovery' }, context: { purpose: 'discovery', reality: 'actual' } });
    return { query, total: scored.length, results, suggestions };
  }

  /** D-RG-06: the more primitive concepts a requester could reuse instead of authoring anew. */
  suggestPrimitive(text: string): { chain: { alias: string; name: string; tier: number; derivesFrom: string[] }[] } {
    const words = text.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length > 2);
    const concepts = this.p.ontology.concepts().concat(this.p.ontology.primitives());
    let best: { alias: string; score: number } | null = null;
    for (const c of concepts) {
      const name = c.name.toLowerCase();
      const score = words.reduce((s, w) => s + (name === w ? 3 : name.startsWith(w) || w.startsWith(name) ? 1 : 0), 0);
      if (score > 0 && (!best || score > best.score || (score === best.score && c.tier < (this.p.ontology.lookup(best.alias)?.tier ?? 9)))) best = { alias: c.alias, score };
    }
    if (!best) return { chain: [] };
    return { chain: this.p.ontology.derivation(best.alias).chain };
  }
}
