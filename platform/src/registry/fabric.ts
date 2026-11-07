import { randomUUID } from 'node:crypto';
import type { Store, HeadRow, EdgeRow } from '../kernel/store.ts';
import type { Clock } from '../kernel/clock.ts';
import type { EventBus, Actor } from '../kernel/events.ts';
import type { IdentityMint } from '../kernel/ids.ts';
import { ConstitutionalError, NotFoundError, type Violation } from '../kernel/errors.ts';
import { hashValue, normaliseStatement, canonicalJson } from '../kernel/hash.ts';
import type {
  Candidate,
  Entry,
  RegistryDefinition,
  ResolveResult,
  RelationshipInstance,
  RelationshipType,
  Dependency,
} from './types.ts';

export type CandidateValidator = (entry: Entry, registry: RegistryDefinition, phase: 'admission' | 'revalidation') => Violation[];
export type TransitionGuard = (entry: Entry, from: string, to: string, scope: Record<string, unknown>) => Violation[];

export interface LifecycleDefinition {
  id: string;
  name: string;
  states: string[];
  initial: string;
  terminals: string[];
  transitions: { from: string; to: string; guard?: string; guardRule?: string; effect?: string; cycle?: boolean; prose?: string }[];
  source?: string;
}

/** Resolves the ratifying body for an artifact from its tier and namespace (Phase 001 §7). */
export interface GovernancePort {
  ratifyingBodyFor(tier: number | null, namespace: string, registry: RegistryDefinition): string;
  certifyingBody(): string;
  registryOffice(): string;
  isMember(principal: string, body: string): boolean;
  quorumOf(body: string): number;
  assertSeparation(entry: Entry, principal: string, act: 'author' | 'ratify' | 'certify' | 'record'): void;
}

export interface LifecyclePort {
  get(ref: string): LifecycleDefinition;
  checkTransition(entry: Entry, to: string, scope: Record<string, unknown>): Violation[];
}

export interface Hooks {
  validators: CandidateValidator[];
  kindValidators: Map<string, CandidateValidator[]>;
  onCertified: ((entry: Entry) => void)[];
  onStatusChange: ((entry: Entry, from: string, to: string) => void)[];
  onPersist: ((entry: Entry) => void)[];
}

const FOUNDATION_STATUSES_ADMISSIBLE = new Set(['CERTIFIED', 'ADMISSIBLE']);

export class RegistryFabric {
  readonly store: Store;
  readonly clock: Clock;
  readonly bus: EventBus;
  readonly mint: IdentityMint;
  readonly hooks: Hooks = { validators: [], kindValidators: new Map(), onCertified: [], onStatusChange: [], onPersist: [] };
  governance!: GovernancePort;
  lifecycles!: LifecyclePort;

  private readonly registries = new Map<string, RegistryDefinition>();
  private readonly relTypes = new Map<string, RelationshipType>();
  private readonly namespaceKinds = new Map<string, string>();
  readonly relationshipRegistryId: string;
  readonly relationshipInstanceRegistryId: string;

  constructor(store: Store, clock: Clock, bus: EventBus, mint: IdentityMint, relationshipRegistryId: string, relationshipInstanceRegistryId: string) {
    this.store = store;
    this.clock = clock;
    this.bus = bus;
    this.mint = mint;
    this.relationshipRegistryId = relationshipRegistryId;
    this.relationshipInstanceRegistryId = relationshipInstanceRegistryId;
  }

  // ── registry definitions ────────────────────────────────────────────────

  defineRegistryInMemory(def: RegistryDefinition): void {
    this.registries.set(def.registryId, def);
  }

  registryDefinitions(): RegistryDefinition[] {
    return [...this.registries.values()];
  }

  registry(id: string): RegistryDefinition {
    const r = this.registries.get(id);
    if (!r) throw new NotFoundError('registry', id);
    return r;
  }

  hasRegistry(id: string): boolean {
    return this.registries.has(id);
  }

  /** Loads registry definitions and relationship types from the persisted fabric. */
  hydrate(): void {
    for (const row of this.store.prepare("SELECT body FROM heads WHERE kind = 'Registry'").all() as { body: string }[]) {
      const e = JSON.parse(row.body) as Entry;
      this.registries.set(e.canonicalId, e.content.definition as RegistryDefinition);
    }
    for (const row of this.store.prepare("SELECT body FROM heads WHERE kind = 'RelationshipType'").all() as { body: string }[]) {
      const e = JSON.parse(row.body) as Entry;
      const t = e.content as unknown as RelationshipType;
      this.relTypes.set(t.type, t);
    }
    for (const row of this.store.prepare("SELECT body FROM heads WHERE kind IN ('Universe','Namespace')").all() as { body: string }[]) {
      const e = JSON.parse(row.body) as Entry;
      this.namespaceKinds.set(String(e.content.code), String(e.content.namespaceKind ?? 'universe'));
    }
  }

  registerNamespace(code: string, namespaceKind: string): void {
    this.namespaceKinds.set(code, namespaceKind);
  }

  namespaceKind(code: string): string | undefined {
    return this.namespaceKinds.get(code);
  }

  /**
   * Envelope resolution (RG-P5, RG-P6, §8.1). An artifact belongs to the one
   * registry whose envelope contains (kind, namespace). None: no registry may
   * canonicalise it. More than one: the envelopes overlap, which is a UCI-002
   * violation that blocks admission.
   */
  registryFor(kind: string, namespace: string): RegistryDefinition {
    const nsKind = this.namespaceKinds.get(namespace);
    const matches = [...this.registries.values()].filter(
      (r) =>
        r.status !== 'SUPERSEDED' &&
        r.envelope.kinds.includes(kind) &&
        (r.envelope.namespaces.includes(namespace) || (nsKind !== undefined && r.envelope.namespaces.includes(`@${nsKind}`))),
    );
    if (matches.length === 0) throw new ConstitutionalError('RG-P6', `no registry envelope covers kind ${kind} in namespace ${namespace}`);
    if (matches.length > 1) throw new ConstitutionalError('UCI-002', `envelope overlap for ${kind}/${namespace}: ${matches.map((m) => m.registryId).join(', ')}`);
    return matches[0];
  }

  /** V-RG-03: envelopes are pairwise disjoint. */
  envelopeOverlaps(): Violation[] {
    const out: Violation[] = [];
    const regs = [...this.registries.values()].filter((r) => r.status !== 'SUPERSEDED');
    for (let i = 0; i < regs.length; i++) {
      for (let j = i + 1; j < regs.length; j++) {
        const a = regs[i];
        const b = regs[j];
        const kinds = a.envelope.kinds.filter((k) => b.envelope.kinds.includes(k));
        const ns = a.envelope.namespaces.filter((n) => b.envelope.namespaces.includes(n));
        if (kinds.length && ns.length) out.push({ rule: 'V-RG-03', message: `envelopes of ${a.registryId} and ${b.registryId} overlap on ${kinds.join(',')} × ${ns.join(',')}` });
      }
    }
    return out;
  }

  // ── relationship types ──────────────────────────────────────────────────

  defineRelationshipTypeInMemory(t: RelationshipType): void {
    this.relTypes.set(t.type, t);
  }

  relationshipType(type: string): RelationshipType {
    const t = this.relTypes.get(type);
    if (!t) throw new ConstitutionalError('R-02', `relationship type ${type} is not registered`);
    return t;
  }

  relationshipTypes(): RelationshipType[] {
    return [...this.relTypes.values()];
  }

  /** Maps an inverse name back to its stored forward type (R-05: inverses are derived, never stored). */
  forwardOf(name: string): { type: string; inverted: boolean } {
    if (this.relTypes.has(name)) return { type: name, inverted: false };
    for (const t of this.relTypes.values()) if (t.inverse === name) return { type: t.type, inverted: true };
    throw new ConstitutionalError('R-02', `relationship ${name} is neither a registered type nor a registered inverse`);
  }

  // ── reading ─────────────────────────────────────────────────────────────

  get(canonicalId: string): Entry | undefined {
    const row = this.store.head(canonicalId);
    return row ? (JSON.parse(row.body) as Entry) : undefined;
  }

  require(canonicalId: string): Entry {
    const e = this.get(canonicalId);
    if (!e) throw new NotFoundError('artifact', canonicalId);
    return e;
  }

  headRow(canonicalId: string): HeadRow | undefined {
    return this.store.head(canonicalId);
  }

  /**
   * RESOLVE: canonicalId | alias | externalId | qualified name → current
   * certified entry, traversing supersession transparently but never
   * silently (D-FR-04, D-RG-03).
   */
  resolve(ref: string): ResolveResult {
    let via: ResolveResult['via'] = 'canonical';
    let id: string | undefined = this.store.head(ref) ? ref : undefined;
    if (!id) {
      const aliasTarget = this.store.resolveAlias(ref);
      if (aliasTarget) {
        id = aliasTarget;
        const form = this.store.aliasesOf(aliasTarget).find((a) => a.alias === ref)?.form;
        via = form === 'external' ? 'external' : 'alias';
      }
    }
    if (!id) {
      const byName = this.store.headByQualifiedName(ref);
      if (byName) {
        id = byName.canonical_id;
        via = 'qualified-name';
      }
    }
    if (!id) throw new NotFoundError('artifact', ref);
    const chain: string[] = [id];
    let entry = this.require(id);
    const seen = new Set<string>([id]);
    while (entry.supersededBy) {
      if (seen.has(entry.supersededBy)) throw new ConstitutionalError('UCI-014', `supersession cycle at ${entry.supersededBy}`);
      seen.add(entry.supersededBy);
      chain.push(entry.supersededBy);
      entry = this.require(entry.supersededBy);
    }
    return { entry, resolvedFrom: ref, via, superseded: chain.length > 1, supersessionChain: chain, deprecated: entry.lifecycle.status === 'DEPRECATED' };
  }

  tryResolve(ref: string): ResolveResult | undefined {
    try {
      return this.resolve(ref);
    } catch (e) {
      if (e instanceof NotFoundError) return undefined;
      throw e;
    }
  }

  exists(ref: string): boolean {
    return !!this.store.head(ref) || !!this.store.resolveAlias(ref) || !!this.store.headByQualifiedName(ref);
  }

  query(filter: {
    registryId?: string;
    kind?: string | string[];
    status?: string | string[];
    namespace?: string;
    nameLike?: string;
    contentPath?: string;
    contentEquals?: string | number | boolean;
    limit?: number;
    offset?: number;
  }): { total: number; entries: Entry[] } {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const inList = (col: string, v: string | string[]) => {
      const list = Array.isArray(v) ? v : [v];
      where.push(`${col} IN (${list.map(() => '?').join(',')})`);
      args.push(...list);
    };
    if (filter.registryId) {
      where.push('registry_id = ?');
      args.push(filter.registryId);
    }
    if (filter.kind) inList('kind', filter.kind);
    if (filter.status) inList('status', filter.status);
    if (filter.namespace) {
      where.push('namespace = ?');
      args.push(filter.namespace);
    }
    if (filter.nameLike) {
      where.push('canonical_name LIKE ?');
      args.push(`%${filter.nameLike}%`);
    }
    if (filter.contentPath && filter.contentEquals !== undefined) {
      if (!/^[A-Za-z0-9_.]+$/.test(filter.contentPath)) throw new ConstitutionalError('V-RU-01', 'invalid content path');
      where.push(`json_extract(body, '$.content.${filter.contentPath}') = ?`);
      args.push(typeof filter.contentEquals === 'boolean' ? Number(filter.contentEquals) : filter.contentEquals);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.store.db.prepare(`SELECT COUNT(*) n FROM heads ${clause}`).get(...args) as { n: number }).n;
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 100_000));
    const offset = Math.max(0, filter.offset ?? 0);
    const rows = this.store.db.prepare(`SELECT body FROM heads ${clause} ORDER BY canonical_id LIMIT ${limit} OFFSET ${offset}`).all(...args) as { body: string }[];
    return { total, entries: rows.map((r) => JSON.parse(r.body) as Entry) };
  }

  iterate(kind?: string): Iterable<Entry> {
    const stmt = kind ? this.store.db.prepare('SELECT body FROM heads WHERE kind = ? ORDER BY canonical_id') : this.store.db.prepare("SELECT body FROM heads WHERE kind <> 'RelationshipInstance' ORDER BY canonical_id");
    const it = (kind ? stmt.iterate(kind) : stmt.iterate()) as Iterable<{ body: string }>;
    return (function* () {
      for (const r of it) yield JSON.parse(r.body) as Entry;
    })();
  }

  countBy(column: 'registry_id' | 'kind' | 'status' | 'namespace'): Record<string, number> {
    const rows = this.store.db.prepare(`SELECT ${column} k, COUNT(*) n FROM heads GROUP BY ${column}`).all() as { k: string; n: number }[];
    return Object.fromEntries(rows.map((r) => [r.k ?? '(none)', r.n]));
  }

  lineage(canonicalId: string): { versions: { version: number; action: string; actor: string; recordedAt: string; contentHash: string; chainHash: string; status: string }[]; events: unknown[] } {
    const versions = this.store.versionsOf(canonicalId).map((v) => ({
      version: v.version,
      action: v.action,
      actor: v.actor,
      recordedAt: v.recorded_at,
      contentHash: v.content_hash,
      chainHash: v.chain_hash,
      status: (JSON.parse(v.body) as Entry).lifecycle.status,
    }));
    if (versions.length === 0) throw new NotFoundError('artifact', canonicalId);
    return { versions, events: this.bus.query({ subject: canonicalId, limit: 1000 }).reverse() };
  }

  /** DEPENDENTS: computed, never authored (Phase 001 §8). */
  dependents(canonicalId: string): { source: string; type: string }[] {
    const out = new Map<string, { source: string; type: string }>();
    for (const t of ['DEPENDS-ON', 'DERIVES-FROM', 'PART-OF']) {
      for (const e of this.store.edgesTo(canonicalId, t)) {
        const head = this.store.head(e.source);
        if (head && !['RETIRED', 'SUPERSEDED', 'REJECTED', 'WITHDRAWN'].includes(head.status)) out.set(`${e.source}|${t}`, { source: e.source, type: t });
      }
    }
    return [...out.values()];
  }

  /** ATTEST: verifiable certification evidence (FR-SEC-06). */
  attest(canonicalId: string): Record<string, unknown> {
    const entry = this.require(canonicalId);
    const versions = this.store.versionsOf(canonicalId);
    const last = versions[versions.length - 1];
    return {
      canonicalId,
      status: entry.lifecycle.status,
      version: last.version,
      contentHash: last.content_hash,
      chainHash: last.chain_hash,
      recordedAt: last.recorded_at,
      certification: entry.evidence.certification ?? null,
      ratification: entry.evidence.ratification ?? null,
      validation: entry.evidence.validation ?? null,
      verifiable: FOUNDATION_STATUSES_ADMISSIBLE.has(entry.lifecycle.status) && !!entry.evidence.certification,
    };
  }

  // ── writing ─────────────────────────────────────────────────────────────

  private persist(entry: Entry, actor: Actor, action: string): Entry {
    // Only definitional statements carry a knowledge key; the same threshold governs admission and audit (UCI-003).
    const statementKey = entry.definition.canonicalStatement.length >= 24 ? normaliseStatement(entry.definition.canonicalStatement) : null;
    const { version } = this.store.appendVersion(
      entry.canonicalId,
      entry as unknown as Record<string, unknown>,
      {
        registryId: entry.registryId,
        kind: entry.kind,
        canonicalName: entry.definition.canonicalName,
        qualifiedName: qualifiedName(entry),
        status: entry.lifecycle.status,
        tier: entry.classification.tier,
        owner: entry.ownership.canonicalOwner,
        namespace: entry.classification.namespace,
        statementKey: statementKey ? hashValue(statementKey).slice(0, 32) : null,
        descriptors: [...entry.descriptors, ...entry.identity.aliases, ...Object.values(entry.labels)].join(' '),
        statement: entry.definition.canonicalStatement,
      },
      actor.principal,
      action,
      this.clock.now(),
    );
    entry.version = version;
    for (const h of this.hooks.onPersist) h(entry);
    return entry;
  }

  /** Builds the full spine from a candidate, assigning identity and governance. */
  materialise(candidate: Candidate, actor: Actor): { entry: Entry; registry: RegistryDefinition } {
    const namespace = candidate.namespace ?? 'UCOS';
    const registry = this.registryFor(candidate.kind, namespace);
    let canonicalId = candidate.canonicalId;
    if (canonicalId) {
      if (!this.mint.isCanonical(canonicalId)) throw new ConstitutionalError('V-FR-01', `${canonicalId} does not match the identification scheme`);
      if (this.store.head(canonicalId)) throw new ConstitutionalError('UCI-001', `${canonicalId} is already minted`);
      this.mint.observe(canonicalId);
    } else {
      const scheme = registry.identityByKind?.[candidate.kind] ?? registry.identity;
      canonicalId = this.mint.mint(scheme.layer, scheme.type);
    }
    const lifecycle = this.lifecycles.get(registry.lifecycleRef);
    const tier = candidate.tier ?? registry.tier;
    const entry: Entry = {
      canonicalId,
      registryId: registry.registryId,
      kind: candidate.kind,
      identity: { canonicalId, aliases: dedupe(candidate.aliases ?? []), externalIds: dedupe(candidate.externalIds ?? []) },
      definition: {
        canonicalName: candidate.name.trim(),
        canonicalStatement: (candidate.statement ?? '').trim(),
        // Every artifact derives from the construct its registry instantiates (UCL-D01).
        derivationChain: candidate.derivationChain ?? (registry.construct ? [registry.construct] : []),
      },
      classification: { tier, layer: candidate.layer ?? registry.entryModel, namespace, taxonomyPaths: candidate.taxonomyPaths ?? [] },
      ownership: {
        canonicalOwner: candidate.ownerOverride ?? registry.owner,
        ratifyingBody: this.governance.ratifyingBodyFor(tier, namespace, registry),
        certifyingBody: this.governance.certifyingBody(),
      },
      lifecycle: { status: lifecycle.initial, lifecycleRef: registry.lifecycleRef },
      dependencies: candidate.dependencies ?? [],
      securityPosture: { level: candidate.securityLevel ?? registry.securityDefault, accessPolicy: candidate.accessPolicy },
      evidence: {},
      descriptors: dedupe(candidate.descriptors ?? []),
      labels: candidate.labels ?? {},
      provenance: {
        source: candidate.provenance?.source ?? 'api',
        locator: candidate.provenance?.locator,
        recordedBy: actor.principal,
        recordedAt: this.clock.now(),
      },
      content: candidate.content ?? {},
    };
    return { entry, registry };
  }

  validate(entry: Entry, registry: RegistryDefinition, phase: 'admission' | 'revalidation' = 'admission'): Violation[] {
    const out: Violation[] = [];
    for (const v of this.hooks.validators) out.push(...v(entry, registry, phase));
    for (const v of this.hooks.kindValidators.get(entry.kind) ?? []) out.push(...v(entry, registry, phase));
    return out;
  }

  /**
   * ADMIT (Phase 004 §7). Validates the candidate through every layer of the
   * constitutional validation engine and records it in its initial state.
   * A refusal is itself recorded as an audited event with reasons
   * (Phase 001 §5.3).
   */
  submit(candidate: Candidate, actor: Actor, options: { correlationId?: string; context?: Record<string, unknown> } = {}): Entry {
    return this.store.tx(() => {
      const { entry, registry } = this.materialise(candidate, actor);
      const violations = this.validate(entry, registry);
      entry.evidence.validation = {
        at: this.clock.now(),
        passed: violations.length === 0,
        rules: ['UCI-*', 'V-FR-*', 'V-MM-*', `kind:${entry.kind}`],
        violations: violations.map((v) => ({ rule: v.rule, message: v.message })),
      };
      if (violations.length > 0) {
        this.bus.emit({
          type: registry.admissionMode === 'constitutional' ? 'fr.artifact.rejected' : 'reg.entry.rejected',
          subject: entry.canonicalId,
          actor,
          payload: { kind: entry.kind, name: entry.definition.canonicalName, violations },
          context: options.context,
          correlationId: options.correlationId,
        });
        throw new ConstitutionalError(violations[0].rule, `admission refused for ${entry.kind} "${entry.definition.canonicalName}": ${violations.map((v) => `${v.rule} ${v.message}`).join('; ')}`, violations);
      }
      for (const alias of entry.identity.aliases) this.store.bindAlias(alias, entry.canonicalId, 'alias');
      for (const ext of entry.identity.externalIds) this.store.bindAlias(ext, entry.canonicalId, 'external');
      this.persist(entry, actor, 'ADMIT');
      this.projectStructuralEdges(entry, actor);
      for (const rel of candidate.relationships ?? []) this.relate(rel.type, entry.canonicalId, rel.target, actor, { context: rel.context });
      this.bus.emit({
        type: 'reg.entry.admitted',
        subject: entry.canonicalId,
        actor,
        payload: { registryId: registry.registryId, kind: entry.kind, name: entry.definition.canonicalName, status: entry.lifecycle.status },
        context: options.context,
        correlationId: options.correlationId,
      });
      return entry;
    });
  }

  /** Projects declared dependencies and derivation chains as typed edges. */
  private projectStructuralEdges(entry: Entry, actor: Actor): void {
    for (const dep of entry.dependencies) {
      const target = this.resolveTargetId(dep.target);
      if (target && target !== entry.canonicalId) this.relate('DEPENDS-ON', entry.canonicalId, target, actor, { context: { dependencyType: dep.type }, skipValidation: false });
    }
    for (const link of entry.definition.derivationChain) {
      const target = this.resolveTargetId(link.split(' ')[0]);
      if (target && target !== entry.canonicalId) this.relate('DERIVES-FROM', entry.canonicalId, target, actor, {});
    }
  }

  private resolveTargetId(ref: string): string | undefined {
    return this.tryResolve(ref)?.entry.canonicalId ?? (this.store.head(ref) ? ref : undefined);
  }

  /**
   * Applies a lifecycle transition (UCI-008). The transition must be declared
   * in the entry's registered lifecycle and its guard must hold.
   */
  transition(canonicalId: string, to: string, actor: Actor, scope: Record<string, unknown> = {}, mutate?: (e: Entry) => void, eventType?: string): Entry {
    return this.store.tx(() => {
      const entry = this.require(canonicalId);
      const from = entry.lifecycle.status;
      const next: Entry = structuredClone(entry);
      mutate?.(next);
      const violations = this.lifecycles.checkTransition(next, to, { ...scope, from, to, actor });
      if (violations.length) {
        this.bus.emit({ type: 'reg.transition.refused', subject: canonicalId, actor, payload: { from, to, violations } });
        throw new ConstitutionalError(violations[0].rule, `transition ${from} → ${to} refused for ${canonicalId}: ${violations.map((v) => v.message).join('; ')}`, violations);
      }
      next.lifecycle.status = to;
      this.persist(next, actor, `TRANSITION:${from}->${to}`);
      this.bus.emit({ type: eventType ?? 'reg.entry.transitioned', subject: canonicalId, actor, payload: { from, to, kind: next.kind } });
      for (const h of this.hooks.onStatusChange) h(next, from, to);
      if (to === 'CERTIFIED') for (const h of this.hooks.onCertified) h(next);
      return next;
    });
  }

  /** Records a new version without a state change (e.g. appended evidence). */
  amend(canonicalId: string, actor: Actor, mutate: (e: Entry) => void, action: string, eventType?: string): Entry {
    return this.store.tx(() => {
      const entry = structuredClone(this.require(canonicalId));
      const beforeName = entry.definition.canonicalName;
      const beforeStatement = entry.definition.canonicalStatement;
      mutate(entry);
      if (entry.lifecycle.status === 'CERTIFIED' && (entry.definition.canonicalName !== beforeName || entry.definition.canonicalStatement !== beforeStatement)) {
        throw new ConstitutionalError('UCL-F07', `${canonicalId} is certified; its meaning is immutable — supersede instead (M-03)`);
      }
      this.persist(entry, actor, action);
      if (eventType) this.bus.emit({ type: eventType, subject: canonicalId, actor, payload: { action } });
      return entry;
    });
  }

  // ── governance pipeline (constitutional admission mode) ─────────────────

  propose(canonicalId: string, actor: Actor): Entry {
    this.governance.assertSeparation(this.require(canonicalId), actor.principal, 'author');
    return this.transition(canonicalId, 'PROPOSED', actor, {}, (e) => {
      e.evidence.proposal = { at: this.clock.now(), by: actor.principal };
    });
  }

  /**
   * RATIFY with a quorum of distinct members of the competent body
   * (PROPOSED → RATIFIED guard: quorum; no open dispute).
   */
  ratify(canonicalId: string, approvers: Actor[]): Entry {
    const entry = this.require(canonicalId);
    const body = entry.ownership.ratifyingBody;
    const distinct = [...new Map(approvers.map((a) => [a.principal, a])).values()];
    for (const a of distinct) {
      if (!this.governance.isMember(a.principal, body)) throw new ConstitutionalError('GI-1', `${a.principal} is not a member of ratifying body ${body}`);
      this.governance.assertSeparation(entry, a.principal, 'ratify');
    }
    const quorum = this.governance.quorumOf(body);
    if (distinct.length < quorum) throw new ConstitutionalError('UCL-G05', `ratification of ${canonicalId} requires quorum ${quorum} of ${body}; got ${distinct.length}`);
    const now = this.clock.now();
    return this.transition(
      canonicalId,
      'RATIFIED',
      { ...distinct[0], authority: body },
      { quorum, approvals: distinct.length },
      (e) => {
        e.evidence.ratification = { at: now, body, approvals: distinct.map((a) => ({ principal: a.principal, at: now })), quorum };
      },
    );
  }

  /** CERTIFY by the Certification Body only (X-FR-01, GI-1, GI-4). */
  certify(canonicalId: string, certifier: Actor, certificationClass = 'STANDARD', scope = 'envelope'): Entry {
    const entry = this.require(canonicalId);
    const body = this.governance.certifyingBody();
    if (!this.governance.isMember(certifier.principal, body)) throw new ConstitutionalError('X-FR-01', `${certifier.principal} is not a member of ${body}`);
    this.governance.assertSeparation(entry, certifier.principal, 'certify');
    const registry = this.registry(entry.registryId);
    if (registry.status !== 'CERTIFIED' && entry.kind !== 'Registry' && entry.registryId !== entry.canonicalId) {
      const regEntry = this.get(registry.registryId);
      if (regEntry && regEntry.lifecycle.status !== 'CERTIFIED') throw new ConstitutionalError('X-RG-02', `registry ${registry.registryId} is not certified; it may hold no certified entries`);
    }
    const revalidation = this.validate(entry, registry, 'revalidation');
    if (revalidation.length) throw new ConstitutionalError(revalidation[0].rule, `certification evidence incomplete for ${canonicalId}: ${revalidation.map((v) => v.message).join('; ')}`, revalidation);
    const now = this.clock.now();
    const evidenceHash = hashValue({ id: canonicalId, definition: entry.definition, dependencies: entry.dependencies, ratification: entry.evidence.ratification ?? null, validation: entry.evidence.validation ?? null });
    return this.transition(
      canonicalId,
      'CERTIFIED',
      { ...certifier, authority: body },
      {},
      (e) => {
        e.evidence.certification = { at: now, body, certifier: certifier.principal, certificationClass, scope, evidenceHash };
      },
      entry.registryId === 'UCOS-REG-FND-0000000001' ? 'fr.artifact.admitted' : 'reg.entry.certified',
    );
  }

  /** Full constitutional pipeline, each step by a distinct, authorised principal. */
  admitCertified(candidate: Candidate, roles: { author: Actor; ratifiers: Actor[]; certifier: Actor }, certificationClass = 'STANDARD', correlationId?: string): Entry {
    return this.store.tx(() => {
      const draft = this.submit(candidate, roles.author, { correlationId });
      const registry = this.registry(draft.registryId);
      if (registry.admissionMode !== 'constitutional') return draft;
      this.propose(draft.canonicalId, roles.author);
      const body = draft.ownership.ratifyingBody;
      const ratifiers = roles.ratifiers.filter((r) => this.governance.isMember(r.principal, body));
      this.ratify(draft.canonicalId, ratifiers.length ? ratifiers : roles.ratifiers);
      return this.certify(draft.canonicalId, roles.certifier, certificationClass);
    });
  }

  // ── evolution (Phase 001 §6) ────────────────────────────────────────────

  /** SUPERSEDE: predecessor becomes read-only and resolvable to its successor. */
  supersede(oldId: string, successorId: string, actor: Actor, compatibility: 'COMPATIBLE-EXTENDING' | 'COMPATIBLE-NARROWING' | 'INCOMPATIBLE' = 'COMPATIBLE-EXTENDING'): Entry {
    return this.store.tx(() => {
      const oldE = this.require(oldId);
      const next = this.require(successorId);
      if (oldId === successorId) throw new ConstitutionalError('UCI-014', 'an artifact cannot supersede itself');
      if (!FOUNDATION_STATUSES_ADMISSIBLE.has(next.lifecycle.status) && this.registry(next.registryId).admissionMode === 'constitutional') {
        throw new ConstitutionalError('Phase001-§10', `successor ${successorId} must be certified before superseding ${oldId}`);
      }
      if (oldE.kind !== next.kind) throw new ConstitutionalError('E-FR-04', `successor kind ${next.kind} differs from ${oldE.kind}; a change of kind is a fork`);
      this.amend(successorId, actor, (e) => {
        e.supersedes = oldId;
      }, 'SUPERSEDES');
      this.relate('SUPERSEDES', successorId, oldId, actor, { context: { compatibility } });
      const updated = this.transition(oldId, 'SUPERSEDED', actor, { successor: successorId }, (e) => {
        e.supersededBy = successorId;
      }, oldE.registryId === 'UCOS-REG-FND-0000000001' ? 'fr.artifact.superseded' : 'reg.entry.superseded');
      if (compatibility !== 'COMPATIBLE-EXTENDING') this.cascadeRevalidation(oldId, actor, `supersession ${compatibility}`);
      return updated;
    });
  }

  /** DEPRECATE: requires a certified, resolvable successor. */
  deprecate(canonicalId: string, successorId: string, actor: Actor): Entry {
    const succ = this.require(successorId);
    return this.transition(canonicalId, 'DEPRECATED', actor, { successorStatus: succ.lifecycle.status }, (e) => {
      e.successor = successorId;
    }, 'reg.entry.deprecated');
  }

  /** RETIRE: the hard gate is zero live dependents, computed (V-FR-09). */
  retire(canonicalId: string, actor: Actor): Entry {
    const deps = this.dependents(canonicalId);
    return this.transition(canonicalId, 'RETIRED', actor, { liveDependents: deps.length, dependents: deps }, undefined, 'reg.entry.retired');
  }

  /** FORK: two incompatible specialisations; requires a discriminating classification. */
  fork(parentId: string, candidate: Candidate, discriminatingTaxon: string, roles: { author: Actor; ratifiers: Actor[]; certifier: Actor }): Entry {
    if (!this.exists(discriminatingTaxon)) throw new ConstitutionalError('Phase001-§6.1', `FORK requires a registered discriminating classification; ${discriminatingTaxon} does not resolve`);
    const child = this.admitCertified({ ...candidate, relationships: [...(candidate.relationships ?? []), { type: 'DERIVES-FROM', target: parentId }] }, roles);
    this.relate('CLASSIFIED-AS', child.canonicalId, this.resolve(discriminatingTaxon).entry.canonicalId, roles.author, { context: { discriminates: parentId } });
    this.bus.emit({ type: 'fr.artifact.forked', subject: child.canonicalId, actor: roles.author, payload: { parent: parentId, discriminatingTaxon } });
    return child;
  }

  /** MERGE: two artifacts unified; requires an equivalence proof and mapping; both superseded. */
  merge(aId: string, bId: string, candidate: Candidate, equivalenceProof: string, mapping: Record<string, string>, roles: { author: Actor; ratifiers: Actor[]; certifier: Actor }): Entry {
    if (!equivalenceProof.trim()) throw new ConstitutionalError('Phase001-§6.1', 'MERGE requires an equivalence proof');
    const merged = this.admitCertified({ ...candidate, content: { ...(candidate.content ?? {}), mergedFrom: [aId, bId], equivalenceProof, mapping } }, roles);
    this.supersede(aId, merged.canonicalId, roles.author);
    this.supersede(bId, merged.canonicalId, roles.author);
    return merged;
  }

  /** Revokes a certification and cascades to every dependent (X-FR-04, RG-S-06). */
  revokeCertification(canonicalId: string, actor: Actor, cause: string): string[] {
    return this.store.tx(() => {
      const affected: string[] = [];
      const visit = (id: string, reason: string) => {
        const e = this.get(id);
        if (!e || e.lifecycle.status !== 'CERTIFIED') return;
        this.amend(id, actor, (x) => {
          x.evidence.revocation = { at: this.clock.now(), by: actor.principal, cause: reason };
        }, 'REVOKE', 'fr.certification.revoked');
        this.transition(id, 'PROPOSED', actor, { revocation: true }, undefined, 'reg.entry.certification.revoked');
        affected.push(id);
        for (const d of this.dependents(id)) visit(d.source, `cascade from ${id}: ${reason}`);
      };
      visit(canonicalId, cause);
      return affected;
    });
  }

  /** Re-validates every dependent after a narrowing change (E-FR-02, E-MM-04). */
  cascadeRevalidation(canonicalId: string, actor: Actor, cause: string): { id: string; violations: Violation[] }[] {
    const results: { id: string; violations: Violation[] }[] = [];
    const seen = new Set<string>();
    const walk = (id: string) => {
      for (const d of this.dependents(id)) {
        if (seen.has(d.source)) continue;
        seen.add(d.source);
        const e = this.get(d.source);
        if (!e) continue;
        const violations = this.validate(e, this.registry(e.registryId), 'revalidation');
        results.push({ id: d.source, violations });
        this.bus.emit({ type: 'reg.entry.revalidated', subject: d.source, actor, payload: { cause, violations } });
        walk(d.source);
      }
    };
    walk(canonicalId);
    return results;
  }

  // ── relationships (Phase 002 §6, R-01..R-05) ────────────────────────────

  /**
   * Asserts a typed relationship. The relationship is itself an identified,
   * versioned artifact (R-01). Its type must be registered (R-02); acyclic
   * types refuse cycles (R-03, R-04, UCI-014); the inverse is never stored
   * (R-05); only the Foundation Registry's BOOTSTRAPS edge may be a self-loop.
   */
  relate(
    typeName: string,
    source: string,
    target: string,
    actor: Actor,
    options: { context?: Record<string, unknown>; confidence?: number; evidence?: unknown; skipValidation?: boolean } = {},
  ): RelationshipInstance {
    return this.store.tx(() => {
      const fwd = this.forwardOf(typeName);
      const [src, tgt] = fwd.inverted ? [target, source] : [source, target];
      const type = this.relationshipType(fwd.type);
      const srcId = this.resolveTargetId(src);
      const tgtId = this.resolveTargetId(tgt);
      if (!srcId) throw new ConstitutionalError('V-RL-02', `relationship source ${src} does not resolve`);
      if (!tgtId) throw new ConstitutionalError('V-RL-02', `relationship target ${tgt} does not resolve`);
      if (srcId === tgtId && type.type !== 'BOOTSTRAPS') throw new ConstitutionalError('V-RL-04', `self-relationship ${type.type} on ${srcId} is prohibited`);
      if (type.type === 'BOOTSTRAPS' && srcId !== tgtId) throw new ConstitutionalError('Phase001-§9', 'BOOTSTRAPS is the unique identity self-edge');
      const existing = this.store.edgesFrom(srcId, type.type).find((e) => e.target === tgtId && canonicalJson(JSON.parse(e.body).context ?? {}) === canonicalJson(options.context ?? {}));
      if (existing) return JSON.parse(existing.body) as RelationshipInstance;
      if (type.acyclic && this.reaches(tgtId, srcId, type.type)) {
        this.bus.emit({ type: type.type === 'DERIVES-FROM' ? 'ont.derivation.cycle.detected' : 'fr.dependency.violated', subject: srcId, actor, payload: { type: type.type, source: srcId, target: tgtId } });
        throw new ConstitutionalError('UCI-014', `${type.type} ${srcId} → ${tgtId} would create a cycle`);
      }
      const policy = this.registry(this.require(srcId).registryId).relationshipPolicy;
      if (!options.skipValidation && policy.length && !policy.includes('*') && !policy.includes(type.type) && !(type.specialises && policy.includes(type.specialises))) {
        throw new ConstitutionalError('V-RL-03', `registry ${this.require(srcId).registryId} does not permit ${type.type} relationships`);
      }
      const id = this.mint.mint('REL', 'INS');
      const now = this.clock.now();
      const rel: RelationshipInstance = {
        id,
        type: type.type,
        source: srcId,
        target: tgtId,
        context: options.context ?? {},
        status: 'EFFECTIVE',
        assertedBy: actor.principal,
        assertedAt: now,
        confidence: options.confidence ?? 1,
        evidence: options.evidence,
      };
      const body = JSON.stringify(rel);
      this.store.appendVersion(
        id,
        rel as unknown as Record<string, unknown>,
        {
          registryId: this.relationshipInstanceRegistryId,
          kind: 'RelationshipInstance',
          canonicalName: `${srcId} ${type.type} ${tgtId}`,
          qualifiedName: `REL:${id}`,
          status: 'EFFECTIVE',
          tier: 5,
          owner: actor.authority,
          namespace: this.get(srcId)?.classification.namespace ?? 'UCOS',
          statementKey: null,
          descriptors: '',
          statement: '',
        },
        actor.principal,
        'RELATE',
        now,
      );
      this.store.putEdge({ id, type: type.type, source: srcId, target: tgtId, status: 'EFFECTIVE', body, created_at: now });
      this.bus.emit({ type: 'rel.asserted', subject: srcId, actor, payload: { id, type: type.type, target: tgtId, context: rel.context } });
      return rel;
    });
  }

  /** Revokes a relationship instance; the edge record remains for lineage. */
  unrelate(relationshipId: string, actor: Actor, cause: string): void {
    this.store.tx(() => {
      const row = this.store.prepare('SELECT * FROM edges WHERE id = ?').get(relationshipId) as EdgeRow | undefined;
      if (!row) throw new NotFoundError('relationship', relationshipId);
      const rel = { ...(JSON.parse(row.body) as RelationshipInstance), status: 'REVOKED' };
      const now = this.clock.now();
      this.store.appendVersion(
        relationshipId,
        { ...rel, revokedAt: now, cause } as unknown as Record<string, unknown>,
        { registryId: this.relationshipInstanceRegistryId, kind: 'RelationshipInstance', canonicalName: `${rel.source} ${rel.type} ${rel.target}`, qualifiedName: `REL:${relationshipId}`, status: 'REVOKED', tier: 5, owner: actor.authority, namespace: 'UCOS', statementKey: null, descriptors: '', statement: '' },
        actor.principal,
        'UNRELATE',
        now,
      );
      this.store.putEdge({ ...row, status: 'REVOKED', body: JSON.stringify(rel) });
      this.bus.emit({ type: 'rel.revoked', subject: rel.source, actor, payload: { id: relationshipId, type: rel.type, target: rel.target, cause } });
    });
  }

  /** Whether `from` reaches `to` along effective edges of one type. */
  reaches(from: string, to: string, type: string): boolean {
    if (from === to) return true;
    const seen = new Set<string>([from]);
    const stack = [from];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const e of this.store.edgesFrom(cur, type)) {
        if (e.target === to) return true;
        if (!seen.has(e.target)) {
          seen.add(e.target);
          stack.push(e.target);
        }
      }
    }
    return false;
  }

  /** TRAVERSE typed relationships; inverse readings are computed (R-05). */
  traverse(start: string, options: { types?: string[]; direction?: 'out' | 'in' | 'both'; depth?: number; limit?: number } = {}): { nodes: { id: string; name: string; kind: string; status: string; depth: number }[]; edges: { id: string; type: string; source: string; target: string }[] } {
    const depthLimit = Math.min(options.depth ?? 1, 6);
    const limit = Math.min(options.limit ?? 500, 5000);
    const direction = options.direction ?? 'both';
    const types = options.types?.map((t) => this.forwardOf(t)) ?? null;
    const nodes = new Map<string, { id: string; name: string; kind: string; status: string; depth: number }>();
    const edges = new Map<string, { id: string; type: string; source: string; target: string }>();
    const root = this.resolve(start).entry.canonicalId;
    const addNode = (id: string, depth: number) => {
      if (nodes.has(id)) return;
      const h = this.store.head(id);
      nodes.set(id, { id, name: h?.canonical_name ?? id, kind: h?.kind ?? 'unknown', status: h?.status ?? 'unknown', depth });
    };
    addNode(root, 0);
    let frontier = [root];
    for (let d = 1; d <= depthLimit && frontier.length && nodes.size < limit; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const rows: EdgeRow[] = [];
        if (direction !== 'in') rows.push(...this.store.edgesFrom(id).filter((e) => !types || types.some((t) => t.type === e.type && (!t.inverted || direction === 'both'))));
        if (direction !== 'out') rows.push(...this.store.edgesTo(id).filter((e) => !types || types.some((t) => t.type === e.type)));
        for (const e of rows) {
          edges.set(e.id, { id: e.id, type: e.type, source: e.source, target: e.target });
          const other = e.source === id ? e.target : e.source;
          if (!nodes.has(other)) {
            addNode(other, d);
            nextFrontier.push(other);
          }
          if (nodes.size >= limit) break;
        }
      }
      frontier = nextFrontier;
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()] };
  }

  relationshipsOf(canonicalId: string): { outgoing: RelationshipInstance[]; incoming: (RelationshipInstance & { reading: string })[] } {
    const outgoing = this.store.edgesFrom(canonicalId).map((e) => JSON.parse(e.body) as RelationshipInstance);
    const incoming = this.store.edgesTo(canonicalId).map((e) => {
      const rel = JSON.parse(e.body) as RelationshipInstance;
      return { ...rel, reading: this.relTypes.get(rel.type)?.inverse ?? rel.type };
    });
    return { outgoing, incoming };
  }

  // ── federation (RG-P8, FR-SEC-07) ───────────────────────────────────────

  /** FEDERATE: a read-only projection of one registry with a content hash. */
  federate(registryId: string): { projection: { sourceRegistry: string; contentHash: string; asOf: string; entries: number }; entries: Entry[] } {
    const { entries } = this.query({ registryId, limit: 100_000 });
    const contentHash = hashValue(entries.map((e) => [e.canonicalId, e.version]));
    return { projection: { sourceRegistry: registryId, contentHash, asOf: this.clock.now(), entries: entries.length }, entries };
  }

  /** RECONCILE: verifies a federated copy against the master (C-FR-03). */
  reconcile(projection: { sourceRegistry: string; contentHash: string }): { reconcileStatus: 'RECONCILED' | 'DIVERGED'; masterHash: string } {
    const master = this.federate(projection.sourceRegistry).projection.contentHash;
    return { reconcileStatus: master === projection.contentHash ? 'RECONCILED' : 'DIVERGED', masterHash: master };
  }

  newCorrelationId(): string {
    return randomUUID();
  }
}

export function qualifiedName(entry: Entry): string {
  const scope = entry.content.qualifier ? `${entry.classification.namespace}:${String(entry.content.qualifier)}` : entry.classification.namespace;
  return `${scope}:${entry.kind}:${entry.definition.canonicalName}`;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim()).filter(Boolean))];
}

export function dependencyTargets(deps: Dependency[]): string[] {
  return deps.map((d) => d.target);
}
