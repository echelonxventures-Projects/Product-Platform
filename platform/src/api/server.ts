import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import { ConstitutionalError, AuthorizationError } from '../kernel/errors.ts';
import { platformPath } from '../kernel/config.ts';

type Ctx = { req: IncomingMessage; res: ServerResponse; params: Record<string, string>; query: URLSearchParams; body: Record<string, unknown>; actor: Actor | null };
type Handler = (c: Ctx) => unknown | Promise<unknown>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  auth: boolean;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.sql': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.nt': 'text/plain; charset=utf-8', '.graphml': 'application/xml', '.jsonld': 'application/ld+json', '.txt': 'text/plain; charset=utf-8' };

/**
 * HTTP surface of the platform. Every route is a thin binding onto a
 * platform operation; protected operations are evaluated by the policy
 * engine inside the operation itself (UCL-G01). Reads of public content need
 * no credential (RG-P7); every mutation needs an accountable principal
 * (UCI-006).
 */
export class ApiServer {
  private readonly p: Platform;
  private readonly routes: Route[] = [];
  private auditCache: { at: number; report: unknown } | null = null;

  constructor(p: Platform) {
    this.p = p;
    this.register();
  }

  private add(method: string, path: string, handler: Handler, auth = true): void {
    const keys: string[] = [];
    const pattern = new RegExp('^' + path.replace(/:([a-zA-Z]+)(\*)?/g, (_m, k: string, star: string) => {
      keys.push(k);
      return star ? '(.+)' : '([^/]+)';
    }) + '$');
    this.routes.push({ method, pattern, keys, handler, auth });
  }

  /** Resolves the accountable actor from a bearer credential (UCI-006). */
  private actorFor(req: IncomingMessage): Actor | null {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    const principal = this.p.governance.authenticate(h.slice(7).trim(), this.p.cfg.security.tokenHashAlgorithm);
    if (!principal) throw new AuthorizationError('UCL-G02', 'credential not recognised; trust is never implicit');
    const authority = (req.headers['x-ucos-authority'] as string | undefined) ?? undefined;
    const actor = this.p.governance.actor(principal.canonicalId, authority);
    const purpose = req.headers['x-ucos-purpose'] as string | undefined;
    const onBehalfOf = req.headers['x-ucos-on-behalf-of'] as string | undefined;
    if (purpose) actor.purpose = purpose;
    if (onBehalfOf) actor.onBehalfOf = onBehalfOf;
    if (principal.principalKind === 'agent' && !actor.purpose) {
      const agent = this.p.governanceAgent();
      if (agent) actor.purpose = agent.purpose;
    }
    return actor;
  }

  private reader(c: Ctx): Actor {
    return c.actor ?? this.p.systemActor();
  }

  private need(c: Ctx): Actor {
    if (!c.actor) throw new AuthorizationError('UCI-006', 'this operation requires an accountable principal (Authorization: Bearer <token>)');
    return c.actor;
  }

  private ctxMap(c: Ctx): Record<string, Record<string, unknown>> | undefined {
    return (c.body.context as Record<string, Record<string, unknown>> | undefined) ?? undefined;
  }

  private register(): void {
    const p = this.p;
    const n = (v: string | null, d: number) => (v === null || v === '' ? d : Number(v));

    // ── platform ──
    this.add('GET', '/api/health', () => ({ status: 'ok', bootstrapped: p.isBootstrapped(), corpusIngested: !!p.store.getMeta('corpusIngested'), at: p.clock.now() }), false);
    this.add('GET', '/api/platform', () => ({
      name: p.cfg.platform.name,
      version: p.cfg.platform.version,
      bootstrappedAt: p.store.getMeta('bootstrapped') ?? null,
      corpusIngestedAt: p.store.getMeta('corpusIngested') ?? null,
      counts: { byKind: p.fabric.countBy('kind'), byStatus: p.fabric.countBy('status'), byNamespace: p.fabric.countBy('namespace'), events: p.bus.count() },
      coverage: p.coverageSummary(),
      registries: p.fabric.registryDefinitions().length,
      universes: p.universes.list('universe').length,
      autonomy: { governanceAgent: p.governanceAgent()?.principal ?? null },
    }), false);
    this.add('GET', '/api/me', (c) => {
      if (!c.actor) return { actor: null };
      const { tokenHash: _hidden, ...principal } = p.governance.principal(c.actor.principal);
      return { actor: c.actor, principal };
    }, false);
    this.add('GET', '/api/principals', () => p.governance.principalList().map((x) => ({ id: x.canonicalId, alias: x.alias, name: x.name, kind: x.principalKind, bodies: x.bodies, status: x.status })), false);
    this.add('GET', '/api/bodies', () => p.governance.bodies(), false);
    this.add('POST', '/api/principals', (c) => {
      const out = p.registerPrincipal({ alias: String(c.body.alias), name: String(c.body.name), principalKind: String(c.body.principalKind ?? 'human'), bodies: (c.body.bodies as string[]) ?? [] }, this.need(c));
      return { principal: out.principal, token: out.token, note: 'store this credential; it is shown once' };
    });

    // ── registries & entries ──
    this.add('GET', '/api/registries', () => {
      const counts = p.fabric.countBy('registry_id');
      return p.fabric.registryDefinitions().map((r) => ({ ...r, entries: counts[r.registryId] ?? 0 })).sort((a, b) => a.registryId.localeCompare(b.registryId));
    }, false);
    this.add('GET', '/api/entries', (c) => p.fabric.query({ registryId: c.query.get('registry') ?? undefined, kind: c.query.get('kind') ?? undefined, status: c.query.get('status') ?? undefined, namespace: c.query.get('namespace') ?? undefined, nameLike: c.query.get('name') ?? undefined, limit: n(c.query.get('limit'), 50), offset: n(c.query.get('offset'), 0) }), false);
    this.add('GET', '/api/entries/:ref', (c) => {
      const r = p.fabric.resolve(decodeURIComponent(c.params.ref));
      const ctx = p.context.forPurpose('access', {}, this.reader(c));
      const verdict = p.policy.evaluate({ action: 'registry.read', subject: r.entry, actor: this.reader(c), context: ctx }, { record: false });
      if (verdict.decision === 'DENY') throw new AuthorizationError('UCL-G01', verdict.reason, verdict);
      return { ...r, relationships: p.fabric.relationshipsOf(r.entry.canonicalId), dependents: p.fabric.dependents(r.entry.canonicalId), attestation: p.fabric.attest(r.entry.canonicalId) };
    }, false);
    this.add('GET', '/api/entries/:ref/lineage', (c) => p.fabric.lineage(p.fabric.resolve(decodeURIComponent(c.params.ref)).entry.canonicalId), false);
    this.add('GET', '/api/entries/:ref/attest', (c) => p.fabric.attest(p.fabric.resolve(decodeURIComponent(c.params.ref)).entry.canonicalId), false);
    this.add('GET', '/api/entries/:ref/graph', (c) => p.fabric.traverse(decodeURIComponent(c.params.ref), { depth: n(c.query.get('depth'), 1), types: c.query.get('types')?.split(',').filter(Boolean), direction: (c.query.get('direction') as 'out') ?? 'both', limit: n(c.query.get('limit'), 300) }), false);
    this.add('GET', '/api/entries/:ref/validation', (c) => p.validation.layered(p.fabric.resolve(decodeURIComponent(c.params.ref)).entry), false);
    this.add('GET', '/api/entries/:ref/derivation', (c) => p.ontology.derivation(decodeURIComponent(c.params.ref)), false);
    this.add('POST', '/api/entries', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('governance', this.ctxMap(c) ?? {}, actor);
      p.policy.enforce({ action: 'registry.submit', actor, context: ctx });
      return p.fabric.submit(c.body.candidate as never, actor);
    });
    this.add('POST', '/api/entries/:ref/:op', (c) => {
      const actor = this.need(c);
      const id = p.fabric.resolve(decodeURIComponent(c.params.ref)).entry.canonicalId;
      const op = c.params.op;
      const ctx = p.context.forPurpose('governance', this.ctxMap(c) ?? {}, actor);
      p.policy.enforce({ action: `registry.${op}`, subject: p.fabric.require(id), actor, context: ctx });
      switch (op) {
        case 'propose':
          return p.fabric.propose(id, actor);
        case 'ratify':
          return p.fabric.ratify(id, [actor, ...((c.body.coApprovers as string[]) ?? []).map((x) => p.governance.actor(x))]);
        case 'certify':
          return p.fabric.certify(id, actor, String(c.body.certificationClass ?? 'STANDARD'));
        case 'supersede':
          return p.fabric.supersede(id, String(c.body.successor), actor, (c.body.compatibility as never) ?? 'COMPATIBLE-EXTENDING');
        case 'deprecate':
          return p.fabric.deprecate(id, String(c.body.successor), actor);
        case 'retire':
          return p.fabric.retire(id, actor);
        case 'revoke':
          return { revoked: p.fabric.revokeCertification(id, actor, String(c.body.cause ?? 'unstated')) };
        case 'federate':
          return p.fabric.federate(id);
        default:
          throw new ConstitutionalError('Phase004-§7', `unknown registry operation ${op}`);
      }
    });
    this.add('POST', '/api/relationships', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('governance', {}, actor);
      p.policy.enforce({ action: 'registry.relate', actor, context: ctx });
      return p.fabric.relate(String(c.body.type), String(c.body.source), String(c.body.target), actor, { context: c.body.context as Record<string, unknown> | undefined });
    });
    this.add('POST', '/api/federation/reconcile', (c) => p.fabric.reconcile(c.body as never), false);
    this.add('GET', '/api/relationship-types', () => p.fabric.relationshipTypes(), false);
    this.add('GET', '/api/lifecycles', () => p.lifecycles.all(), false);

    // ── universes & namespaces ──
    this.add('GET', '/api/universes', () => {
      const counts = p.fabric.countBy('namespace');
      return p.universes.list().map((u) => ({ id: u.canonicalId, code: u.content.code, name: u.definition.canonicalName, statement: u.definition.canonicalStatement, kind: u.content.namespaceKind, entries: counts[String(u.content.code)] ?? 0, futureDependencies: u.content.futureDependencies ?? [], dependsOn: p.store.edgesFrom(u.canonicalId, 'DEPENDS-ON').map((e) => p.store.head(e.target)?.canonical_name) }));
    }, false);
    this.add('GET', '/api/universes/:code', (c) => {
      const u = p.fabric.resolve(`UNI:${c.params.code}`).entry;
      const ns = String(u.content.code);
      const byKind = p.store.db.prepare('SELECT kind, COUNT(*) n FROM heads WHERE namespace = ? GROUP BY kind').all(ns);
      const documents = p.fabric.query({ kind: 'CorpusDocument', namespace: ns, limit: 1000 }).entries.map((d) => ({ id: d.canonicalId, name: d.definition.canonicalName, title: d.content.title, status: d.lifecycle.status }));
      return { universe: u, byKind, documents, dependsOn: p.store.edgesFrom(u.canonicalId, 'DEPENDS-ON').map((e) => ({ id: e.target, name: p.store.head(e.target)?.canonical_name })), dependents: p.store.edgesTo(u.canonicalId, 'DEPENDS-ON').map((e) => ({ id: e.source, name: p.store.head(e.source)?.canonical_name })) };
    }, false);
    this.add('POST', '/api/namespaces', (c) => p.universes.registerOperational({ code: String(c.body.code), name: String(c.body.name), statement: String(c.body.statement ?? `Operating domain ${String(c.body.code)}.`) }, this.need(c)));

    // ── discovery & ontology ──
    this.add('GET', '/api/discovery', (c) => p.discovery.search(c.query.get('q') ?? '', { kinds: c.query.get('kinds')?.split(',').filter(Boolean), namespace: c.query.get('namespace') ?? undefined, limit: n(c.query.get('limit'), 25), actor: this.reader(c) }), false);
    this.add('GET', '/api/ontology', () => ({ primitives: p.ontology.primitives(), concepts: p.ontology.concepts() }), false);

    // ── taxonomy ──
    this.add('GET', '/api/taxonomy/schemes', (c) => p.fabric.query({ kind: 'TaxonomyScheme', namespace: c.query.get('namespace') ?? undefined, limit: n(c.query.get('limit'), 200), offset: n(c.query.get('offset'), 0) }), false);
    this.add('GET', '/api/taxonomy/schemes/:id/tree', (c) => p.taxonomy.tree(decodeURIComponent(c.params.id)), false);
    this.add('GET', '/api/taxonomy/paths/:entity', (c) => p.taxonomy.paths(decodeURIComponent(c.params.entity)), false);
    this.add('GET', '/api/taxonomy/policies/:entity', (c) => p.taxonomy.policiesFor(decodeURIComponent(c.params.entity)), false);
    this.add('POST', '/api/taxonomy/classify', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('classification', this.ctxMap(c), actor);
      p.policy.enforce({ action: 'taxonomy.classify', actor, context: ctx });
      return p.taxonomy.classify(String(c.body.entity), actor, { schemes: c.body.schemes as string[] | undefined, taxa: c.body.taxa as string[] | undefined, context: ctx, inferred: c.body.inferred === true, confidence: c.body.confidence as number | undefined });
    });
    this.add('POST', '/api/taxonomy/assertions/:id/confirm', (c) => {
      const actor = this.need(c);
      p.policy.enforce({ action: 'taxonomy.confirm', actor, context: p.context.forPurpose('classification', {}, actor) });
      return p.taxonomy.confirm(c.params.id, actor);
    });
    this.add('POST', '/api/taxonomy/assertions/:id/withdraw', (c) => {
      const actor = this.need(c);
      p.policy.enforce({ action: 'taxonomy.withdraw', actor, context: p.context.forPurpose('classification', {}, actor) });
      return p.taxonomy.withdraw(c.params.id, String(c.body.reason ?? 'unstated'), actor);
    });

    // ── context & policy ──
    this.add('GET', '/api/context/dimensions', () => p.context.dimensions().map((d) => p.context.describe(d.id)), false);
    this.add('GET', '/api/context/purposes', () => p.context.purposes(), false);
    this.add('POST', '/api/context/resolve', (c) => {
      const actor = this.need(c);
      return p.context.resolve({ purpose: String(c.body.purpose ?? 'policy-evaluation'), contributions: p.context.contributionsFrom(this.ctxMap(c), actor), register: c.body.register === true }, actor);
    });
    this.add('GET', '/api/context/algebra', (c) => p.context.proveAlgebra(n(c.query.get('trials'), p.cfg.validation.contextMergePropertyTrials), n(c.query.get('seed'), p.cfg.validation.randomSeed)), false);
    this.add('POST', '/api/policy/evaluate', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('policy-evaluation', this.ctxMap(c), actor);
      return p.policy.evaluate({ action: String(c.body.action), subject: c.body.subject ? p.fabric.resolve(String(c.body.subject)).entry : null, actor, context: ctx, attributes: c.body.attributes as Record<string, unknown> | undefined });
    });

    // ── commerce ──
    this.add('GET', '/api/commerce/facets', () => p.commerce.facets(), false);
    this.add('POST', '/api/commerce/exchangeables', (c) => p.commerce.defineExchangeable(c.body as never, this.need(c)));
    this.add('POST', '/api/commerce/exchangeables/:id/list', (c) => p.commerce.list(c.params.id, this.need(c)));
    this.add('POST', '/api/commerce/bundles', (c) => p.commerce.composeBundle(c.body as never, this.need(c)));
    this.add('POST', '/api/commerce/offers', (c) => p.commerce.publishOffer(c.body as never, this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/offers/:id/withdraw', (c) => p.commerce.withdrawOffer(c.params.id, String(c.body.cause ?? 'withdrawn by issuer'), this.need(c)));
    this.add('POST', '/api/commerce/quote', (c) => p.commerce.quote(String(c.body.offer), this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/accept', (c) => p.commerce.accept(c.body as never, this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/check', (c) => p.commerce.checkEntitlement(c.body as never, this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/consume', (c) => p.commerce.consume(c.body as never, this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/transfer', (c) => p.commerce.transfer(c.body as never, this.need(c), this.ctxMap(c)));
    this.add('POST', '/api/commerce/entitlements/:id/:op', (c) => {
      const actor = this.need(c);
      const id = c.params.id;
      switch (c.params.op) {
        case 'suspend':
          return p.commerce.suspend(id, String(c.body.cause ?? 'suspended'), actor);
        case 'reinstate':
          return p.commerce.reinstate(id, actor);
        case 'renew':
          return p.commerce.renew(id, actor);
        case 'revoke':
          return { revoked: p.commerce.revoke(id, String(c.body.cause ?? 'revoked'), actor) };
        default:
          throw new ConstitutionalError('Phase006-§7', `unknown entitlement operation ${c.params.op}`);
      }
    });
    this.add('POST', '/api/commerce/sweep', (c) => p.commerce.sweep(this.need(c)));
    this.add('POST', '/api/entities', (c) => p.entities.create(c.body as never, this.need(c)));
    this.add('POST', '/api/attributes', (c) => {
      const actor = this.need(c);
      p.policy.enforce({ action: 'registry.submit', actor, context: p.context.forPurpose('governance', {}, actor) });
      return p.fabric.admitCertified({ kind: 'Attribute', namespace: (c.body.namespace as string) ?? 'UCOS', name: String(c.body.name), statement: String(c.body.statement ?? ''), content: { semanticType: c.body.semanticType, cardinality: c.body.cardinality ?? 'one', domain: c.body.domain ?? null, unit: c.body.unit ?? null }, labels: { [p.cfg.platform.defaultLocale]: String(c.body.name) }, provenance: { source: 'api' } }, p.governance.pipelineRoles((c.body.namespace as string) ?? 'UCOS'));
    });
    this.add('POST', '/api/policies', (c) => {
      const actor = this.need(c);
      p.policy.enforce({ action: 'registry.submit', actor, context: p.context.forPurpose('governance', {}, actor) });
      const e = p.fabric.admitCertified({ kind: 'Policy', namespace: (c.body.namespace as string) ?? 'UCOS', name: String(c.body.name), statement: String(c.body.statement ?? ''), content: { issuer: c.body.issuer ?? actor.authority, purpose: c.body.purpose, scope: c.body.scope ?? {}, contextConditions: c.body.contextConditions ?? [], rules: c.body.rules ?? [], modifiers: c.body.modifiers ?? [], taxRules: c.body.taxRules ?? [], entitlementConditions: c.body.entitlementConditions ?? [], dunning: c.body.dunning ?? null, riskRules: c.body.riskRules ?? [], governance: c.body.governance ?? [], autonomy: c.body.autonomy ?? [], effectiveFrom: c.body.effectiveFrom ?? p.clock.now(), effectiveTo: c.body.effectiveTo ?? null }, provenance: { source: 'api' } }, p.governance.pipelineRoles((c.body.namespace as string) ?? 'UCOS'));
      p.policy.invalidate();
      return e;
    });
    this.add('GET', '/api/units', (c) => p.measure.units(c.query.get('dimension') ?? undefined).map((u) => ({ id: u.canonicalId, symbol: u.content.symbol, name: u.definition.canonicalName, dimension: u.content.dimension, system: u.content.system })), false);
    this.add('POST', '/api/units/convert', (c) => p.measure.convert(Number(c.body.magnitude), String(c.body.from), String(c.body.to), c.actor ? p.context.forPurpose('measurement', this.ctxMap(c), c.actor) : undefined), false);
    this.add('POST', '/api/valuations/exchange-rate', (c) => {
      const actor = this.need(c);
      return p.measure.exchangeRate(c.body as never, actor, p.context.forPurpose('pricing', this.ctxMap(c), actor));
    });
    this.add('GET', '/api/ledger/balance', (c) => p.ledger.balance(String(c.query.get('holder')), String(c.query.get('unit')), c.query.get('namespace') ?? undefined), false);

    // ── compositions & capabilities ──
    this.add('GET', '/api/capabilities', () => p.fabric.query({ kind: 'Capability', limit: 1000 }).entries, false);
    this.add('GET', '/api/compositions', () => p.fabric.query({ kind: 'Composition', limit: 1000 }).entries, false);
    this.add('POST', '/api/compositions', (c) => p.composition.compose(c.body as never, this.need(c)));
    this.add('POST', '/api/compositions/:id/:op', (c) => {
      const actor = this.need(c);
      const id = decodeURIComponent(c.params.id);
      switch (c.params.op) {
        case 'validate':
          return p.composition.validate(id, actor);
        case 'certify':
          return p.composition.certify(id, actor);
        case 'instantiate':
          return p.composition.instantiate(id, (c.body.deployment as never) ?? { targets: p.generation.listTargets().map((t) => ({ generator: t.generator })) }, actor);
        case 'suspend':
          return p.composition.suspend(id, String(c.body.cause ?? 'governance action'), actor);
        case 'resume':
          return p.composition.resume(id, String(c.body.cause ?? 'governance action'), actor);
        default:
          throw new ConstitutionalError('Phase008-§9', `unknown composition operation ${c.params.op}`);
      }
    });
    this.add('GET', '/api/capabilities/discover', (c) => p.composition.discoverCapabilities(c.query.get('need') ?? '', n(c.query.get('limit'), 10)), false);
    this.add('POST', '/api/capabilities/:name/invoke', (c) => p.runtime.invoke({ composition: c.body.composition as string | undefined, capability: c.params.name, operation: String(c.body.operation), input: c.body.input as Record<string, unknown> | undefined, context: this.ctxMap(c) }, this.need(c)));

    // ── generation ──
    this.add('GET', '/api/generation/targets', () => p.generation.listTargets(), false);
    this.add('GET', '/api/generation/artifacts', (c) => p.fabric.query({ kind: 'GeneratedArtifact', status: c.query.get('status') ?? undefined, limit: n(c.query.get('limit'), 100) }), false);
    this.add('POST', '/api/generation/generate', (c) => p.generation.generate({ subject: String(c.body.subject), generator: String(c.body.generator), variant: c.body.variant as string | undefined }, this.need(c)));
    this.add('POST', '/api/generation/artifacts/:id/verify', (c) => p.generation.verify(c.params.id));
    this.add('POST', '/api/generation/artifacts/:id/regenerate', (c) => p.generation.regenerate(c.params.id, this.need(c)));
    this.add('GET', '/api/generation/artifacts/:id/reproduce', (c) => p.generation.reproduce(c.params.id), false);
    this.add('GET', '/api/generation/artifacts/:id/files/:path*', (c) => ({ __raw: p.generation.readFile(c.params.id, decodeURIComponent(c.params.path)), __type: MIME[extname(c.params.path)] ?? 'text/plain; charset=utf-8' }), false);

    // ── intelligence ──
    this.add('POST', '/api/intelligence/knowledge', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('discovery', this.ctxMap(c), actor);
      p.policy.enforce({ action: 'intelligence.assert', actor, context: ctx });
      return p.knowledge.assert(c.body as never, actor, ctx);
    });
    this.add('POST', '/api/intelligence/knowledge/:id/refute', (c) => p.knowledge.refute(c.params.id, String(c.body.reason), this.need(c), c.body.successor as string | undefined));
    this.add('POST', '/api/intelligence/infer', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('discovery', this.ctxMap(c), actor);
      p.policy.enforce({ action: 'intelligence.infer', actor, context: ctx });
      const out = p.reasoning.infer({ types: (c.body.types as string[]) ?? ['NARROWER-THAN', 'CLASSIFIED-AS', 'DISJOINT-WITH'], maxDepth: Number(c.body.maxDepth ?? 4), record: c.body.record === true }, actor, ctx);
      return { ...out, derived: out.derived.slice(0, Number(c.body.limit ?? 200)), total: out.derived.length };
    });
    this.add('GET', '/api/intelligence/inferences/:id/explain', (c) => p.reasoning.explain(c.params.id), false);
    this.add('GET', '/api/intelligence/contradictions', () => p.reasoning.contradictions(), false);
    this.add('POST', '/api/intelligence/recommend', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('recommendation', this.ctxMap(c), actor);
      p.policy.enforce({ action: 'intelligence.recommend', actor, context: ctx });
      return p.recommendation.recommend(c.body as never, actor, ctx);
    });
    this.add('POST', '/api/intelligence/match', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('recommendation', this.ctxMap(c), actor);
      return p.recommendation.matchOffers({ need: (c.body.need as Record<string, unknown>) ?? {}, purpose: String(c.body.purpose ?? 'fit'), limit: Number(c.body.limit ?? 10) }, actor, ctx);
    });
    this.add('POST', '/api/intelligence/models', (c) => p.optimization.registerModel(c.body as never, this.need(c)));
    this.add('POST', '/api/intelligence/objectives', (c) => p.optimization.registerObjective(c.body as never, this.need(c)));
    this.add('POST', '/api/intelligence/optimize', (c) => {
      const actor = this.need(c);
      const ctx = p.context.forPurpose('optimization', this.ctxMap(c), actor);
      p.policy.enforce({ action: 'intelligence.optimize', actor, context: ctx });
      return p.optimization.optimize(c.body as never, actor, ctx);
    });
    this.add('GET', '/api/intelligence/capabilities', () => p.fabric.query({ kind: 'IntelligenceCapability', limit: 100 }).entries, false);
    this.add('POST', '/api/intelligence/autonomy', (c) => {
      const actor = this.need(c);
      return p.autonomy.requestAutonomy(String(c.body.capability), actor, p.context.forPurpose('governance', this.ctxMap(c) ?? { Governance: { policies: [] } }, actor));
    });
    this.add('POST', '/api/intelligence/alignment', (c) => p.autonomy.recordAlignment(String(c.body.capability), (c.body.evidence as Record<string, unknown>) ?? {}, this.need(c)));
    this.add('POST', '/api/intelligence/escalate', (c) => {
      const actor = this.need(c);
      return p.autonomy.escalate(c.body as never, actor, p.context.forPurpose('governance', this.ctxMap(c) ?? { Governance: { policies: [] } }, actor));
    });
    this.add('POST', '/api/intelligence/propose-amendment', (c) => {
      const actor = this.need(c);
      return p.autonomy.proposeAmendment(c.body as never, actor, p.context.forPurpose('governance', this.ctxMap(c) ?? { Governance: { policies: [] } }, actor));
    });
    this.add('POST', '/api/intelligence/amend-policy', (c) => {
      const actor = this.need(c);
      return p.autonomy.amendPolicy(c.body as never, actor, p.context.forPurpose('governance', { Governance: { policies: [] } }, actor));
    });

    // ── validation, coverage, events ──
    this.add('GET', '/api/validation/audit', (c) => {
      if (!this.auditCache || c.query.get('refresh') === '1' || Date.now() - this.auditCache.at > 300_000) this.auditCache = { at: Date.now(), report: p.validation.audit({ deep: true }) };
      return this.auditCache.report;
    }, false);
    this.add('GET', '/api/coverage', () => {
      const bySource = p.store.db.prepare('SELECT source, status, COUNT(*) n FROM corpus_coverage GROUP BY source, status ORDER BY source').all();
      return { summary: p.coverageSummary(), bySource };
    }, false);
    this.add('GET', '/api/coverage/headings', (c) => p.store.db.prepare(`SELECT * FROM corpus_coverage ${c.query.get('source') ? 'WHERE source = ?' : ''} ORDER BY source, line LIMIT ? OFFSET ?`).all(...[c.query.get('source')].filter((x): x is string => !!x), n(c.query.get('limit'), 200), n(c.query.get('offset'), 0)), false);
    this.add('GET', '/api/findings', (c) => p.store.db.prepare(`SELECT * FROM corpus_findings ${c.query.get('severity') ? 'WHERE severity = ?' : ''} ORDER BY severity, rule, source, line LIMIT ?`).all(...[c.query.get('severity')].filter((x): x is string => !!x), n(c.query.get('limit'), 500)), false);
    this.add('GET', '/api/events', (c) => p.bus.query({ subject: c.query.get('subject') ?? undefined, type: c.query.get('type') ?? undefined, afterSeq: c.query.get('after') ? Number(c.query.get('after')) : undefined, limit: n(c.query.get('limit'), 100) }), false);
  }

  private async body(req: IncomingMessage): Promise<Record<string, unknown>> {
    if (req.method === 'GET' || req.method === 'HEAD') return {};
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > this.p.cfg.server.maxBodyBytes) throw new ConstitutionalError('HTTP-413', 'request body too large', undefined, 413);
      chunks.push(chunk as Buffer);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new ConstitutionalError('HTTP-400', 'request body is not valid JSON', undefined, 400);
    }
  }

  private send(res: ServerResponse, status: number, value: unknown): void {
    if (value && typeof value === 'object' && '__raw' in (value as Record<string, unknown>)) {
      const v = value as { __raw: string; __type: string };
      res.writeHead(status, { 'content-type': v.__type });
      res.end(v.__raw);
      return;
    }
    const json = JSON.stringify(value ?? null);
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(json);
  }

  private serveStatic(res: ServerResponse, pathname: string): boolean {
    const root = platformPath(this.p.cfg.paths.uiRoot);
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = normalize(join(root, rel));
    if (!file.startsWith(root) || !existsSync(file)) return false;
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
    return true;
  }

  private stream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(': connected\n\n');
    const unsubscribe = this.p.bus.subscribe((e) => res.write(`event: platform\ndata: ${JSON.stringify(e)}\n\n`));
    const beat = setInterval(() => res.write(': heartbeat\n\n'), this.p.cfg.server.eventStreamHeartbeatMs);
    req.on('close', () => {
      clearInterval(beat);
      unsubscribe();
    });
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/api/events/stream') return this.stream(req, res);
      const route = this.routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) {
        if (req.method === 'GET' && !url.pathname.startsWith('/api/') && this.serveStatic(res, url.pathname)) return;
        if (req.method === 'GET' && !url.pathname.startsWith('/api/') && this.serveStatic(res, '/')) return;
        return this.send(res, 404, { error: 'NotFound', message: `no route ${req.method} ${url.pathname}` });
      }
      const m = route.pattern.exec(url.pathname)!;
      const params = Object.fromEntries(route.keys.map((k, i) => [k, m[i + 1]]));
      const actor = this.actorFor(req);
      if (route.auth && !actor) throw new AuthorizationError('UCI-006', 'this operation requires an accountable principal (Authorization: Bearer <token>)');
      const body = await this.body(req);
      const out = await route.handler({ req, res, params, query: url.searchParams, body, actor });
      this.send(res, 200, out);
    } catch (err) {
      if (err instanceof ConstitutionalError) return this.send(res, err.status, err.toJSON());
      this.send(res, 500, { error: 'InternalError', message: (err as Error).message });
    }
  }
}

export async function serve(p: Platform, log: (m: string) => void): Promise<void> {
  const api = new ApiServer(p);
  p.autonomy.start();
  const server = createServer((req, res) => void api.handle(req, res));
  await new Promise<void>((resolve) => server.listen(p.cfg.server.port, p.cfg.server.host, resolve));
  log(`UCOS Ω∞ listening on http://${p.cfg.server.host}:${p.cfg.server.port} — credentials in ${p.cfg.paths.credentials}`);
  const shutdown = () => {
    server.close();
    p.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
