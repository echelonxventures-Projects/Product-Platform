import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfig, platformPath, readJson, type PlatformConfig } from './kernel/config.ts';
import { Store } from './kernel/store.ts';
import { SystemClock, type Clock } from './kernel/clock.ts';
import { EventBus, type Actor } from './kernel/events.ts';
import { IdentityMint } from './kernel/ids.ts';
import { randomToken, sha256 } from './kernel/hash.ts';
import { ConstitutionalError } from './kernel/errors.ts';
import { RegistryFabric, qualifiedName } from './registry/fabric.ts';
import { LifecycleEngine } from './registry/lifecycle.ts';
import { Governance, type GovernanceMetadata } from './registry/governance.ts';
import type { Entry } from './registry/types.ts';
import { ConstitutionSources } from './constitution/sources.ts';
import { Ontology } from './constitution/ontology.ts';
import { UniverseService } from './constitution/universes.ts';
import { ValidationEngine } from './validation/engine.ts';
import { TaxonomyEngine } from './taxonomy/engine.ts';
import { ContextEngine, type ContextModels } from './context/engine.ts';
import { PolicyEngine } from './policy/engine.ts';
import { MeasureService } from './commerce/measure.ts';
import { Ledger } from './commerce/ledger.ts';
import { EntityService } from './commerce/entities.ts';
import { CommerceEngine } from './commerce/engine.ts';
import { CompositionEngine } from './composition/engine.ts';
import { CapabilityRuntime } from './capabilities/runtime.ts';
import { TrustService, DisputeService, ResourceService, WorkflowService, NotificationService, OrderingService, ContractService, RiskService } from './capabilities/services.ts';
import { GenerationEngine } from './generation/engine.ts';
import { DecisionService } from './intelligence/decisions.ts';
import { DiscoveryEngine } from './intelligence/discovery.ts';
import { KnowledgeEngine } from './intelligence/knowledge.ts';
import { ReasoningEngine } from './intelligence/reasoning.ts';
import { RecommendationEngine } from './intelligence/recommendation.ts';
import { OptimizationEngine } from './intelligence/optimization.ts';
import { AutonomyEngine } from './intelligence/autonomy.ts';
import { evaluateBoolean } from './rules/expression.ts';

/** Per-locale labels are knowledge on the artifact, never string constants (Phase 007 §5.8). */
class LabelService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }
  label(id: string, locale: string): { id: string; locale: string; label: string; fallback: boolean } {
    const e = this.p.fabric.resolve(id).entry;
    const label = e.labels?.[locale];
    return { id: e.canonicalId, locale, label: label ?? e.labels?.[this.p.cfg.platform.defaultLocale] ?? e.definition.canonicalName, fallback: !label };
  }
  setLabel(id: string, locale: string, label: string, actor: Actor): Entry {
    return this.p.fabric.amend(this.p.fabric.resolve(id).entry.canonicalId, actor, (e) => {
      e.labels = { ...(e.labels ?? {}), [locale]: label };
    }, 'LABEL', 'ling.label.set');
  }
}

class ReportingService {
  private readonly p: Platform;
  constructor(p: Platform) {
    this.p = p;
  }
  valueTotals(purpose?: string, namespace?: string): { unit: string; total: number; count: number }[] {
    const rows = this.p.store
      .prepare(`SELECT json_extract(body, '$.content.unit') unit, SUM(json_extract(body, '$.content.magnitude')) total, COUNT(*) n FROM heads WHERE kind = 'Value' ${purpose ? "AND json_extract(body, '$.content.purpose') = ?" : ''} ${namespace ? 'AND namespace = ?' : ''} GROUP BY unit ORDER BY unit`)
      .all(...[purpose, namespace].filter((x): x is string => !!x)) as { unit: string; total: number; n: number }[];
    return rows.map((r) => ({ unit: r.unit, total: r.total, count: r.n }));
  }
}

export interface Credentials {
  attestationKey: string;
  tokens: Record<string, string>;
}

/**
 * The composition root. Everything the platform does is reached through one
 * of these services; each holds no domain content of its own — all content
 * is registered metadata read back from the fabric.
 */
export class Platform {
  readonly cfg: PlatformConfig;
  readonly store: Store;
  readonly clock: Clock;
  readonly bus: EventBus;
  readonly mint: IdentityMint;
  readonly fabric: RegistryFabric;
  readonly lifecycles: LifecycleEngine;
  readonly governance: Governance;
  readonly sources: ConstitutionSources;
  readonly ontology: Ontology;
  readonly universes: UniverseService;
  readonly validation: ValidationEngine;
  readonly taxonomy: TaxonomyEngine;
  readonly context: ContextEngine;
  readonly policy: PolicyEngine;
  readonly measure: MeasureService;
  readonly ledger: Ledger;
  readonly entities: EntityService;
  readonly commerce: CommerceEngine;
  readonly composition: CompositionEngine;
  readonly runtime: CapabilityRuntime;
  readonly trust: TrustService;
  readonly disputes: DisputeService;
  readonly resources: ResourceService;
  readonly workflow: WorkflowService;
  readonly notifications: NotificationService;
  readonly ordering: OrderingService;
  readonly contracts: ContractService;
  readonly risk: RiskService;
  readonly generation: GenerationEngine;
  readonly decisions: DecisionService;
  readonly discovery: DiscoveryEngine;
  readonly knowledge: KnowledgeEngine;
  readonly reasoning: ReasoningEngine;
  readonly recommendation: RecommendationEngine;
  readonly optimization: OptimizationEngine;
  readonly autonomy: AutonomyEngine;
  readonly labels: LabelService;
  readonly reporting: ReportingService;
  readonly expressions = { boolean: (expr: string, scope: Record<string, unknown>): boolean => {
    try {
      return evaluateBoolean(expr, { scope });
    } catch {
      return false;
    }
  } };
  lawIndex = new Map<string, { id: string; namespace: string; statement: string; assertion: string; appliesWhen?: string }[]>();
  prohibitedActions = new Set<string>();
  credentials: Credentials = { attestationKey: '', tokens: {} };

  constructor(options: { config?: string; database?: string; clock?: Clock } = {}) {
    this.cfg = loadConfig(options.config);
    this.store = new Store(options.database ?? platformPath(this.cfg.paths.database));
    this.clock = options.clock ?? new SystemClock();
    this.bus = new EventBus(this.store, this.clock);
    this.mint = new IdentityMint(this.store, this.cfg.identity.prefix, this.cfg.identity.sequenceWidth, this.cfg.identity.separator);
    const regMeta = readJson<{ supplements: Record<string, unknown> }>(`${this.cfg.paths.platformMetadata}/registries.json`);
    void regMeta;
    this.fabric = new RegistryFabric(this.store, this.clock, this.bus, this.mint, 'UCOS-REG-REL-0000000001', 'UCOS-REG-REL-0000000002');
    this.lifecycles = new LifecycleEngine(this.fabric);
    this.sources = new ConstitutionSources(this.cfg);
    this.governance = new Governance(this.fabric, this.sources.metadata<GovernanceMetadata>('governance.json'));
    this.fabric.governance = this.governance;
    this.fabric.lifecycles = this.lifecycles;
    this.ontology = new Ontology(this.fabric);
    this.universes = new UniverseService(this);
    this.validation = new ValidationEngine(this);
    this.taxonomy = new TaxonomyEngine(this);
    this.context = new ContextEngine(this);
    this.policy = new PolicyEngine(this);
    this.measure = new MeasureService(this);
    this.ledger = new Ledger(this);
    this.entities = new EntityService(this);
    this.commerce = new CommerceEngine(this);
    this.composition = new CompositionEngine(this);
    this.runtime = new CapabilityRuntime(this);
    this.trust = new TrustService(this);
    this.disputes = new DisputeService(this);
    this.resources = new ResourceService(this);
    this.workflow = new WorkflowService(this);
    this.notifications = new NotificationService(this);
    this.ordering = new OrderingService(this);
    this.contracts = new ContractService(this);
    this.risk = new RiskService(this);
    this.generation = new GenerationEngine(this);
    this.decisions = new DecisionService(this);
    this.discovery = new DiscoveryEngine(this);
    this.knowledge = new KnowledgeEngine(this);
    this.reasoning = new ReasoningEngine(this);
    this.recommendation = new RecommendationEngine(this);
    this.optimization = new OptimizationEngine(this);
    this.autonomy = new AutonomyEngine(this);
    this.labels = new LabelService(this);
    this.reporting = new ReportingService(this);
    this.loadCredentials();
    this.install();
    this.hydrate();
  }

  private install(): void {
    const primitives = this.sources.seed<{ primitives: { id: string; alias: string; name: string }[] }>('primitive-registry.json').primitives;
    const concepts = this.sources.seed<{ concepts: { id: string; alias: string; name: string; derivesFrom: string[] }[] }>('concept-registry.json').concepts;
    this.ontology.loadSeeds(primitives, concepts);
    this.ontology.loadLexicon(this.sources.metadata('prohibited-lexicon.json'));
    this.context.configure(this.sources.metadata<ContextModels>('context-models.json'));
    this.validation.install();
    this.taxonomy.install();
    this.context.install();
    this.measure.install();
    this.ledger.install();
    this.entities.install();
    this.commerce.install();
    this.composition.install();
    this.trust.install();
    this.disputes.install();
    this.resources.install();
    this.generation.install(this.credentials.attestationKey);
    this.optimization.install();
    this.autonomy.install();
    this.lifecycles.addFactProvider((entry, _to, scope) => this.foundationFacts(entry, scope));
    this.fabric.hooks.onCertified.push((e) => {
      if (e.kind === 'Policy') this.policy.invalidate();
      if (e.kind === 'Law' || e.kind === 'Invariant') this.indexLaw(e);
      if (e.kind === 'ContextDimension') this.context.addDimension(e);
      if (e.kind === 'Unit' || e.kind === 'UnitConversion') this.measure.hydrate();
      if (e.kind === 'Facet') this.commerce.hydrate();
      if (e.kind === 'Lifecycle' && e.classification.namespace === 'UCOS' && e.content.definition) this.lifecycles.define(e.content.definition as never);
      if (e.kind === 'GovernanceBody') this.governance.cacheBody(e);
    });
    this.fabric.hooks.onPersist.push((e) => {
      if (e.kind === 'Principal') this.governance.cachePrincipal(e);
      if (e.kind === 'GovernanceBody') this.governance.cacheBody(e);
    });
  }

  /** Facts for the foundation lifecycle guards (Phase 001 §10). */
  private foundationFacts(entry: Entry, scope: Record<string, unknown>): Record<string, unknown> {
    const registry = this.fabric.registry(entry.registryId);
    if (registry.admissionMode !== 'constitutional') return {};
    const chain = this.ontology.checkChain(entry.definition.derivationChain, entry.kind, [...entry.identity.aliases, entry.canonicalId]);
    const approvals = Number(scope.approvals ?? entry.evidence.ratification?.approvals.length ?? 0);
    const quorum = Number(scope.quorum ?? this.governance.quorumOf(entry.ownership.ratifyingBody));
    const validation = entry.evidence.validation;
    return {
      derivationValid: chain.violations.length === 0,
      quorumMet: approvals >= quorum,
      evidenceComplete: !!validation?.passed && !!entry.evidence.ratification,
      acyclic: true,
      duplicate: false,
    };
  }

  private loadCredentials(): void {
    const file = platformPath(this.cfg.paths.credentials);
    if (existsSync(file)) this.credentials = JSON.parse(readFileSync(file, 'utf8')) as Credentials;
    if (process.env.UCOS_ATTESTATION_KEY) this.credentials.attestationKey = process.env.UCOS_ATTESTATION_KEY;
    if (!this.credentials.attestationKey) {
      this.credentials.attestationKey = randomToken(32);
      this.saveCredentials();
    }
  }

  saveCredentials(): void {
    const file = platformPath(this.cfg.paths.credentials);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(this.credentials, null, 2));
    chmodSync(file, 0o600);
  }

  /** Rebuilds every in-memory index from the persisted fabric. */
  hydrate(): void {
    this.fabric.hydrate();
    this.lifecycles.hydrate();
    this.governance.hydrate();
    this.context.hydrate();
    this.commerce.hydrate();
    this.measure.hydrate();
    this.generation.hydrate();
    this.policy.invalidate();
    this.lawIndex.clear();
    for (const kind of ['Law', 'Invariant']) for (const e of this.fabric.iterate(kind)) if (e.lifecycle.status === 'CERTIFIED') this.indexLaw(e);
  }

  private indexLaw(e: Entry): void {
    const formal = e.content.formal as { kind?: string; assertion?: string; appliesWhen?: string; prohibits?: string[] } | undefined;
    if (formal?.prohibits) for (const a of formal.prohibits) this.prohibitedActions.add(a);
    if (!formal?.kind || !formal.assertion) return;
    const list = this.lawIndex.get(formal.kind) ?? [];
    list.push({ id: e.identity.aliases[0] ?? e.canonicalId, namespace: e.classification.namespace, statement: e.definition.canonicalStatement, assertion: formal.assertion, appliesWhen: formal.appliesWhen });
    this.lawIndex.set(formal.kind, list);
  }

  isBootstrapped(): boolean {
    return !!this.store.getMeta('bootstrapped');
  }

  qualifiedName(e: Entry): string {
    return qualifiedName(e);
  }

  /** The Registry Office acting for platform-originated records. */
  systemActor(): Actor {
    const registrar = this.governance.membersOf(this.governance.registryOffice())[0];
    if (!registrar) return { principal: 'UCOS-FR-FND-0000000000', authority: this.governance.registryOffice() };
    return { principal: registrar.canonicalId, authority: this.governance.registryOffice() };
  }

  /** The autonomous governance principal, acting with its registered purpose (UCI-020). */
  governanceAgent(): Actor | null {
    const agent = this.governance.principalList().find((pr) => pr.principalKind === 'agent' && pr.status === 'ACTIVE');
    if (!agent) return null;
    const cap = this.fabric.query({ kind: 'IntelligenceCapability', nameLike: 'Autonomous Governance', limit: 1 }).entries[0];
    const objective = cap ? String(cap.content.objective) : null;
    if (!objective) return null;
    return { principal: agent.canonicalId, authority: String((cap.content.policyEnvelope as { operatingAuthority?: string })?.operatingAuthority ?? 'Domain Authorities'), autonomous: true, purpose: objective };
  }

  operationalNamespace(): string {
    return this.sources.metadata<{ operationalNamespaces: { code: string }[] }>('registries.json').operationalNamespaces[0].code;
  }

  namespaceOf(ref: string): string {
    const e = this.fabric.tryResolve(ref)?.entry;
    const ns = e?.classification.namespace;
    if (!ns) return this.operationalNamespace();
    return ns;
  }

  defaultNamespace(entity: Entry): string {
    return this.fabric.namespaceKind(entity.classification.namespace) ? entity.classification.namespace : this.operationalNamespace();
  }

  commerceSchemes(): string[] {
    const tax = this.sources.seed<{ schemes: { id: string; owner: string }[] }>('taxonomy-registry.json');
    return tax.schemes.filter((s) => /Commerce|Product|Service|Asset/.test(s.owner)).map((s) => s.id).filter((id) => this.fabric.exists(id));
  }

  facetAdmissibilityRules(): { expression: string; statement: string }[] {
    return this.fabric
      .query({ kind: 'Rule', status: ['CERTIFIED', 'ADMISSIBLE'], contentPath: 'ruleClass', contentEquals: 'facet-admissibility', limit: 1000 })
      .entries.map((e) => ({ expression: String(e.content.expression), statement: e.definition.canonicalStatement }));
  }

  coverageSummary(): { total: number; registered: number; referenced: number; unregistered: number } | null {
    const exists = this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='corpus_coverage'").get();
    if (!exists) return null;
    const rows = this.store.db.prepare('SELECT status, COUNT(*) n FROM corpus_coverage GROUP BY status').all() as { status: string; n: number }[];
    const by = Object.fromEntries(rows.map((r) => [r.status, r.n]));
    const total = rows.reduce((s, r) => s + r.n, 0);
    return { total, registered: by.registered ?? 0, referenced: by.referenced ?? 0, unregistered: by.refused ?? 0 };
  }

  /** Registers a principal with a governed membership and issues its credential. */
  registerPrincipal(input: { alias: string; name: string; principalKind: string; bodies: string[] }, actor: Actor | null): { principal: Entry; token: string } {
    if (actor) {
      const ctx = this.context.forPurpose('access', {}, actor);
      this.policy.enforce({ action: 'principal.register', actor, context: ctx });
    }
    const violations = this.governance.membershipViolations(input.bodies);
    if (violations.length) throw new ConstitutionalError(violations[0].slice(0, 4), violations.join('; '));
    const token = process.env[`${this.cfg.security.tokenEnvPrefix}${input.alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] ?? randomToken(this.cfg.security.tokenBytes);
    const principal = this.fabric.submit(
      {
        kind: 'Principal',
        name: input.name,
        statement: '',
        aliases: [input.alias],
        content: { principalKind: input.principalKind, bodies: input.bodies, tokenHash: sha256(token, this.cfg.security.tokenHashAlgorithm) },
        labels: { [this.cfg.platform.defaultLocale]: input.name },
        provenance: { source: actor ? 'identity-capability' : 'genesis' },
      },
      actor ?? { principal: 'UCOS-FR-FND-0000000000', authority: 'Constitutional Assembly' },
    );
    this.governance.cachePrincipal(principal);
    this.credentials.tokens[input.alias] = token;
    this.saveCredentials();
    return { principal, token };
  }

  close(): void {
    this.store.close();
  }
}
