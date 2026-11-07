import { readFileSync, existsSync } from 'node:fs';
import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Candidate, Entry, RegistryDefinition, RelationshipType } from '../registry/types.ts';
import type { LifecycleDefinition } from '../registry/fabric.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { normaliseStatement } from '../kernel/hash.ts';
import { platformPath } from '../kernel/config.ts';
import { ConstitutionSources, ruleClass } from './sources.ts';

type Roles = { author: Actor; ratifiers: Actor[]; certifier: Actor };

interface RegistryMeta {
  kinds: string[];
  namespaces: string[];
  entryModel: string;
  construct: string | null;
  identity: { layer: string; type: string };
  identityByKind?: Record<string, { layer: string; type: string }>;
  tier: number;
  lifecycleRef: string;
  admissionMode: 'constitutional' | 'operational';
  relationshipPolicy: string[];
  name?: string;
  owner?: string;
  envelopeText?: string;
  basis?: string;
}

const GENESIS: Actor = { principal: 'UCOS-FR-FND-0000000000', authority: 'Constitutional Assembly' };

/**
 * Genesis and constitutional seeding. The constitution is read from its
 * sources — the UCOS registry seeds and documents — and admitted through
 * the same governance pipeline as every later artifact. The only special
 * step is the fixed point (UCL-F10): the Registry of Registries and the
 * Master Foundation Registry enter before the bodies that certify them are
 * themselves certified, exactly once, and the bootstrap is recorded.
 */
export class Bootstrap {
  private readonly p: Platform;
  private readonly log: (m: string) => void;
  private roles!: Roles;
  private counts: Record<string, number> = {};

  constructor(p: Platform, log: (m: string) => void = () => {}) {
    this.p = p;
    this.log = log;
  }

  private tally(kind: string): void {
    this.counts[kind] = (this.counts[kind] ?? 0) + 1;
  }

  run(): Record<string, number> {
    if (this.p.isBootstrapped()) throw new ConstitutionalError('UCL-F10', 'the platform is already bootstrapped; the fixed point is written once, ever');
    this.p.validation.genesis = true;
    this.p.store.tx(() => {
      this.defineInMemory();
      this.genesisGovernance();
      this.registryFixedPoint();
      this.certifyGovernance();
      this.foundation();
    });
    this.p.validation.genesis = false;
    this.p.store.tx(() => this.seedConstitution());
    this.p.store.tx(() => this.seedConstructs());
    this.p.store.tx(() => this.seedCommerce());
    this.p.store.tx(() => this.seedCapabilitiesAndCompositions());
    this.p.store.tx(() => this.seedIntelligence());
    this.p.store.tx(() => this.linkDerivations());
    this.p.store.setMeta('bootstrapped', this.p.clock.now());
    this.p.hydrate();
    return this.counts;
  }

  private admit(c: Candidate, cls = 'STANDARD'): Entry {
    const e = this.p.fabric.admitCertified(c, this.roles, cls);
    this.tally(c.kind);
    return e;
  }

  /** Admits, or — when an identical statement already exists — records the identifier as an alias of it (UCI-003). */
  private admitOrAlias(c: Candidate, cls = 'STANDARD'): Entry | null {
    try {
      return this.admit(c, cls);
    } catch (err) {
      const ce = err as ConstitutionalError;
      if (ce.rule !== 'UCI-003') throw err;
      const key = normaliseStatement(c.statement);
      const dup = this.p.fabric.query({ kind: c.kind, namespace: c.namespace ?? 'UCOS', limit: 100_000 }).entries.find((e) => normaliseStatement(e.definition.canonicalStatement) === key);
      if (!dup) throw err;
      for (const alias of [c.name, ...(c.aliases ?? [])]) this.addAlias(dup, alias);
      this.tally(`${c.kind}:alias`);
      return dup;
    }
  }

  private addAlias(e: Entry, alias: string): void {
    if (e.identity.aliases.includes(alias) || this.p.store.resolveAlias(alias)) return;
    this.p.fabric.amend(e.canonicalId, this.roles.author, (x) => {
      x.identity.aliases.push(alias);
    }, 'ALIAS');
    this.p.store.bindAlias(alias, e.canonicalId, 'alias');
  }

  // ── 1. in-memory definitions (registries, lifecycles, relationship types) ─

  private registryDefinitions(): RegistryDefinition[] {
    const seed = this.p.sources.seed<{ registries: { id: string; name: string; envelope: string; owner: string }[] }>('registry-registry.json');
    const meta = this.p.sources.metadata<{ registries: Record<string, RegistryMeta>; supplements: Record<string, RegistryMeta> }>('registries.json');
    const out: RegistryDefinition[] = [];
    const build = (id: string, name: string, owner: string, m: RegistryMeta): RegistryDefinition => ({
      registryId: id,
      name,
      owner,
      envelope: { kinds: m.kinds, namespaces: m.namespaces },
      entryModel: m.entryModel,
      lifecycleRef: m.lifecycleRef,
      admissionMode: m.admissionMode,
      relationshipPolicy: m.relationshipPolicy,
      identity: m.identity,
      identityByKind: m.identityByKind,
      construct: m.construct,
      tier: m.tier,
      securityDefault: 'PUBLIC',
      status: 'CERTIFIED',
    });
    for (const r of seed.registries) {
      const m = meta.registries[r.id];
      if (!m) throw new ConstitutionalError('V-RG-01', `seed registry ${r.id} (${r.name}) has no machine envelope in metadata/registries.json`);
      out.push(build(r.id, r.name, r.owner.split(' / ')[0], m));
    }
    for (const [id, m] of Object.entries(meta.supplements)) out.push(build(id, m.name!, m.owner!, m));
    return out;
  }

  private defineInMemory(): void {
    for (const def of this.registryDefinitions()) this.p.fabric.defineRegistryInMemory(def);
    const lcs = this.p.sources.metadata<{ lifecycles: LifecycleDefinition[] }>('lifecycles.json').lifecycles;
    for (const lc of lcs) this.p.lifecycles.define(lc);
    for (const t of this.relationshipTypes()) this.p.fabric.defineRelationshipTypeInMemory(t);
    const ops = this.p.sources.metadata<{ operationalNamespaces: { code: string }[] }>('registries.json').operationalNamespaces;
    for (const ns of ops) this.p.fabric.registerNamespace(ns.code, 'operational');
    const overlaps = this.p.fabric.envelopeOverlaps();
    if (overlaps.length) throw new ConstitutionalError('V-RG-03', overlaps.map((o) => o.message).join('; '));
  }

  private relationshipTypes(): RelationshipType[] {
    const base = this.p.sources.seed<{ baseRelationshipVocabulary: { type: string; inverse: string; transitive: boolean; notes: string }[] }>('registry-registry.json').baseRelationshipVocabulary;
    const ext = this.p.sources.metadata<{ extensions: { type: string; inverse: string; transitive: boolean; acyclic?: boolean; specialises: string; notes: string }[] }>('relationship-extensions.json').extensions;
    return [
      ...base.map((b) => ({ type: b.type, inverse: b.inverse, transitive: b.transitive, acyclic: b.transitive, specialises: null, notes: b.notes })),
      ...ext.map((e) => ({ type: e.type, inverse: e.inverse, transitive: e.transitive, acyclic: e.acyclic ?? e.transitive, specialises: e.specialises, notes: e.notes })),
    ];
  }

  // ── 2. governance genesis ───────────────────────────────────────────────

  private genesisGovernance(): void {
    const graph = this.p.sources.seed<{ governanceGraph: { bodies: { name: string; ratifies: string[]; mayCertify: boolean; role?: string }[] } }>('foundation-registry.json').governanceGraph;
    const meta = this.p.governance.meta;
    for (const b of graph.bodies) {
      const params = meta.bodies[b.name];
      if (!params) throw new ConstitutionalError('UCI-010', `governance body ${b.name} has no operating parameters`);
      const e = this.p.fabric.submit(
        {
          kind: 'GovernanceBody',
          name: b.name,
          statement: `The ${b.name}: ${params.role}.`,
          aliases: [params.alias],
          content: { ratifies: b.ratifies, mayCertify: b.mayCertify, role: b.role ?? params.role, quorum: params.quorum, authorityRank: params.authorityRank, namespace: null, parentBody: null },
          provenance: { source: 'registries/foundation-registry.json', locator: 'governanceGraph.bodies' },
        },
        GENESIS,
      );
      this.p.governance.cacheBody(e);
    }
    for (const ns of this.p.sources.metadata<{ operationalNamespaces: { code: string }[] }>('registries.json').operationalNamespaces) {
      const t = meta.operationalDomainAuthority;
      const e = this.p.fabric.submit(
        {
          kind: 'GovernanceBody',
          name: t.nameTemplate.replace('{code}', ns.code),
          statement: `The authority that governs operational content of ${ns.code} within its envelope.`,
          aliases: [`GOV:${ns.code}`],
          content: { namespace: ns.code, quorum: t.quorum, authorityRank: t.authorityRank, parentBody: t.parentBody, ratifies: [`${ns.code} operational content`], mayCertify: false },
          provenance: { source: 'metadata/governance.json', locator: 'operationalDomainAuthority' },
        },
        GENESIS,
      );
      this.p.governance.cacheBody(e);
    }
    for (const pr of meta.principals) {
      const bodies = pr.alias === 'operator' ? [meta.operationalDomainAuthority.nameTemplate.replace('{code}', this.p.operationalNamespace())] : pr.bodies;
      this.p.registerPrincipal({ alias: pr.alias, name: pr.name, principalKind: pr.principalKind, bodies }, null);
      this.tally('Principal');
    }
    this.roles = this.p.governance.pipelineRoles();
  }

  // ── 3. registry fixed point ─────────────────────────────────────────────

  private registryFixedPoint(): void {
    const seed = this.p.sources.seed<{ registries: { id: string; envelope: string }[]; bootstrapNote: string }>('registry-registry.json');
    const meta = this.p.sources.metadata<{ supplements: Record<string, RegistryMeta> }>('registries.json').supplements;
    const defs = this.p.fabric.registryDefinitions();
    const ror = defs.find((d) => d.registryId === 'UCOS-REG-META-0000000001')!;
    const envelopeText = (id: string) => seed.registries.find((r) => r.id === id)?.envelope ?? meta[id]?.envelopeText ?? '';
    const candidate = (d: RegistryDefinition): Candidate => ({
      kind: 'Registry',
      canonicalId: d.registryId,
      name: d.name,
      statement: `${d.name}: ${envelopeText(d.registryId)}.`,
      content: { definition: d, basis: meta[d.registryId]?.basis ?? 'registries/registry-registry.json' },
      provenance: { source: meta[d.registryId] ? 'metadata/registries.json#supplements' : 'registries/registry-registry.json', locator: d.registryId },
    });
    const rorEntry = this.admit(candidate(ror), 'FOUNDATIONAL CONSTITUTION');
    this.p.bus.emit({ type: 'reg.registry.published', subject: rorEntry.canonicalId, actor: this.roles.author, payload: { note: seed.bootstrapNote } });
    for (const d of defs) {
      if (d.registryId === ror.registryId) continue;
      const e = this.admit(candidate(d), 'REGISTRY');
      this.p.fabric.relate('REGISTERS', rorEntry.canonicalId, e.canonicalId, this.roles.author);
      this.p.bus.emit({ type: 'reg.registry.published', subject: e.canonicalId, actor: this.roles.author, payload: { envelope: d.envelope } });
    }
  }

  private certifyGovernance(): void {
    for (const e of this.p.fabric.query({ kind: 'GovernanceBody', status: 'DRAFT', limit: 1000 }).entries) {
      this.p.fabric.propose(e.canonicalId, this.roles.author);
      const ratifiers = this.roles.ratifiers.filter((r) => this.p.governance.isMember(r.principal, e.ownership.ratifyingBody));
      this.p.fabric.ratify(e.canonicalId, ratifiers);
      this.p.fabric.certify(e.canonicalId, this.roles.certifier, 'FOUNDATIONAL CONSTITUTION');
      this.tally('GovernanceBody');
    }
  }

  private foundation(): void {
    const fr = this.p.sources.seed<{ entries: { canonicalId: string; alias: string; canonicalName: string; canonicalStatement: string; derivationChain: string[]; descriptors?: string[]; evidence?: Record<string, unknown> }[]; bootstrapNote: string }>('foundation-registry.json');
    const mfr = fr.entries[0];
    const e = this.admit(
      {
        kind: 'FoundationArtifact',
        canonicalId: mfr.canonicalId,
        name: mfr.canonicalName,
        statement: mfr.canonicalStatement,
        aliases: [mfr.alias],
        derivationChain: mfr.derivationChain,
        tier: 0,
        content: { bootstrapNote: fr.bootstrapNote, evidence: mfr.evidence ?? {} },
        provenance: { source: 'registries/foundation-registry.json', locator: mfr.canonicalId },
      },
      'FOUNDATIONAL CONSTITUTION',
    );
    this.p.fabric.relate('BOOTSTRAPS', e.canonicalId, e.canonicalId, this.roles.author, { context: { note: 'fixed point; identity relation, not a dependency' } });
    this.p.fabric.relate('REFERENCES', e.canonicalId, 'UCOS-REG-FND-0000000001', this.roles.author, { context: { role: 'registry' } });
    this.p.bus.emit({ type: 'fr.registry.bootstrapped', subject: e.canonicalId, actor: this.roles.author, payload: { note: fr.bootstrapNote } });
    const constitution = this.admit(
      {
        kind: 'Constitution',
        name: 'Constitution of UCOS Ω∞',
        statement: this.p.sources.constitutionText(),
        tier: 0,
        derivationChain: ['FR-05 Constraint', 'FR-07 Purpose'],
        content: { source: '00-Master-Index.md §2', hierarchy: ['Invariant', 'Constitution', 'Law', 'Policy', 'Rule', 'Constraint', 'Workflow', 'Composition', 'Capability', 'Entity'] },
        provenance: { source: 'UCOS/00-Master-Index.md', locator: '§2' },
        dependencies: [{ target: mfr.canonicalId, type: 'CONSTITUTIVE' }],
      },
      'FOUNDATIONAL CONSTITUTION',
    );
    void constitution;
    this.p.universes.register({ code: 'UCOS', name: 'UCOS Ω∞ (root)', statement: 'The root universe of the Universal Civilization Operating System, whose constitution every other universe consumes.', source: 'UCOS/README.md' }, this.roles);
  }

  // ── 4. constitution: lifecycles, relationships, primitives, concepts, laws ─

  private seedConstitution(): void {
    for (const lc of this.p.lifecycles.all()) {
      this.admit({ kind: 'Lifecycle', name: lc.name, statement: `${lc.name}: ${lc.states.join(' → ')}.`, aliases: [lc.id], content: { definition: lc }, provenance: { source: 'metadata/lifecycles.json', locator: lc.source ?? lc.id } });
    }
    for (const t of this.p.fabric.relationshipTypes()) {
      this.admit({ kind: 'RelationshipType', name: t.type, statement: `${t.type} (inverse ${t.inverse})${t.notes ? `: ${t.notes}` : ''}.`, aliases: [`REL:${t.type}`], content: { ...t }, provenance: { source: t.specialises ? 'metadata/relationship-extensions.json' : 'registries/registry-registry.json#baseRelationshipVocabulary' } });
    }
    const prims = this.p.sources.seed<{ primitives: { id: string; alias: string; name: string; statement: string }[]; rejectedCandidates: unknown[]; admissibilityCriterion: string }>('primitive-registry.json');
    const frEntries = this.p.sources.seed<{ entries: { canonicalId: string; descriptors?: string[]; evidence?: Record<string, unknown> }[] }>('foundation-registry.json').entries;
    for (const pr of prims.primitives) {
      const fe = frEntries.find((x) => x.canonicalId === pr.id);
      this.admit({ kind: 'Primitive', canonicalId: pr.id, name: pr.name, statement: pr.statement, aliases: [pr.alias], tier: 0, derivationChain: [], descriptors: fe?.descriptors ?? [], content: { evidence: fe?.evidence ?? {}, admissibilityCriterion: prims.admissibilityCriterion }, provenance: { source: 'registries/primitive-registry.json', locator: pr.alias } }, 'FOUNDATIONAL CONSTITUTION');
    }
    const concepts = this.p.sources.seed<{ concepts: { id: string; alias: string; name: string; statement: string; derivesFrom: string[] }[]; unifications: unknown; weightBearers: unknown }>('concept-registry.json');
    for (const c of concepts.concepts) {
      // A Tier-1 entry that derives only from the same-named primitive is that primitive restated for reference (Phase 002 §5.1 "= FR-05"), not a second definition.
      const restated = c.derivesFrom.length === 1 ? prims.primitives.find((pr) => pr.alias === c.derivesFrom[0] && pr.name === c.name) : undefined;
      this.admit({ kind: 'Concept', canonicalId: c.id, name: c.name, statement: c.statement, aliases: [c.alias], tier: 1, derivationChain: c.derivesFrom, content: restated ? { restates: restated.id } : {}, provenance: { source: 'registries/concept-registry.json', locator: c.alias } }, 'FOUNDATIONAL CONSTITUTION');
    }
    const enforcement = this.p.sources.metadata<{ invariants: Record<string, { enforcedBy: string[] }>; laws: Record<string, { enforcedBy?: string[]; formal?: Record<string, string> }> }>('enforcement.json');
    for (const inv of this.p.sources.masterInvariants()) {
      this.admit({ kind: 'Invariant', name: inv.id, statement: inv.statement, aliases: [inv.id], tier: 0, derivationChain: ['FR-05 Constraint'], labels: { [this.p.cfg.platform.defaultLocale]: inv.name }, content: { title: inv.name, enforcedBy: enforcement.invariants[inv.id]?.enforcedBy ?? [] }, provenance: { source: 'UCOS/00-Master-Index.md', locator: '§3' } }, 'FOUNDATIONAL CONSTITUTION');
    }
    for (const law of this.p.sources.masterLaws()) {
      const enf = enforcement.laws[law.id];
      this.admit({ kind: 'Law', name: law.id, statement: law.statement, aliases: [law.id], derivationChain: ['C-15', 'C-16'], content: { group: law.group, enforcedBy: enf?.enforcedBy ?? [], formal: enf?.formal ?? null }, provenance: { source: 'UCOS/00-Master-Index.md', locator: `§4 ${law.group}` } });
    }
    const n6Path = this.p.cfg.corpus.find((c) => c.id === 'N6');
    if (n6Path && existsSync(platformPath(n6Path.path))) {
      for (const b of ConstitutionSources.idBlocks(readFileSync(platformPath(n6Path.path), 'utf8'))) {
        const existing = this.p.fabric.tryResolve(b.id);
        if (existing) {
          this.p.fabric.amend(existing.entry.canonicalId, this.roles.author, (e) => {
            const cites = ((e.content.citations as unknown[]) ?? []) as unknown[];
            cites.push({ source: 'N6', name: b.name, statement: b.statement });
            e.content.citations = cites;
          }, 'CITE');
          continue;
        }
        const kind = /invariant/i.test(`${b.name ?? ''} ${b.headingContext ?? ''}`) ? 'Invariant' : 'Law';
        const enf = enforcement.laws[b.id];
        this.admitOrAlias({ kind, name: b.id, statement: b.statement, aliases: [b.id], tier: kind === 'Invariant' ? 0 : 1, derivationChain: kind === 'Invariant' ? ['FR-05 Constraint'] : ['C-15', 'C-16'], labels: { [this.p.cfg.platform.defaultLocale]: b.name ?? b.id }, content: { title: b.name, group: b.headingContext, enforcedBy: enf?.enforcedBy ?? [], formal: enf?.formal ?? null }, provenance: { source: n6Path.path, locator: b.id } });
      }
    }
    const tpl = this.p.sources.artifactTemplate();
    this.admit({ kind: 'ArtifactTemplate', name: 'Canonical Artifact Template', statement: 'Every artifact in every phase is described against one twenty-field template, registered once and referenced by all phases.', content: { fields: tpl, densityRule: 'Where a field adds nothing beyond a referenced artifact, state → ref rather than repeat (UCI-003).' }, provenance: { source: 'UCOS/00-Master-Index.md', locator: '§7' } });
    this.admit({ kind: 'ArtifactTemplate', name: 'Identification Scheme', statement: 'Canonical identities take the form UCOS-<LAYER>-<TYPE>-<SEQUENCE>; short identifiers are aliases resolving to exactly one canonical identity.', content: { layers: this.p.sources.identificationLayers(), forbiddenConfusions: this.p.sources.forbiddenConfusions() }, provenance: { source: 'UCOS/00-Master-Index.md', locator: '§8–§9' } });
    for (const r of this.p.sources.phaseRules()) {
      const cls = ruleClass(r.id);
      this.admitOrAlias({ kind: cls.kind, name: r.id, statement: r.text, aliases: [r.id], content: { ruleClass: cls.ruleClass, section: r.locator }, provenance: { source: `UCOS/${r.source}`, locator: r.locator } });
    }
    const inf = this.p.sources.metadata<{ rules: { name: string; statement: string }[] }>('inference-rules.json').rules;
    for (const r of inf) this.admit({ kind: 'Rule', name: `inference:${r.name}`, statement: r.statement, content: { ruleClass: 'inference', inference: r }, provenance: { source: 'metadata/inference-rules.json', locator: r.name } });
    this.log(`constitution seeded: ${JSON.stringify(this.counts)}`);
  }

  // ── 5. construct registries: units, methods, calendars, frames, dimensions ─

  private seedConstructs(): void {
    const units = this.p.sources.metadata<{ units: { symbol: string; name: string; dimension: string; system: string; base?: boolean; minorUnits?: number }[]; conversions: { from: string; to: string; factor: number; offset?: number }[]; methods: { name: string; statement: string; admitsUncertainty: boolean }[] }>('units.json');
    for (const u of units.units) {
      this.admit({ kind: 'Unit', name: u.name, statement: '', aliases: [`UNIT:${u.symbol}`], content: { qualifier: u.symbol, symbol: u.symbol, dimension: u.dimension, system: u.system, base: u.base === true, minorUnits: u.minorUnits ?? null }, labels: { [this.p.cfg.platform.defaultLocale]: u.name }, descriptors: [u.symbol, u.name, u.dimension], provenance: { source: 'metadata/units.json', locator: u.symbol } });
    }
    this.p.measure.hydrate();
    for (const c of units.conversions) {
      const from = this.p.fabric.resolve(`UNIT:${c.from}`).entry.canonicalId;
      const to = this.p.fabric.resolve(`UNIT:${c.to}`).entry.canonicalId;
      this.admit({ kind: 'UnitConversion', name: `${c.from} → ${c.to}`, statement: '', content: { from, to, factor: c.factor, offset: c.offset ?? 0 }, dependencies: [{ target: from, type: 'SEMANTIC' }, { target: to, type: 'SEMANTIC' }], provenance: { source: 'metadata/units.json', locator: `${c.from}->${c.to}` } });
    }
    this.p.measure.hydrate();
    for (const m of units.methods) this.admit({ kind: 'Method', name: m.name, statement: m.statement, aliases: [`METHOD:${m.name}`], content: { admitsUncertainty: m.admitsUncertainty }, provenance: { source: 'metadata/units.json', locator: m.name } });
    const ts = this.p.sources.metadata<{ calendars: { name: string; statement: string }[]; recurrenceSchemes: { name: string; statement: string; fields: string[] }[]; frames: { name: string; statement: string; meanRadiusMetres: number; vocabulary: string[] }[] }>('temporal-spatial.json');
    for (const c of ts.calendars) this.admit({ kind: 'Calendar', name: c.name, statement: c.statement, content: { ...c }, provenance: { source: 'metadata/temporal-spatial.json', locator: c.name } });
    for (const r of ts.recurrenceSchemes) this.admit({ kind: 'RecurrenceScheme', name: r.name, statement: r.statement, content: { ...r }, provenance: { source: 'metadata/temporal-spatial.json', locator: r.name } });
    for (const f of ts.frames) this.admit({ kind: 'SpatialFrame', name: f.name, statement: f.statement, content: { ...f }, provenance: { source: 'metadata/temporal-spatial.json', locator: f.name } });
    const ctx = this.p.sources.seed<{ dimensions: { id: string; name: string; owningUniverse: string; statement: string; holds: string[]; conditions: string[]; note?: string; invariants?: string[] }[] }>('context-registry.json');
    for (const d of ctx.dimensions) {
      this.admit({ kind: 'ContextDimension', canonicalId: d.id, name: d.name, statement: d.statement, aliases: [`DIM:${d.name}`], content: { owningUniverse: d.owningUniverse, holds: d.holds, conditions: d.conditions, note: d.note ?? null, invariants: d.invariants ?? [] }, provenance: { source: 'registries/context-registry.json', locator: d.id } });
    }
    this.p.context.hydrate();
    this.log(`constructs seeded: ${JSON.stringify(this.counts)}`);
  }

  // ── 6. commerce: facets, admissibility, taxonomies, roles ───────────────

  private seedCommerce(): void {
    const facets = this.p.sources.seed<{ facets: { id: string; name: string; domain: string[]; governs: string }[]; construct: { statement: string } }>('offering-facet-registry.json');
    for (const f of facets.facets) this.admit({ kind: 'Facet', name: f.name, statement: `The ${f.name} facet governs ${f.governs}.`, aliases: [`FACET:${f.id}`], content: { alias: f.id, domain: f.domain, governs: f.governs }, labels: { [this.p.cfg.platform.defaultLocale]: f.name }, provenance: { source: 'registries/offering-facet-registry.json', locator: f.id } });
    this.p.commerce.hydrate();
    const commerceMeta = this.p.sources.metadata<{ facetAdmissibility: { name: string; statement: string; expression: string; source: string }[]; roleFormalisation: Record<string, { expression: string; scopeKinds: string[]; basis: string }> }>('commerce.json');
    for (const r of commerceMeta.facetAdmissibility) this.admit({ kind: 'Rule', name: `facet-admissibility:${r.name}`, statement: r.statement, content: { ruleClass: 'facet-admissibility', expression: r.expression, formal: { assertion: r.expression } }, provenance: { source: r.source } });
    const tax = this.p.sources.seed<{ schemes: { id: string; name: string; scope: string; owner: string; multiParentAllowed: boolean }[]; commerceRoles: { taxon: string; admissionRule: string; source: string }[]; illustrativeTaxa: Record<string, string[] | string> }>('taxonomy-registry.json');
    const schemeIds = new Map<string, string>();
    for (const s of tax.schemes) {
      const scopeKinds = s.scope === 'exchangeable entities' ? ['ExchangeableEntity', 'Offer'] : s.scope === 'organizations' ? ['Entity'] : s.scope === 'capabilities' ? ['Capability'] : [];
      const e = this.admit({ kind: 'TaxonomyScheme', canonicalId: s.id, name: s.name, statement: `The ${s.name}, owned by the ${s.owner}, classifies ${s.scope}.`, content: { purpose: `classify ${s.scope}`, scope: s.scope, scopeKinds, owner: s.owner, multiParentAllowed: s.multiParentAllowed, conflictPolicy: 'declared precedence of the owning universe', relationshipPolicy: ['NARROWER-THAN', 'RELATED-TO', 'INSTANCE-OF'] }, labels: { [this.p.cfg.platform.defaultLocale]: s.name }, provenance: { source: 'registries/taxonomy-registry.json', locator: s.id } });
      schemeIds.set(s.name, e.canonicalId);
    }
    const commerceScheme = schemeIds.get('Commerce Role Scheme')!;
    for (const r of tax.commerceRoles) {
      const formal = commerceMeta.roleFormalisation[r.taxon];
      const rule = formal?.expression ?? r.admissionRule;
      this.admit({ kind: 'Taxon', name: r.taxon, statement: '', content: { qualifier: commerceScheme, scheme: commerceScheme, admissionRule: rule, admissionRuleText: r.admissionRule, formalisationBasis: formal?.basis ?? 'the seed rule is itself a registered rule expression', discriminators: [], attributes: [], policies: [], scopeKinds: formal?.scopeKinds ?? ['ExchangeableEntity'] }, labels: { [this.p.cfg.platform.defaultLocale]: r.taxon }, provenance: { source: 'registries/taxonomy-registry.json', locator: `commerceRoles.${r.taxon} (${r.source})` }, relationships: [{ type: 'MEMBER-OF', target: commerceScheme }] });
    }
    const schemeFor: Record<string, string> = { product: 'Product Scheme', service: 'Service Scheme', industry: 'Industry Scheme', organization: 'Organization Scheme', asset: 'Asset Scheme', capability: 'Capability Scheme' };
    for (const [key, list] of Object.entries(tax.illustrativeTaxa)) {
      if (!Array.isArray(list)) continue;
      const schemeId = schemeIds.get(schemeFor[key]);
      if (!schemeId) continue;
      for (const t of list) this.admit({ kind: 'Taxon', name: t, statement: '', content: { qualifier: schemeId, scheme: schemeId, admissionRule: null, discriminators: [], attributes: [], policies: [], illustrative: true }, labels: { [this.p.cfg.platform.defaultLocale]: t }, provenance: { source: 'registries/taxonomy-registry.json', locator: `illustrativeTaxa.${key}` }, relationships: [{ type: 'MEMBER-OF', target: schemeId }] });
    }
    const policies = this.p.sources.metadata<{ policies: { name: string; statement: string; issuer: string; purpose: string; scope: unknown; rules: unknown[]; governance?: unknown[]; autonomy?: unknown[] }[] }>('policies.json').policies;
    for (const pol of policies) {
      this.admit({ kind: 'Policy', name: pol.name, statement: pol.statement, content: { issuer: pol.issuer, purpose: pol.purpose, scope: pol.scope, rules: pol.rules, contextConditions: [], governance: pol.governance ?? [], autonomy: pol.autonomy ?? [], effectiveFrom: this.p.clock.now(), effectiveTo: null }, provenance: { source: 'metadata/policies.json', locator: pol.name } });
    }
    this.p.policy.invalidate();
    this.log(`commerce seeded: ${JSON.stringify(this.counts)}`);
  }

  // ── 7. capabilities, contracts, generators, compositions ────────────────

  private seedCapabilitiesAndCompositions(): void {
    const seed = this.p.sources.seed<{ capabilities: { id: string; name: string; cluster: string }[] }>('capability-registry.json');
    const contracts = this.p.sources.metadata<{ defaults: { serviceLevels: unknown[] }; capabilities: Record<string, { purpose: string; inputs: unknown[]; outputs: unknown[]; handler: string; operations: string[]; events: string[]; policies?: string[] }> }>('capabilities.json');
    for (const c of seed.capabilities) {
      const k = contracts.capabilities[c.name];
      if (!k) throw new ConstitutionalError('Phase008-§5.2', `capability ${c.name} has no registered contract`);
      const cap = this.admit({ kind: 'Capability', canonicalId: c.id, name: c.name, statement: k.purpose, aliases: [`CAP:${c.name}`], content: { purpose: k.purpose, cluster: c.cluster, inputs: k.inputs, outputs: k.outputs, handler: k.handler, operations: k.operations, events: k.events, policies: k.policies ?? [], dependencies: [], telemetry: { events: k.events }, contract: null }, provenance: { source: 'registries/capability-registry.json', locator: c.id } });
      const contract = this.admit({ kind: 'CapabilityContract', name: `${c.name} contract`, statement: '', content: { provider: cap.canonicalId, consumer: 'any composition', version: '1.0.0', inputs: k.inputs, outputs: k.outputs, events: k.events, policies: k.policies ?? [], obligations: ['evaluate policy before execution (UCL-G01)', 'emit registered events on completion or failure (V-AC-03)'], prohibitions: ['execute under a suspended composition (C-CM-03)'], serviceLevels: contracts.defaults.serviceLevels, terminationConditions: ['capability deprecated or retired', 'certification revoked'] }, dependencies: [{ target: cap.canonicalId, type: 'CONSTITUTIVE' }], provenance: { source: 'metadata/capabilities.json', locator: c.name } });
      this.p.fabric.amend(cap.canonicalId, this.roles.author, (e) => {
        e.content.contract = contract.canonicalId;
      }, 'CONTRACT');
    }
    const gens = this.p.sources.seed<{ generators: { id: string; targetSpace: string; reads: string[]; writes: string; notes: string }[]; preservationRequirements: { property?: string; failure?: string }[]; generatorDAG: string[] }>('generator-registry.json');
    const mappings = this.p.sources.metadata<{ generators: Record<string, { version: string; variants: string[] } & Record<string, unknown>> }>('generator-mappings.json').generators;
    const genIds = new Map<string, string>();
    for (const g of gens.generators) {
      const m = mappings[g.targetSpace];
      const proof = Object.fromEntries(gens.preservationRequirements.filter((r) => r.property).map((r) => [String(r.property).toLowerCase(), `checked per artifact by GenerationEngine.checkPreservation; failure mode: ${r.failure}`]));
      const e = this.admit({ kind: 'Generator', canonicalId: g.id, name: `${g.targetSpace} Generator`, statement: `Renders ${g.writes} from ${g.reads.join(', ')}.`, aliases: [`GEN:${g.targetSpace}`], content: { targetSpace: g.targetSpace, reads: g.reads, writes: g.writes, notes: g.notes, version: m.version, variants: m.variants, transformation: m, preservationProof: proof }, provenance: { source: 'registries/generator-registry.json', locator: g.id } });
      genIds.set(g.targetSpace.split(' ')[0].toLowerCase(), e.canonicalId);
      genIds.set(g.targetSpace.toLowerCase(), e.canonicalId);
    }
    for (const line of gens.generatorDAG) {
      const m = /^(.+?) Generator -> (.+?) Generator/.exec(line);
      if (m) {
        const from = genIds.get(m[1].toLowerCase());
        const to = genIds.get(m[2].toLowerCase());
        if (from && to) this.p.fabric.relate('DEPENDS-ON', to, from, this.roles.author, { context: { reason: line } });
      } else if (/^All -> Documentation/.test(line)) {
        const doc = genIds.get('documentation');
        for (const [k, id] of genIds) if (id !== doc && !k.includes(' ') && doc) this.p.fabric.relate('DEPENDS-ON', doc, id, this.roles.author, { context: { reason: line } });
      }
    }
    const recipes = this.p.sources.seed<{ recipes: { label: string; over: string[] }[] }>('composition-registry.json').recipes;
    const council = this.roles.ratifiers.find((r) => r.authority === 'Foundation Council') ?? this.roles.ratifiers[0];
    const composer: Actor = { principal: council.principal, authority: 'Foundation Council' };
    const failures: string[] = [];
    for (const r of recipes) {
      const comp = this.p.composition.compose({ label: r.label, intent: `Arrange ${r.over.join(', ')} into one governed whole.`, capabilities: r.over }, composer);
      const v = this.p.composition.validate(comp.canonicalId, composer);
      if (v.violations.length) {
        failures.push(`${r.label}: ${v.violations.map((x) => `${x.rule} ${x.message}`).join('; ')}`);
        continue;
      }
      this.p.composition.certify(comp.canonicalId, this.roles.certifier);
      this.tally('Composition');
    }
    if (failures.length) throw new ConstitutionalError('V-CM-01', `registered recipes do not validate:\n${failures.join('\n')}`);
    this.log(`capabilities and compositions seeded: ${JSON.stringify(this.counts)}`);
  }

  // ── 8. intelligence ─────────────────────────────────────────────────────

  private seedIntelligence(): void {
    const intel = this.p.sources.seed<{ engines: { name: string; composition: string[]; outputs: string; responsibilities: string[]; constraints: string | string[] }[]; autonomyLevels: { level: string; mayDo: string; requires: string }[] }>('intelligence-registry.json');
    const meta = this.p.sources.metadata<{ engines: Record<string, { objective: string; autonomyLevel: string; escalationPath: string; learningPolicy: Record<string, unknown>; operatingAuthority: string }> }>('intelligence.json');
    for (const eng of intel.engines) {
      const m = meta.engines[eng.name];
      if (!m) throw new ConstitutionalError('V-IN-01', `intelligence engine ${eng.name} has no registered objective`);
      const objective = this.admit({ kind: 'Objective', name: `${eng.name} objective`, statement: m.objective, content: { sense: 'maximize', criteria: [{ expression: 'confidence', weight: 1 }], engine: eng.name }, provenance: { source: 'metadata/intelligence.json', locator: eng.name } });
      const cap = this.admit({
        kind: 'IntelligenceCapability',
        name: eng.name,
        statement: `The ${eng.name} produces ${eng.outputs}.`,
        aliases: [`INT:${eng.name}`],
        derivationChain: eng.composition.map((c) => c.split(' ')[0]).filter((c) => this.p.ontology.lookup(c)),
        content: {
          engineCluster: eng.name,
          composition: eng.composition,
          responsibilities: eng.responsibilities,
          constraints: eng.constraints,
          objective: objective.canonicalId,
          knowledgeBase: ['UCOS-REG-KNW-0000000001'],
          model: null,
          policyEnvelope: { owner: 'Constitutional Assembly', operatingAuthority: m.operatingAuthority, policies: this.p.policy.policies().filter((pol) => pol.definition.canonicalName === 'Intelligence Envelope').map((pol) => pol.canonicalId) },
          autonomyLevel: m.autonomyLevel,
          escalationPath: m.escalationPath,
          learningPolicy: m.learningPolicy,
          alignmentEvidence: null,
          contextBounds: {},
          autonomyLevels: intel.autonomyLevels,
        },
        dependencies: [{ target: objective.canonicalId, type: 'SEMANTIC' }],
        provenance: { source: 'registries/intelligence-registry.json', locator: eng.name },
      });
      if (m.autonomyLevel !== 'advisory' && m.autonomyLevel !== 'escalation-only') {
        const reviewer = this.roles.ratifiers.find((r) => r.authority === 'Foundation Council') ?? this.roles.ratifiers[0];
        this.p.autonomy.recordAlignment(cap.canonicalId, { method: 'constitutional review at genesis', envelope: 'Intelligence Envelope', checks: ['IN-A1..IN-A6 structurally enforced', 'policy envelope owned by Constitutional Assembly'] }, { principal: reviewer.principal, authority: 'Foundation Council' });
      }
    }
    const events = new Set<string>();
    const apis = new Set<string>();
    for (const file of ['foundation-registry.json', 'registry-registry.json', 'taxonomy-registry.json', 'offering-facet-registry.json', 'context-registry.json', 'capability-registry.json', 'composition-registry.json', 'generator-registry.json', 'intelligence-registry.json']) {
      const s = this.p.sources.seed<{ events?: string[]; apis?: string[] }>(file);
      for (const e of s.events ?? []) events.add(e);
      for (const a of s.apis ?? []) apis.add(a);
    }
    const platformEvents = this.p.sources.metadata<{ events: Record<string, string> }>('platform-events.json').events;
    for (const e of events) this.admit({ kind: 'EventType', name: e, statement: platformEvents[e] ?? `The ${e} event, announced by the constitution's registered transitions.`, content: { source: 'constitution' }, provenance: { source: 'registries/*.json#events', locator: e } });
    for (const [e, statement] of Object.entries(platformEvents)) if (!events.has(e)) this.admit({ kind: 'EventType', name: e, statement, content: { source: 'platform' }, provenance: { source: 'metadata/platform-events.json', locator: e } });
    for (const a of apis) this.admit({ kind: 'ActionType', name: a, statement: '', content: { source: 'constitution' }, provenance: { source: 'registries/*.json#apis', locator: a } });
    this.log(`intelligence seeded: ${JSON.stringify(this.counts)}`);
  }

  /** Projects DERIVES-FROM edges for entries admitted before their derivation targets existed. */
  private linkDerivations(): void {
    let linked = 0;
    for (const e of this.p.fabric.iterate()) {
      for (const link of e.definition.derivationChain) {
        const target = this.p.fabric.tryResolve(link.split(' ')[0]);
        if (!target || target.entry.canonicalId === e.canonicalId) continue;
        if (this.p.store.edgesFrom(e.canonicalId, 'DERIVES-FROM').some((x) => x.target === target.entry.canonicalId)) continue;
        this.p.fabric.relate('DERIVES-FROM', e.canonicalId, target.entry.canonicalId, this.roles.author);
        linked++;
      }
    }
    this.counts.derivationLinks = linked;
  }
}
