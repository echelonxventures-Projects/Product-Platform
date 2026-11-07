import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonicalJson, chainHash, GENESIS_HASH, sha256 } from './hash.ts';

/**
 * The physical substrate. Two tables are constitutionally append-only —
 * `versions` (every artifact version, RG-P3 / FR-SEC-02) and `events` (the
 * audit trail, UCI-011). Both are hash-chained (FR-SEC-03). UPDATE and DELETE
 * on them are refused by the database itself, so no code path can violate the
 * rule. Every other table is a projection, rebuildable from those two.
 */
const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 10000;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sequences (scope TEXT PRIMARY KEY, next INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS versions (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id  TEXT NOT NULL,
  version       INTEGER NOT NULL,
  registry_id   TEXT NOT NULL,
  body          TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  prev_hash     TEXT NOT NULL,
  chain_hash    TEXT NOT NULL,
  recorded_at   TEXT NOT NULL,
  actor         TEXT NOT NULL,
  action        TEXT NOT NULL,
  UNIQUE (canonical_id, version)
);
CREATE TRIGGER IF NOT EXISTS versions_no_update BEFORE UPDATE ON versions
  BEGIN SELECT RAISE(ABORT, 'RG-P3 versions are append-only'); END;
CREATE TRIGGER IF NOT EXISTS versions_no_delete BEFORE DELETE ON versions
  BEGIN SELECT RAISE(ABORT, 'FR-SEC-05 no deletion, ever'); END;

CREATE TABLE IF NOT EXISTS events (
  seq            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id       TEXT NOT NULL UNIQUE,
  type           TEXT NOT NULL,
  subject        TEXT,
  actor          TEXT NOT NULL,
  authority      TEXT NOT NULL,
  occurred_at    TEXT NOT NULL,
  reality        TEXT NOT NULL,
  canonical      INTEGER NOT NULL,
  causation_id   TEXT,
  correlation_id TEXT,
  payload        TEXT NOT NULL,
  context        TEXT NOT NULL,
  prev_hash      TEXT NOT NULL,
  chain_hash     TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'V-EV-05 events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'UCI-011 the audit trail is permanent'); END;
CREATE INDEX IF NOT EXISTS events_subject ON events(subject);
CREATE INDEX IF NOT EXISTS events_type ON events(type);
CREATE INDEX IF NOT EXISTS events_correlation ON events(correlation_id);

CREATE TABLE IF NOT EXISTS heads (
  canonical_id   TEXT PRIMARY KEY,
  registry_id    TEXT NOT NULL,
  kind           TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  qualified_name TEXT NOT NULL UNIQUE,
  status         TEXT NOT NULL,
  version        INTEGER NOT NULL,
  tier           INTEGER,
  owner          TEXT,
  namespace      TEXT,
  statement_key  TEXT,
  body           TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS heads_registry ON heads(registry_id);
CREATE INDEX IF NOT EXISTS heads_kind ON heads(kind);
CREATE INDEX IF NOT EXISTS heads_status ON heads(status);
CREATE INDEX IF NOT EXISTS heads_namespace ON heads(namespace);
CREATE INDEX IF NOT EXISTS heads_statement ON heads(statement_key);

CREATE TABLE IF NOT EXISTS aliases (
  alias        TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  form         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS aliases_target ON aliases(canonical_id);

CREATE TABLE IF NOT EXISTS edges (
  id         TEXT PRIMARY KEY,
  type       TEXT NOT NULL,
  source     TEXT NOT NULL,
  target     TEXT NOT NULL,
  status     TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edges_source ON edges(source, type);
CREATE INDEX IF NOT EXISTS edges_target ON edges(target, type);

CREATE TABLE IF NOT EXISTS search_rows (canonical_id TEXT PRIMARY KEY, rid INTEGER NOT NULL, text_key TEXT NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS search USING fts5(
  canonical_id UNINDEXED, registry_id UNINDEXED, name, statement, descriptors,
  tokenize = 'porter unicode61'
);
`;

export interface VersionRow {
  seq: number;
  canonical_id: string;
  version: number;
  registry_id: string;
  body: string;
  content_hash: string;
  prev_hash: string;
  chain_hash: string;
  recorded_at: string;
  actor: string;
  action: string;
}

export interface HeadRow {
  canonical_id: string;
  registry_id: string;
  kind: string;
  canonical_name: string;
  qualified_name: string;
  status: string;
  version: number;
  tier: number | null;
  owner: string | null;
  namespace: string | null;
  statement_key: string | null;
  body: string;
  updated_at: string;
}

export interface EventRow {
  seq: number;
  event_id: string;
  type: string;
  subject: string | null;
  actor: string;
  authority: string;
  occurred_at: string;
  reality: string;
  canonical: number;
  causation_id: string | null;
  correlation_id: string | null;
  payload: string;
  context: string;
  prev_hash: string;
  chain_hash: string;
}

export interface EdgeRow {
  id: string;
  type: string;
  source: string;
  target: string;
  status: string;
  body: string;
  created_at: string;
}

export interface HeadProjection {
  registryId: string;
  kind: string;
  canonicalName: string;
  qualifiedName: string;
  status: string;
  tier: number | null;
  owner: string | null;
  namespace: string | null;
  statementKey: string | null;
  descriptors: string;
  statement: string;
}

export class Store {
  readonly db: DatabaseSync;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  private lastVersionHashCache: string | null = null;
  private lastEventHashCache: string | null = null;
  private readonly commitHooks: (() => void)[] = [];
  private readonly rollbackHooks: (() => void)[] = [];

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  prepare(sql: string): StatementSync {
    let st = this.statements.get(sql);
    if (!st) {
      st = this.db.prepare(sql);
      this.statements.set(sql, st);
    }
    return st;
  }

  /**
   * Transaction with true nesting: the outermost call opens a transaction,
   * inner calls open savepoints, so a refused inner operation rolls back
   * exactly its own writes and nothing else.
   */
  tx<T>(fn: () => T): T {
    const depth = this.depth;
    const sp = `sp${depth}`;
    this.db.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const out = fn();
      this.db.exec(depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      if (depth === 0) {
        this.depth = 0;
        for (const h of this.commitHooks) h();
      }
      return out;
    } catch (err) {
      this.db.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      this.lastVersionHashCache = null;
      this.lastEventHashCache = null;
      if (depth === 0) for (const h of this.rollbackHooks) h();
      throw err;
    } finally {
      this.depth = depth;
    }
  }

  inTransaction(): boolean {
    return this.depth > 0;
  }

  onCommit(hook: () => void): void {
    this.commitHooks.push(hook);
  }

  onRollback(hook: () => void): void {
    this.rollbackHooks.push(hook);
  }

  getMeta(key: string): string | undefined {
    const row = this.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string): void {
    this.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  nextSequence(scope: string): number {
    const row = this.prepare('SELECT next FROM sequences WHERE scope = ?').get(scope) as { next: number } | undefined;
    const n = row ? row.next : 1;
    this.prepare('INSERT INTO sequences(scope, next) VALUES(?, ?) ON CONFLICT(scope) DO UPDATE SET next = excluded.next').run(scope, n + 1);
    return n;
  }

  /** Reserves a specific sequence value (used when seeds carry pre-minted ids). */
  observeSequence(scope: string, value: number): void {
    const row = this.prepare('SELECT next FROM sequences WHERE scope = ?').get(scope) as { next: number } | undefined;
    if (!row || row.next <= value) {
      this.prepare('INSERT INTO sequences(scope, next) VALUES(?, ?) ON CONFLICT(scope) DO UPDATE SET next = excluded.next').run(scope, value + 1);
    }
  }

  // ── versions ────────────────────────────────────────────────────────────

  private lastVersionHash(): string {
    if (this.lastVersionHashCache) return this.lastVersionHashCache;
    const row = this.prepare('SELECT chain_hash FROM versions ORDER BY seq DESC LIMIT 1').get() as { chain_hash: string } | undefined;
    return row?.chain_hash ?? GENESIS_HASH;
  }

  appendVersion(
    canonicalId: string,
    body: Record<string, unknown>,
    projection: HeadProjection,
    actor: string,
    action: string,
    recordedAt: string,
  ): { version: number; contentHash: string; chainHash: string } {
    const head = this.prepare('SELECT version FROM heads WHERE canonical_id = ?').get(canonicalId) as { version: number } | undefined;
    const version = (head?.version ?? 0) + 1;
    const withVersion = { ...body, version };
    const serialised = canonicalJson(withVersion);
    const contentHash = sha256(serialised);
    const prevHash = this.lastVersionHash();
    const record = { canonicalId, version, registryId: projection.registryId, contentHash, recordedAt, actor, action };
    const chain = chainHash(prevHash, record);
    this.prepare(
      `INSERT INTO versions(canonical_id, version, registry_id, body, content_hash, prev_hash, chain_hash, recorded_at, actor, action)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(canonicalId, version, projection.registryId, serialised, contentHash, prevHash, chain, recordedAt, actor, action);
    this.lastVersionHashCache = chain;
    this.prepare(
      `INSERT INTO heads(canonical_id, registry_id, kind, canonical_name, qualified_name, status, version, tier, owner, namespace, statement_key, body, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(canonical_id) DO UPDATE SET registry_id = excluded.registry_id, kind = excluded.kind,
         canonical_name = excluded.canonical_name, qualified_name = excluded.qualified_name, status = excluded.status,
         version = excluded.version, tier = excluded.tier, owner = excluded.owner, namespace = excluded.namespace,
         statement_key = excluded.statement_key, body = excluded.body, updated_at = excluded.updated_at`,
    ).run(
      canonicalId,
      projection.registryId,
      projection.kind,
      projection.canonicalName,
      projection.qualifiedName,
      projection.status,
      version,
      projection.tier,
      projection.owner,
      projection.namespace,
      projection.statementKey,
      serialised,
      recordedAt,
    );
    // The search index is keyed by rowid (FTS columns are not indexed) and is
    // rewritten only when the searchable text changes.
    const textKey = sha256(`${projection.canonicalName}\u0000${projection.statement}\u0000${projection.descriptors}`);
    const indexed = this.prepare('SELECT rid, text_key FROM search_rows WHERE canonical_id = ?').get(canonicalId) as { rid: number; text_key: string } | undefined;
    if (!indexed || indexed.text_key !== textKey) {
      if (indexed) this.prepare('DELETE FROM search WHERE rowid = ?').run(indexed.rid);
      const info = this.prepare('INSERT INTO search(canonical_id, registry_id, name, statement, descriptors) VALUES (?, ?, ?, ?, ?)').run(
        canonicalId,
        projection.registryId,
        projection.canonicalName,
        projection.statement,
        projection.descriptors,
      );
      this.prepare('INSERT INTO search_rows(canonical_id, rid, text_key) VALUES (?, ?, ?) ON CONFLICT(canonical_id) DO UPDATE SET rid = excluded.rid, text_key = excluded.text_key').run(canonicalId, Number(info.lastInsertRowid), textKey);
    }
    return { version, contentHash, chainHash: chain };
  }

  head(canonicalId: string): HeadRow | undefined {
    return this.prepare('SELECT * FROM heads WHERE canonical_id = ?').get(canonicalId) as HeadRow | undefined;
  }

  headByQualifiedName(qualifiedName: string): HeadRow | undefined {
    return this.prepare('SELECT * FROM heads WHERE qualified_name = ?').get(qualifiedName) as HeadRow | undefined;
  }

  versionsOf(canonicalId: string): VersionRow[] {
    return this.prepare('SELECT * FROM versions WHERE canonical_id = ? ORDER BY version').all(canonicalId) as unknown as VersionRow[];
  }

  version(canonicalId: string, version: number): VersionRow | undefined {
    return this.prepare('SELECT * FROM versions WHERE canonical_id = ? AND version = ?').get(canonicalId, version) as VersionRow | undefined;
  }

  // ── aliases ─────────────────────────────────────────────────────────────

  bindAlias(alias: string, canonicalId: string, form: string): void {
    const existing = this.prepare('SELECT canonical_id FROM aliases WHERE alias = ?').get(alias) as { canonical_id: string } | undefined;
    if (existing && existing.canonical_id !== canonicalId) {
      throw new Error(`V-ID-02 alias "${alias}" already resolves to ${existing.canonical_id}`);
    }
    if (!existing) this.prepare('INSERT INTO aliases(alias, canonical_id, form) VALUES (?, ?, ?)').run(alias, canonicalId, form);
  }

  resolveAlias(alias: string): string | undefined {
    const row = this.prepare('SELECT canonical_id FROM aliases WHERE alias = ?').get(alias) as { canonical_id: string } | undefined;
    return row?.canonical_id;
  }

  aliasesOf(canonicalId: string): { alias: string; form: string }[] {
    return this.prepare('SELECT alias, form FROM aliases WHERE canonical_id = ? ORDER BY alias').all(canonicalId) as unknown as { alias: string; form: string }[];
  }

  // ── edges (projection of relationship instances) ────────────────────────

  putEdge(edge: EdgeRow): void {
    this.prepare(
      `INSERT INTO edges(id, type, source, target, status, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body`,
    ).run(edge.id, edge.type, edge.source, edge.target, edge.status, edge.body, edge.created_at);
  }

  edgesFrom(source: string, type?: string): EdgeRow[] {
    return (type
      ? this.prepare("SELECT * FROM edges WHERE source = ? AND type = ? AND status = 'EFFECTIVE' ORDER BY created_at, id").all(source, type)
      : this.prepare("SELECT * FROM edges WHERE source = ? AND status = 'EFFECTIVE' ORDER BY type, created_at, id").all(source)) as unknown as EdgeRow[];
  }

  edgesTo(target: string, type?: string): EdgeRow[] {
    return (type
      ? this.prepare("SELECT * FROM edges WHERE target = ? AND type = ? AND status = 'EFFECTIVE' ORDER BY created_at, id").all(target, type)
      : this.prepare("SELECT * FROM edges WHERE target = ? AND status = 'EFFECTIVE' ORDER BY type, created_at, id").all(target)) as unknown as EdgeRow[];
  }

  edgesOfType(type: string): EdgeRow[] {
    return this.prepare("SELECT * FROM edges WHERE type = ? AND status = 'EFFECTIVE'").all(type) as unknown as EdgeRow[];
  }

  allEffectiveEdges(): EdgeRow[] {
    return this.prepare("SELECT * FROM edges WHERE status = 'EFFECTIVE'").all() as unknown as EdgeRow[];
  }

  // ── events ──────────────────────────────────────────────────────────────

  private lastEventHash(): string {
    if (this.lastEventHashCache) return this.lastEventHashCache;
    const row = this.prepare('SELECT chain_hash FROM events ORDER BY seq DESC LIMIT 1').get() as { chain_hash: string } | undefined;
    return row?.chain_hash ?? GENESIS_HASH;
  }

  appendEvent(e: Omit<EventRow, 'seq' | 'prev_hash' | 'chain_hash'>): EventRow {
    const prevHash = this.lastEventHash();
    const chain = chainHash(prevHash, e);
    const info = this.prepare(
      `INSERT INTO events(event_id, type, subject, actor, authority, occurred_at, reality, canonical, causation_id, correlation_id, payload, context, prev_hash, chain_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(e.event_id, e.type, e.subject, e.actor, e.authority, e.occurred_at, e.reality, e.canonical, e.causation_id, e.correlation_id, e.payload, e.context, prevHash, chain);
    this.lastEventHashCache = chain;
    return { ...e, seq: Number(info.lastInsertRowid), prev_hash: prevHash, chain_hash: chain };
  }

  // ── integrity ───────────────────────────────────────────────────────────

  /** Walks both hash chains and cross-checks projections (FR-SEC-03, FR-SEC-06). */
  verifyIntegrity(): { ok: boolean; versions: number; events: number; problems: string[] } {
    const problems: string[] = [];
    let prev = GENESIS_HASH;
    let versions = 0;
    for (const row of this.db.prepare('SELECT * FROM versions ORDER BY seq').iterate() as Iterable<VersionRow>) {
      versions++;
      if (row.prev_hash !== prev) problems.push(`versions#${row.seq} prev_hash break`);
      if (sha256(row.body) !== row.content_hash) problems.push(`versions#${row.seq} content hash mismatch for ${row.canonical_id}`);
      const record = { canonicalId: row.canonical_id, version: row.version, registryId: row.registry_id, contentHash: row.content_hash, recordedAt: row.recorded_at, actor: row.actor, action: row.action };
      const expected = chainHash(prev, record);
      if (expected !== row.chain_hash) problems.push(`versions#${row.seq} chain hash mismatch`);
      prev = row.chain_hash;
    }
    prev = GENESIS_HASH;
    let events = 0;
    for (const row of this.db.prepare('SELECT * FROM events ORDER BY seq').iterate() as Iterable<EventRow>) {
      events++;
      if (row.prev_hash !== prev) problems.push(`events#${row.seq} prev_hash break`);
      const { seq: _s, prev_hash: _p, chain_hash: _c, ...rest } = row;
      const expected = chainHash(prev, { ...rest });
      if (expected !== row.chain_hash) problems.push(`events#${row.seq} chain hash mismatch`);
      prev = row.chain_hash;
    }
    const drift = this.db
      .prepare(
        `SELECT h.canonical_id FROM heads h JOIN versions v ON v.canonical_id = h.canonical_id AND v.version = h.version
         WHERE v.body <> h.body`,
      )
      .all() as { canonical_id: string }[];
    for (const d of drift) problems.push(`projection drift on ${d.canonical_id}`);
    return { ok: problems.length === 0, versions, events, problems };
  }
}
