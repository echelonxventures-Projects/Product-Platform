import type { Platform } from '../platform.ts';
import type { Entry, RegistryDefinition } from '../registry/types.ts';
import type { Violation } from '../kernel/errors.ts';
import type { CandidateValidator, LifecycleDefinition } from '../registry/fabric.ts';
import { LifecycleEngine } from '../registry/lifecycle.ts';
import { isExpression, evaluateBoolean } from '../rules/expression.ts';
import { hashValue, normaliseStatement } from '../kernel/hash.ts';

export type Layer = 'invariant' | 'constitution' | 'law' | 'policy' | 'implementation';

export interface InvariantResult {
  id: string;
  name: string;
  statement: string;
  status: 'HOLDS' | 'VIOLATED';
  checked: number;
  violations: Violation[];
}

const LAYER_ORDER: Layer[] = ['invariant', 'constitution', 'law', 'policy', 'implementation'];

/** Maps a rule identifier to its constitutional layer (new 6.txt, Validation Engine). */
export function layerOf(rule: string): Layer {
  if (rule.startsWith('UCI-') || rule.startsWith('GI-')) return 'invariant';
  if (/^(UCL-|V-FR|V-ON|V-MM|V-RG|R-0|M-0|RG-P|X-FR|X-RG)/.test(rule)) return 'constitution';
  if (rule.startsWith('LAW:') || /^[A-Z]+L-\d{3}$/.test(rule)) return 'law';
  if (/^(UCL-G|POLICY|US-S|CX-S|TX-S|CM-S|IN-S|GN-S)/.test(rule)) return 'policy';
  return 'implementation';
}

const OPERATIONAL_STATUSES_EXEMPT_FROM_DUP = new Set(['SUPERSEDED', 'REJECTED', 'RETIRED', 'WITHDRAWN', 'REFUTED']);

/**
 * The Constitutional Validation Engine (new 6.txt): invariants → constitution
 * → laws → policies → implementation. Nothing may violate anything above it,
 * so violations are reported with their layer and the higher layer wins.
 */
export class ValidationEngine {
  private readonly p: Platform;
  private readonly kindValidators = new Map<string, CandidateValidator[]>();
  genesis = false;

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.fabric.hooks.validators.push((e, r, phase) => this.universal(e, r, phase));
    this.p.fabric.hooks.validators.push((e) => this.formalLaws(e));
    this.registerFoundationKinds();
  }

  registerKind(kind: string, v: CandidateValidator): void {
    const list = this.p.fabric.hooks.kindValidators.get(kind) ?? [];
    list.push(v);
    this.p.fabric.hooks.kindValidators.set(kind, list);
    this.kindValidators.set(kind, list);
  }

  /** Validates an entry and groups violations by layer (for reports and the UI). */
  layered(entry: Entry): Record<Layer, Violation[]> {
    const registry = this.p.fabric.registry(entry.registryId);
    const all = this.p.fabric.validate(entry, registry, 'revalidation');
    const out = Object.fromEntries(LAYER_ORDER.map((l) => [l, [] as Violation[]])) as Record<Layer, Violation[]>;
    for (const v of all) out[layerOf(v.rule)].push(v);
    return out;
  }

  // ── Layers 1–2: invariants and constitution, applied to every entry ─────

  private universal(e: Entry, registry: RegistryDefinition, phase: 'admission' | 'revalidation'): Violation[] {
    const out: Violation[] = [];
    const f = this.p.fabric;
    if (!e.ownership.canonicalOwner?.trim()) out.push({ rule: 'UCI-002', message: 'no canonical owner' });
    if (!e.ownership.ratifyingBody || !e.ownership.certifyingBody) out.push({ rule: 'UCI-010', message: 'governance record incomplete' });
    if (!e.securityPosture?.level) out.push({ rule: 'UCI-009', message: 'no security posture' });
    if (!e.provenance?.source) out.push({ rule: 'UCI-004', message: 'not traceable to a source authority' });
    if (!e.definition.canonicalName?.trim()) out.push({ rule: 'V-FR-05', message: 'canonical name is empty' });
    if (e.identity.canonicalId !== e.canonicalId) out.push({ rule: 'UCI-001', message: 'identity record disagrees with canonical id' });
    if (!this.genesis && !f.get(registry.registryId) && registry.registryId !== e.canonicalId) out.push({ rule: 'V-RG-01', message: `registry ${registry.registryId} is not registered in the Registry of Registries` });

    if (phase === 'admission') {
      const qn = this.p.qualifiedName(e);
      const clash = f.store.headByQualifiedName(qn);
      if (clash && clash.canonical_id !== e.canonicalId) out.push({ rule: 'UCI-017', message: `"${e.definition.canonicalName}" is already defined as ${clash.canonical_id} in ${e.classification.namespace}` });
      if (registry.admissionMode === 'constitutional' && e.definition.canonicalStatement.length >= 24 && !e.content.derivative) {
        const key = hashValue(normaliseStatement(e.definition.canonicalStatement)).slice(0, 32);
        const dup = f.store
          .prepare('SELECT canonical_id, status FROM heads WHERE statement_key = ? AND namespace = ? AND kind = ? AND canonical_id <> ?')
          .all(key, e.classification.namespace, e.kind, e.canonicalId) as { canonical_id: string; status: string }[];
        const live = dup.filter((d) => !OPERATIONAL_STATUSES_EXEMPT_FROM_DUP.has(d.status));
        if (live.length) out.push({ rule: 'UCI-003', message: `statement duplicates ${live[0].canonical_id}; reference it instead of redefining it` });
      }
    }

    for (const dep of e.dependencies) {
      if (dep.type === 'FUTURE') continue;
      const target = f.tryResolve(dep.target);
      if (!target) out.push({ rule: 'UCI-005', message: `dependency ${dep.target} does not resolve` });
      else if (!this.genesis && registry.admissionMode === 'constitutional' && phase === 'revalidation' && !['CERTIFIED', 'ADMISSIBLE'].includes(target.entry.lifecycle.status) && f.registry(target.entry.registryId).admissionMode === 'constitutional') {
        out.push({ rule: 'V-FR-03', message: `dependency ${dep.target} is ${target.entry.lifecycle.status}, not certified` });
      }
    }
    if (e.dependencies.some((d) => d.type === 'FUTURE') && phase === 'revalidation' && registry.admissionMode === 'constitutional') {
      out.push({ rule: 'Phase001-§5.1', message: 'a FUTURE dependency is declared; certification is withheld' });
    }

    if (registry.admissionMode === 'constitutional') {
      const selfAliases = [...e.identity.aliases, e.canonicalId];
      const { violations, tier } = this.p.ontology.checkChain(e.definition.derivationChain, e.kind, selfAliases);
      out.push(...violations);
      if (e.kind === 'Concept' && tier !== null && e.classification.tier !== null && e.classification.tier !== 1 && e.classification.tier < tier) {
        out.push({ rule: 'Phase001-§4', message: `tier is computed as ${tier}; declared ${e.classification.tier}` });
      }
    }

    if (this.p.ontology.lexicon.appliesTo.includes(e.kind)) {
      const text = e.kind === 'Capability' ? String(e.content.purpose ?? e.definition.canonicalStatement) : e.kind === 'Composition' ? String(e.content.intent ?? '') : e.definition.canonicalStatement;
      const hits = this.p.ontology.prohibitedTerms(text);
      if (hits.length) out.push({ rule: e.kind === 'Capability' ? 'V-CB-04' : e.kind === 'Composition' ? 'V-CM-09' : e.kind === 'Generator' ? 'V-GN-06' : 'V-FR-04', message: `contains prohibited ${hits.map((h) => `${h.cls} noun "${h.term}"`).join(', ')} (UCL-F09)` });
    }
    if ((e.kind === 'Primitive' || e.kind === 'Concept') && splitSentences(e.definition.canonicalStatement).length > 1 && !/restated/i.test(e.definition.canonicalStatement)) {
      out.push({ rule: 'V-ON-02', message: 'canonical statement must be a single sentence' });
    }
    return out;
  }

  // ── Layer 3: formalised laws ─────────────────────────────────────────────

  /**
   * Laws that carry a formal assertion (`content.formal`) are evaluated
   * against every entry of the kind they govern, within their namespace.
   */
  private formalLaws(e: Entry): Violation[] {
    const laws = this.p.lawIndex.get(e.kind);
    if (!laws) return [];
    const out: Violation[] = [];
    for (const law of laws) {
      if (law.namespace !== 'UCOS' && law.namespace !== e.classification.namespace) continue;
      if (law.appliesWhen && !safeBool(law.appliesWhen, e)) continue;
      if (!safeBool(law.assertion, e)) out.push({ rule: `LAW:${law.id}`, message: `violates ${law.id}: ${law.statement}` });
    }
    return out;
  }

  // ── Layer 5: implementation validators for foundation kinds ─────────────

  private registerFoundationKinds(): void {
    this.registerKind('Registry', (e) => {
      const def = e.content.definition as RegistryDefinition | undefined;
      const out: Violation[] = [];
      if (!def) return [{ rule: 'V-RG-02', message: 'registry definition missing' }];
      if (!def.entryModel) out.push({ rule: 'V-RG-02', message: 'entryModel missing' });
      if (!def.owner) out.push({ rule: 'RG-P1', message: 'registry has no owner' });
      if (!def.lifecycleRef) out.push({ rule: 'RG-P2', message: 'registry lifecycle missing' });
      return out;
    });
    this.registerKind('RelationshipType', (e) => {
      const c = e.content as Record<string, unknown>;
      const out: Violation[] = [];
      if (!c.inverse) out.push({ rule: 'V-RG-05', message: 'relationship type has no stated inverse' });
      if (c.specialises && !this.p.fabric.relationshipTypes().some((t) => t.type === c.specialises)) out.push({ rule: 'R-02', message: `specialises unregistered type ${String(c.specialises)}` });
      return out;
    });
    this.registerKind('GovernanceBody', (e) => (Number(e.content.quorum ?? 0) >= 1 ? [] : [{ rule: 'UCL-G05', message: 'a governing body requires a quorum of at least one' }]));
    this.registerKind('Principal', (e) => this.p.governance.membershipViolations((e.content.bodies as string[]) ?? []).map((m) => ({ rule: m.slice(0, 4), message: m })));
    this.registerKind('Lifecycle', (e) => {
      const def = e.content.definition as LifecycleDefinition | undefined;
      if (!def) return [];
      return LifecycleEngine.structuralViolations(def);
    });
    this.registerKind('Rule', (e) => this.expressionFields(e, ['antecedent', 'consequentCondition', 'formal.assertion']));
    this.registerKind('ValidationRule', (e) => this.expressionFields(e, ['formal.assertion']));
    this.registerKind('Law', (e) => this.expressionFields(e, ['formal.assertion', 'formal.appliesWhen']));
    this.registerKind('Invariant', (e) => this.expressionFields(e, ['formal.assertion', 'formal.appliesWhen']));
    this.registerKind('Attribute', (e) => {
      const st = e.content.semanticType as string | undefined;
      if (!st) return [{ rule: 'V-AT-01', message: 'semanticType is required and must reference a construct, not a storage type' }];
      if (/^(string|varchar|int|integer|float|double|text|boolean|bool|number)$/i.test(st)) return [{ rule: 'V-AT-01', message: `semanticType "${st}" is a storage type (MM-P3)` }];
      return this.p.ontology.lookup(st) || this.p.fabric.exists(st) ? [] : [{ rule: 'V-AT-01', message: `semanticType ${st} does not resolve to a registered construct` }];
    });
    this.registerKind('Facet', (e) => (Array.isArray(e.content.domain) && (e.content.domain as unknown[]).length > 0 ? [] : [{ rule: 'V-US-01', message: 'a facet requires a governed, non-empty domain' }]));
    this.registerKind('ContextDimension', (e) => (e.content.owningUniverse ? [] : [{ rule: 'CX-P2', message: 'a dimension requires an owning universe' }]));
    this.registerKind('Policy', (e) => {
      const out: Violation[] = [];
      const c = e.content as Record<string, unknown>;
      if (typeof c.precedence === 'number' || typeof c.rank === 'number') out.push({ rule: 'V-CX-05', message: 'precedence is computed at evaluation time and may not be stored (CX-P6)' });
      if (!c.issuer) out.push({ rule: 'V-PL-01', message: 'a policy requires an issuing authority' });
      if (!c.purpose) out.push({ rule: 'C-16', message: 'a policy requires a purpose' });
      for (const r of (c.rules as Record<string, unknown>[]) ?? []) {
        for (const field of ['antecedent']) {
          const expr = r[field];
          if (typeof expr === 'string') {
            const ok = isExpression(expr);
            if (!ok.ok) out.push({ rule: 'V-RU-01', message: `rule ${String(r.id ?? '')} ${field}: ${ok.error}` });
          }
        }
        if (!['permit', 'prohibit', 'oblige'].includes(String(r.modality))) out.push({ rule: 'V-RU-01', message: `rule ${String(r.id ?? '')} modality must be permit | prohibit | oblige` });
      }
      for (const cond of (c.contextConditions as string[]) ?? []) {
        const ok = isExpression(cond);
        if (!ok.ok) out.push({ rule: 'V-PL-04', message: `context condition: ${ok.error}` });
      }
      for (const field of ['effectiveFrom', 'effectiveTo']) {
        const v = c[field];
        if (v !== undefined && v !== null && isNaN(Date.parse(String(v)))) out.push({ rule: 'V-PL-04', message: `${field} must be a temporal position` });
      }
      return out;
    });
    this.registerKind('Unit', (e) => (e.content.dimension ? [] : [{ rule: 'V-MS-01', message: 'a unit requires a registered dimension' }]));
    this.registerKind('UnitConversion', (e) => {
      const c = e.content as Record<string, unknown>;
      const out: Violation[] = [];
      for (const k of ['from', 'to']) if (!this.p.fabric.exists(String(c[k]))) out.push({ rule: 'V-MS-04', message: `conversion ${k} unit ${String(c[k])} is not registered` });
      if (typeof c.factor !== 'number' || c.factor === 0) out.push({ rule: 'V-MS-04', message: 'conversion factor must be a non-zero number' });
      return out;
    });
    this.registerKind('Knowledge', (e) => {
      const out: Violation[] = [];
      if (!e.content.justification) out.push({ rule: 'V-KW-01', message: 'knowledge requires a justification traceable to evidence' });
      if (e.content.inferred === true && typeof e.content.confidence !== 'number') out.push({ rule: 'V-KW-04', message: 'inferential knowledge must state its confidence' });
      return out;
    });
    this.registerKind('Decision', (e) => (e.content.authority ? [] : [{ rule: 'UCI-006', message: 'a decision requires an accountable authority' }]));
  }

  private expressionFields(e: Entry, paths: string[]): Violation[] {
    const out: Violation[] = [];
    for (const path of paths) {
      const v = path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), e.content);
      if (typeof v === 'string') {
        const ok = isExpression(v);
        if (!ok.ok) out.push({ rule: 'V-RU-01', message: `${path}: ${ok.error}` });
      }
    }
    return out;
  }

  // ── Global constitutional audit (all twenty invariants) ─────────────────

  audit(options: { deep?: boolean } = {}): { at: string; holds: boolean; invariants: InvariantResult[]; integrity: ReturnType<Platform['store']['verifyIntegrity']> } {
    const s = this.p.store;
    const f = this.p.fabric;
    const invariantMeta = new Map(this.p.sources.masterInvariants().map((i) => [i.id, i]));
    const results: InvariantResult[] = [];
    const record = (id: string, checked: number, violations: Violation[]) => {
      const m = invariantMeta.get(id)!;
      results.push({ id, name: m.name, statement: m.statement, status: violations.length ? 'VIOLATED' : 'HOLDS', checked, violations: violations.slice(0, 200) });
    };
    const heads = s.prepare('SELECT canonical_id, registry_id, kind, status, owner, namespace, body FROM heads').all() as { canonical_id: string; registry_id: string; kind: string; status: string; owner: string | null; namespace: string | null; body: string }[];
    const entries = heads.filter((h) => h.kind !== 'RelationshipInstance').map((h) => JSON.parse(h.body) as Entry);
    const total = entries.length;

    // UCI-001 identity
    const v001: Violation[] = [];
    for (const e of entries) {
      if (!f.mint.isCanonical(e.canonicalId)) v001.push({ rule: 'UCI-001', message: `${e.canonicalId} does not match the identification scheme`, subject: e.canonicalId });
      if (e.identity.canonicalId !== e.canonicalId) v001.push({ rule: 'UCI-001', message: 'identity record mismatch', subject: e.canonicalId });
    }
    record('UCI-001', total, v001);

    // UCI-002 canonical ownership
    record('UCI-002', total, entries.filter((e) => !e.ownership?.canonicalOwner).map((e) => ({ rule: 'UCI-002', message: 'no canonical owner', subject: e.canonicalId })));

    // UCI-003 knowledge once
    const dupRows = s
      .prepare(
        `SELECT statement_key, namespace, kind, GROUP_CONCAT(canonical_id) ids, COUNT(*) n FROM heads
         WHERE statement_key IS NOT NULL AND status NOT IN ('SUPERSEDED','REJECTED','RETIRED','WITHDRAWN','REFUTED')
           AND registry_id IN (${f.registryDefinitions().filter((r) => r.admissionMode === 'constitutional').map(() => '?').join(',')})
         GROUP BY statement_key, namespace, kind HAVING n > 1`,
      )
      .all(...f.registryDefinitions().filter((r) => r.admissionMode === 'constitutional').map((r) => r.registryId)) as { ids: string; kind: string; namespace: string }[];
    record('UCI-003', total, dupRows.map((d) => ({ rule: 'UCI-003', message: `duplicate ${d.kind} definitions in ${d.namespace}: ${d.ids}` })));

    // UCI-004 traceability
    record('UCI-004', total, entries.filter((e) => !e.provenance?.source).map((e) => ({ rule: 'UCI-004', message: 'no provenance', subject: e.canonicalId })));

    // UCI-005 referential integrity
    const v005: Violation[] = [];
    const known = new Set(heads.map((h) => h.canonical_id));
    for (const edge of s.allEffectiveEdges()) {
      if (!known.has(edge.source)) v005.push({ rule: 'UCI-005', message: `edge ${edge.id} source ${edge.source} dangling` });
      if (!known.has(edge.target)) v005.push({ rule: 'UCI-005', message: `edge ${edge.id} target ${edge.target} dangling` });
    }
    for (const e of entries) {
      for (const d of e.dependencies) if (d.type !== 'FUTURE' && !f.exists(d.target)) v005.push({ rule: 'UCI-005', message: `dependency ${d.target} unresolved`, subject: e.canonicalId });
      if (e.supersededBy && !known.has(e.supersededBy)) v005.push({ rule: 'UCI-005', message: `successor ${e.supersededBy} unresolved`, subject: e.canonicalId });
    }
    record('UCI-005', total + s.allEffectiveEdges().length, v005);

    // UCI-006 authority (events and decisions)
    const v006: Violation[] = [];
    const missingAuth = (s.prepare("SELECT COUNT(*) n FROM events WHERE actor = '' OR authority = ''").get() as { n: number }).n;
    if (missingAuth) v006.push({ rule: 'UCI-006', message: `${missingAuth} events lack an accountable authority` });
    for (const e of entries.filter((x) => x.kind === 'Decision' || x.kind === 'Escalation')) if (!e.content.authority) v006.push({ rule: 'UCI-006', message: 'decision without authority', subject: e.canonicalId });
    record('UCI-006', this.p.bus.count(), v006);

    // UCI-007 temporality
    const badTime = s.prepare('SELECT event_id, occurred_at FROM events').all() as { event_id: string; occurred_at: string }[];
    record('UCI-007', badTime.length, badTime.filter((r) => isNaN(Date.parse(r.occurred_at))).map((r) => ({ rule: 'UCI-007', message: `event ${r.event_id} has no valid temporal context` })));

    // UCI-008 state legality: replay every version history against its lifecycle
    const v008: Violation[] = [];
    let transitions = 0;
    const byId = new Map<string, string[]>();
    for (const row of s.db.prepare("SELECT canonical_id, json_extract(body, '$.lifecycle.status') st, json_extract(body, '$.lifecycle.lifecycleRef') lc FROM versions WHERE registry_id <> ? ORDER BY canonical_id, version").iterate(f.relationshipInstanceRegistryId) as Iterable<{ canonical_id: string; st: string; lc: string }>) {
      const list = byId.get(row.canonical_id) ?? [row.lc];
      list.push(row.st);
      byId.set(row.canonical_id, list);
    }
    for (const [id, list] of byId) {
      const [lcRef, ...states] = list;
      let def: LifecycleDefinition;
      try {
        def = this.p.lifecycles.get(lcRef);
      } catch {
        v008.push({ rule: 'UCI-008', message: `lifecycle ${lcRef} unregistered`, subject: id });
        continue;
      }
      if (states[0] !== def.initial) v008.push({ rule: 'UCI-008', message: `first state ${states[0]} is not initial ${def.initial}`, subject: id });
      for (let i = 1; i < states.length; i++) {
        if (states[i] === states[i - 1]) continue;
        transitions++;
        const ok = def.transitions.some((t) => (t.from === states[i - 1] || t.from === '*') && t.to === states[i]);
        if (!ok) v008.push({ rule: 'UCI-008', message: `illegal transition ${states[i - 1]} → ${states[i]}`, subject: id });
      }
    }
    record('UCI-008', transitions, v008);

    // UCI-009 security posture
    record('UCI-009', total, entries.filter((e) => !e.securityPosture?.level).map((e) => ({ rule: 'UCI-009', message: 'no posture', subject: e.canonicalId })));

    // UCI-010 governability
    record('UCI-010', total, entries.filter((e) => !e.ownership?.ratifyingBody || !f.hasRegistry(e.registryId)).map((e) => ({ rule: 'UCI-010', message: 'not governable (no ratifying body or unregistered registry)', subject: e.canonicalId })));

    // UCI-011 auditability: hash chains intact and every artifact has audit events
    const integrity = s.verifyIntegrity();
    const v011: Violation[] = integrity.problems.map((p) => ({ rule: 'UCI-011', message: p }));
    const unaudited = s.prepare(`SELECT h.canonical_id FROM heads h WHERE h.kind <> 'RelationshipInstance' AND NOT EXISTS (SELECT 1 FROM events e WHERE e.subject = h.canonical_id) LIMIT 100`).all() as { canonical_id: string }[];
    for (const u of unaudited) v011.push({ rule: 'UCI-011', message: 'artifact has no audit events', subject: u.canonical_id });
    record('UCI-011', integrity.versions + integrity.events, v011);

    // UCI-012 certification evidence
    const certBody = this.p.governance.certifyingBody();
    const v012: Violation[] = [];
    for (const e of entries.filter((x) => x.lifecycle.status === 'CERTIFIED' || x.lifecycle.status === 'ADMISSIBLE')) {
      const c = e.evidence.certification;
      if (!c?.certifier || !c.evidenceHash) v012.push({ rule: 'UCI-012', message: 'certified without verifiable evidence', subject: e.canonicalId });
      else if (c.body !== certBody) v012.push({ rule: 'X-FR-01', message: `certified by ${c.body}, not the Certification Body`, subject: e.canonicalId });
      else if ((e.evidence.ratification?.approvals ?? []).some((a) => a.principal === c.certifier)) v012.push({ rule: 'GI-1', message: 'ratifier also certified', subject: e.canonicalId });
    }
    record('UCI-012', v012.length + entries.filter((x) => x.lifecycle.status === 'CERTIFIED').length, v012);

    // UCI-013 consistency: certified artifacts still satisfy every layer above them
    const v013: Violation[] = [];
    let checked013 = 0;
    const deep = options.deep ?? true;
    for (const e of entries) {
      if (e.lifecycle.status !== 'CERTIFIED' || (!deep && checked013 >= 2000 && e.classification.namespace !== 'UCOS')) continue;
      checked013++;
      const reg = f.registry(e.registryId);
      for (const v of f.validate(e, reg, 'revalidation')) if (layerOf(v.rule) !== 'implementation' || v.rule.startsWith('V-')) v013.push({ ...v, subject: e.canonicalId });
    }
    for (const pol of entries.filter((e) => e.kind === 'Policy')) {
      for (const r of (pol.content.rules as { modality?: string; action?: string }[]) ?? []) {
        if (r.modality === 'permit' && r.action && this.p.prohibitedActions.has(r.action)) v013.push({ rule: 'UCL-G03', message: `policy permits action ${r.action} prohibited by a law above it`, subject: pol.canonicalId });
      }
    }
    record('UCI-013', checked013, v013);

    // UCI-014 acyclicity over every acyclic relationship type
    const v014: Violation[] = [];
    for (const t of f.relationshipTypes().filter((x) => x.acyclic)) {
      const cycle = findCycle(s.edgesOfType(t.type).map((e) => [e.source, e.target] as [string, string]));
      if (cycle) v014.push({ rule: 'UCI-014', message: `${t.type} cycle: ${cycle.join(' → ')}` });
    }
    record('UCI-014', f.relationshipTypes().length, v014);

    // UCI-015 evolutionary integrity (E-FR-06)
    const v015: Violation[] = [];
    for (const e of entries.filter((x) => x.lifecycle.status === 'CERTIFIED')) {
      for (const d of e.dependencies) {
        const t = f.tryResolve(d.target);
        if (t && !t.superseded && ['RETIRED'].includes(t.entry.lifecycle.status)) v015.push({ rule: 'E-FR-06', message: `certified artifact depends on retired ${t.entry.canonicalId}`, subject: e.canonicalId });
      }
    }
    for (const e of entries.filter((x) => x.lifecycle.status === 'SUPERSEDED')) if (!e.supersededBy) v015.push({ rule: 'V-FR-10', message: 'superseded without a resolvable successor', subject: e.canonicalId });
    record('UCI-015', total, v015);

    // UCI-016 completeness: corpus coverage and no orphans
    const v016: Violation[] = [];
    const coverage = this.p.coverageSummary();
    if (coverage && coverage.unregistered > 0) v016.push({ rule: 'UCI-016', message: `${coverage.unregistered} corpus constructs are not registered` });
    const orphanRows = s
      .prepare(
        `SELECT h.canonical_id FROM heads h WHERE h.kind NOT IN ('RelationshipInstance','Registry','FoundationArtifact')
           AND NOT EXISTS (SELECT 1 FROM edges e WHERE (e.source = h.canonical_id OR e.target = h.canonical_id) AND e.status = 'EFFECTIVE')
           AND h.kind NOT IN ('Primitive') LIMIT 200`,
      )
      .all() as { canonical_id: string }[];
    for (const o of orphanRows) v016.push({ rule: 'UCI-016', message: 'orphan artifact: no relationships of any kind', subject: o.canonical_id });
    record('UCI-016', total, v016);

    // UCI-017 single definition
    const v017: Violation[] = [];
    const conceptNames = new Map<string, string>();
    for (const e of entries.filter((x) => (x.kind === 'Concept' || x.kind === 'Primitive') && x.lifecycle.status !== 'SUPERSEDED')) {
      const k = e.definition.canonicalName.toLowerCase();
      if (e.content.restates && conceptNames.get(k) === e.content.restates) continue;
      if (conceptNames.has(k)) v017.push({ rule: 'UCI-017', message: `concept "${e.definition.canonicalName}" defined twice (${conceptNames.get(k)}, ${e.canonicalId})` });
      conceptNames.set(k, e.canonicalId);
    }
    record('UCI-017', conceptNames.size, v017);

    // UCI-018 contextual grounding of every recorded evaluation
    const evalTypes = ['ctx.resolved', 'pol.evaluated', 'us.consideration.quoted', 'tax.assertion.effective', 'int.recommendation.issued', 'int.decision.recorded', 'us.entitlement.checked'];
    const evals = s.prepare(`SELECT event_id, type, context FROM events WHERE type IN (${evalTypes.map(() => '?').join(',')})`).all(...evalTypes) as { event_id: string; type: string; context: string }[];
    record(
      'UCI-018',
      evals.length,
      evals.filter((r) => {
        const c = JSON.parse(r.context) as Record<string, unknown>;
        return !c || (!c.contextId && !c.dimensionBindings && !c.purpose);
      }).map((r) => ({ rule: 'UCI-018', message: `${r.type} ${r.event_id} recorded without its context` })),
    );

    // UCI-019 semantic preservation of generated artifacts
    const v019: Violation[] = [];
    const artifacts = entries.filter((e) => e.kind === 'GeneratedArtifact' && e.lifecycle.status !== 'RETIRED');
    for (const a of artifacts) {
      const verdict = this.p.generation.verify(a.canonicalId, { record: false });
      if (!verdict.intact) v019.push({ rule: 'UCI-019', message: verdict.reason, subject: a.canonicalId });
      else if (!verdict.preservation) v019.push({ rule: 'GN-P3', message: 'preservation proof missing', subject: a.canonicalId });
    }
    record('UCI-019', artifacts.length, v019);

    // UCI-020 purpose accountability of autonomous actions
    const agentIds = this.p.governance.principalList().filter((pr) => pr.principalKind === 'agent').map((pr) => pr.canonicalId);
    const autonomous = agentIds.length
      ? (s.prepare(`SELECT event_id, type, payload, context FROM events WHERE actor IN (${agentIds.map(() => '?').join(',')})`).all(...agentIds) as { event_id: string; type: string; payload: string; context: string }[])
      : [];
    record(
      'UCI-020',
      autonomous.length,
      autonomous
        .filter((r) => {
          const c = JSON.parse(r.context) as Record<string, unknown>;
          const pl = JSON.parse(r.payload) as Record<string, unknown>;
          return !c.purpose && !pl.purpose;
        })
        .map((r) => ({ rule: 'UCI-020', message: `autonomous ${r.type} ${r.event_id} without a registered purpose` })),
    );

    results.sort((a, b) => a.id.localeCompare(b.id));
    return { at: this.p.clock.now(), holds: results.every((r) => r.status === 'HOLDS'), invariants: results, integrity };
  }
}

function safeBool(expr: string, e: Entry): boolean {
  try {
    return evaluateBoolean(expr, { scope: { ...e.content, entry: e, name: e.definition.canonicalName, statement: e.definition.canonicalStatement, kind: e.kind, status: e.lifecycle.status } });
  } catch {
    return false;
  }
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\([^)]*\)/g, '')
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .filter((s) => s.trim().length > 0);
}

/** Returns one cycle in a directed graph, or null. Iterative DFS. */
export function findCycle(edges: [string, string][]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const [a, b] of edges) adj.set(a, [...(adj.get(a) ?? []), b]);
  const color = new Map<string, number>();
  const parent = new Map<string, string>();
  for (const start of adj.keys()) {
    if (color.get(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    color.set(start, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [node, idx] = top;
      const next = adj.get(node) ?? [];
      if (idx >= next.length) {
        color.set(node, 2);
        stack.pop();
        continue;
      }
      top[1]++;
      const n = next[idx];
      const c = color.get(n) ?? 0;
      if (c === 1) {
        const cycle = [n];
        let cur = node;
        while (cur !== n && cur !== undefined) {
          cycle.push(cur);
          cur = parent.get(cur)!;
        }
        cycle.push(n);
        return cycle.reverse();
      }
      if (c === 0) {
        color.set(n, 1);
        parent.set(n, node);
        stack.push([n, 0]);
      }
    }
  }
  return null;
}
