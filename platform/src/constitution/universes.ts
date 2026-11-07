import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry, RegistryDefinition } from '../registry/types.ts';
import { ConstitutionalError } from '../kernel/errors.ts';

type Roles = { author: Actor; ratifiers: Actor[]; certifier: Actor };

interface Template {
  nameTemplate: string;
  ownerTemplate: string;
  envelopeText: string;
  kinds: string[];
  entryModel: string;
  construct: string;
  identity: { layer: string; type: string };
  registryIdentity: { layer: string; type: string };
  tier: number;
  lifecycleRef: string;
  admissionMode: 'constitutional' | 'operational';
  relationshipPolicy: string[];
}

/**
 * Universes and operating domains (Phase 001 §4 Tier-3, Phase 004 §6.3).
 * Admitting a universe costs a registration, not a redesign: its namespace,
 * its Domain Authority and its one canonical registry are all registered
 * artifacts created here from registered templates.
 */
export class UniverseService {
  private readonly p: Platform;

  constructor(p: Platform) {
    this.p = p;
  }

  private fill(t: string, code: string): string {
    return t.replace(/\{code\}/g, code);
  }

  /** Registers a universe: Universe entry, namespace, Domain Authority, universe registry. */
  register(input: { code: string; name: string; statement: string; source: string; locator?: string; namespaceKind?: 'universe' | 'operational' }, roles: Roles): Entry | null {
    const code = input.code;
    const kind = input.namespaceKind ?? 'universe';
    if (!/^[A-Z][A-Z0-9]{1,15}$/.test(code)) throw new ConstitutionalError('V-FR-01', `namespace code ${code} does not match the identification scheme`);
    const alias = kind === 'universe' ? `UNI:${code}` : `NS:${code}`;
    const existing = this.p.fabric.tryResolve(alias);
    if (existing) return existing.entry;
    return this.p.store.tx(() => {
      const gov = this.p.governance.meta;
      const bodyTemplate = kind === 'universe' ? gov.universeDomainAuthority : gov.operationalDomainAuthority;
      const universe = this.p.fabric.admitCertified(
        {
          kind: kind === 'universe' ? 'Universe' : 'Namespace',
          namespace: 'UCOS',
          name: input.name,
          statement: input.statement,
          aliases: [alias],
          content: { code, namespaceKind: kind },
          labels: { [this.p.cfg.platform.defaultLocale]: input.name },
          descriptors: [code, input.name],
          provenance: { source: input.source, locator: input.locator },
        },
        roles,
        kind === 'universe' ? 'UNIVERSE' : 'NAMESPACE',
      );
      this.p.fabric.registerNamespace(code, kind);
      const bodyName = this.fill(bodyTemplate.nameTemplate, code);
      if (!this.p.governance.hasBody(bodyName)) {
        const body = this.p.fabric.admitCertified(
          {
            kind: 'GovernanceBody',
            name: bodyName,
            statement: `The authority that ratifies the canonical content of ${code} within its envelope.`,
            aliases: [`GOV:${code}`],
            content: { namespace: code, quorum: bodyTemplate.quorum, authorityRank: bodyTemplate.authorityRank, parentBody: bodyTemplate.parentBody, ratifies: [`${code} content within envelope`], mayCertify: false },
            provenance: { source: 'governance', locator: 'metadata/governance.json' },
            relationships: [{ type: 'REFERENCES', target: universe.canonicalId, context: { role: 'envelope' } }],
          },
          roles,
          'GOVERNANCE',
        );
        this.p.governance.cacheBody(body);
      }
      // The root universe's canonical truth lives in the foundational registries.
      if (kind === 'universe' && code !== 'UCOS') this.registerUniverseRegistry(code, universe, roles);
      this.p.bus.emit({ type: 'reg.envelope.widened', subject: universe.canonicalId, actor: roles.author, payload: { code, namespaceKind: kind } });
      return this.p.fabric.require(universe.canonicalId);
    });
  }

  private registerUniverseRegistry(code: string, universe: Entry, roles: Roles): void {
    const t = this.p.sources.metadata<{ universeRegistryTemplate: Template }>('registries.json').universeRegistryTemplate;
    const registryId = this.p.fabric.mint.format(t.registryIdentity.layer, this.fill(t.registryIdentity.type, code), 1);
    if (this.p.fabric.hasRegistry(registryId)) return;
    const def: RegistryDefinition = {
      registryId,
      name: this.fill(t.nameTemplate, code),
      owner: this.fill(t.ownerTemplate, code),
      envelope: { kinds: t.kinds, namespaces: [code] },
      entryModel: t.entryModel,
      lifecycleRef: t.lifecycleRef,
      admissionMode: t.admissionMode,
      relationshipPolicy: t.relationshipPolicy,
      identity: { layer: t.identity.layer, type: this.fill(t.identity.type, code) },
      construct: t.construct,
      tier: t.tier,
      securityDefault: 'PUBLIC',
      status: 'CERTIFIED',
    };
    this.p.fabric.defineRegistryInMemory(def);
    this.p.fabric.admitCertified(
      {
        kind: 'Registry',
        canonicalId: registryId,
        name: def.name,
        statement: this.fill(t.envelopeText, code),
        content: { definition: def },
        provenance: { source: 'registry-fabric', locator: 'metadata/registries.json#universeRegistryTemplate' },
        relationships: [{ type: 'REFERENCES', target: universe.canonicalId, context: { role: 'universe' } }],
      },
      roles,
      'REGISTRY',
    );
  }

  list(kind: 'universe' | 'operational' | 'all' = 'all'): Entry[] {
    const kinds = kind === 'universe' ? ['Universe'] : kind === 'operational' ? ['Namespace'] : ['Universe', 'Namespace'];
    return this.p.fabric.query({ kind: kinds, limit: 10_000 }).entries;
  }

  /** Registers an operating domain (tenant) — an operational namespace with its Operating Authority. */
  registerOperational(input: { code: string; name: string; statement: string }, actor: Actor): Entry {
    const ctx = this.p.context.forPurpose('governance', { Governance: { policies: [] } }, actor);
    this.p.policy.enforce({ action: 'namespace.register', actor, context: ctx });
    const e = this.register({ ...input, source: 'api', namespaceKind: 'operational' }, this.p.governance.pipelineRoles());
    if (!e) throw new ConstitutionalError('UCI-016', `operational namespace ${input.code} could not be registered`);
    return e;
  }
}
