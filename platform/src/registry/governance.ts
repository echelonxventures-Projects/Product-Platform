import type { Entry, RegistryDefinition } from './types.ts';
import type { GovernancePort, RegistryFabric } from './fabric.ts';
import type { Actor } from '../kernel/events.ts';
import { AuthorizationError, ConstitutionalError, NotFoundError } from '../kernel/errors.ts';
import { sha256 } from '../kernel/hash.ts';

export interface GovernanceMetadata {
  bodies: Record<string, { alias: string; quorum: number; authorityRank: number; role: string }>;
  ratificationByTier: Record<string, string>;
  certifyingBody: string;
  registryOffice: string;
  universeDomainAuthority: { nameTemplate: string; quorum: number; authorityRank: number; parentBody: string };
  operationalDomainAuthority: { nameTemplate: string; quorum: number; authorityRank: number; parentBody: string };
  principals: { alias: string; name: string; principalKind: string; bodies: string[] }[];
}

export interface BodyRecord {
  canonicalId: string;
  name: string;
  quorum: number;
  authorityRank: number;
  mayCertify: boolean;
  mayRatify: boolean;
  namespace: string | null;
  parentBody: string | null;
}

export interface PrincipalRecord {
  canonicalId: string;
  alias: string;
  name: string;
  principalKind: string;
  bodies: string[];
  tokenHash: string | null;
  status: string;
}

/**
 * Governance graph (Phase 001 §7, Master Index §6). Bodies and principals are
 * registered artifacts; this class caches them and enforces the separation
 * invariants GI-1..GI-5 structurally — a principal cannot be placed where
 * separation would be violated, so no later check can be bypassed.
 */
export class Governance implements GovernancePort {
  private readonly fabric: RegistryFabric;
  readonly meta: GovernanceMetadata;
  private readonly bodiesByName = new Map<string, BodyRecord>();
  private readonly principals = new Map<string, PrincipalRecord>();
  private readonly tokenIndex = new Map<string, string>();

  constructor(fabric: RegistryFabric, meta: GovernanceMetadata) {
    this.fabric = fabric;
    this.meta = meta;
  }

  hydrate(): void {
    this.bodiesByName.clear();
    this.principals.clear();
    this.tokenIndex.clear();
    for (const e of this.fabric.iterate('GovernanceBody')) this.cacheBody(e);
    for (const e of this.fabric.iterate('Principal')) this.cachePrincipal(e);
  }

  cacheBody(e: Entry): void {
    const c = e.content as Record<string, unknown>;
    this.bodiesByName.set(e.definition.canonicalName, {
      canonicalId: e.canonicalId,
      name: e.definition.canonicalName,
      quorum: Number(c.quorum ?? 1),
      authorityRank: Number(c.authorityRank ?? 0),
      mayCertify: c.mayCertify === true,
      mayRatify: Array.isArray(c.ratifies) ? (c.ratifies as unknown[]).length > 0 : c.mayRatify === true,
      namespace: (c.namespace as string) ?? null,
      parentBody: (c.parentBody as string) ?? null,
    });
  }

  cachePrincipal(e: Entry): void {
    const c = e.content as Record<string, unknown>;
    const rec: PrincipalRecord = {
      canonicalId: e.canonicalId,
      alias: e.identity.aliases[0] ?? e.canonicalId,
      name: e.definition.canonicalName,
      principalKind: String(c.principalKind ?? 'human'),
      bodies: (c.bodies as string[]) ?? [],
      tokenHash: (c.tokenHash as string) ?? null,
      status: e.lifecycle.status,
    };
    this.principals.set(e.canonicalId, rec);
    if (rec.tokenHash) this.tokenIndex.set(rec.tokenHash, e.canonicalId);
  }

  body(name: string): BodyRecord {
    const b = this.bodiesByName.get(name);
    if (!b) throw new NotFoundError('governance body', name);
    return b;
  }

  hasBody(name: string): boolean {
    return this.bodiesByName.has(name);
  }

  bodies(): BodyRecord[] {
    return [...this.bodiesByName.values()];
  }

  principal(id: string): PrincipalRecord {
    const direct = this.principals.get(id);
    if (direct) return direct;
    for (const p of this.principals.values()) if (p.alias === id) return p;
    throw new NotFoundError('principal', id);
  }

  principalList(): PrincipalRecord[] {
    return [...this.principals.values()];
  }

  authenticate(token: string, algorithm: string): PrincipalRecord | undefined {
    const id = this.tokenIndex.get(sha256(token, algorithm));
    const p = id ? this.principals.get(id) : undefined;
    return p && p.status !== 'RETIRED' && p.status !== 'REVOKED' ? p : undefined;
  }

  /** Builds an Actor for a principal acting under one of its bodies (or itself). */
  actor(principalRef: string, authority?: string, extra: Partial<Actor> = {}): Actor {
    const p = this.principal(principalRef);
    const auth = authority ?? p.bodies[0] ?? p.canonicalId;
    if (authority && authority !== p.canonicalId && !p.bodies.includes(authority) && !this.isDelegatedAuthority(p, authority)) {
      throw new AuthorizationError('UCI-006', `${p.alias} does not act under authority ${authority}`);
    }
    return { principal: p.canonicalId, authority: auth, autonomous: p.principalKind === 'agent', ...extra };
  }

  private isDelegatedAuthority(p: PrincipalRecord, authority: string): boolean {
    const b = this.bodiesByName.get(authority);
    return !!b && !!b.parentBody && p.bodies.includes(b.parentBody);
  }

  membersOf(body: string): PrincipalRecord[] {
    return [...this.principals.values()].filter((p) => this.isMember(p.canonicalId, body));
  }

  // ── GovernancePort ───────────────────────────────────────────────────────

  ratifyingBodyFor(tier: number | null, namespace: string, _registry: RegistryDefinition): string {
    const byTier = tier !== null ? this.meta.ratificationByTier[String(tier)] : undefined;
    if (byTier) return byTier;
    for (const b of this.bodiesByName.values()) if (b.namespace === namespace) return b.name;
    return this.meta.ratificationByTier.default;
  }

  certifyingBody(): string {
    return this.meta.certifyingBody;
  }

  registryOffice(): string {
    return this.meta.registryOffice;
  }

  isMember(principal: string, body: string): boolean {
    const p = this.principals.get(principal);
    if (!p) return false;
    if (p.bodies.includes(body)) return true;
    const b = this.bodiesByName.get(body);
    return !!b?.parentBody && p.bodies.includes(b.parentBody);
  }

  quorumOf(body: string): number {
    return this.body(body).quorum;
  }

  authorityRank(authority: string): number {
    const b = this.bodiesByName.get(authority);
    if (b) return b.authorityRank;
    for (const body of this.bodiesByName.values()) if (body.canonicalId === authority) return body.authorityRank;
    return 0;
  }

  assertSeparation(entry: Entry, principal: string, act: 'author' | 'ratify' | 'certify' | 'record'): void {
    if (principal === entry.canonicalId) throw new ConstitutionalError('GI-4', `${entry.canonicalId} cannot act upon itself`);
    const ratifiers = new Set((entry.evidence.ratification?.approvals ?? []).map((a) => a.principal));
    if (act === 'certify') {
      if (ratifiers.has(principal)) throw new ConstitutionalError('GI-1', `${principal} ratified ${entry.canonicalId} and may not certify it`);
      if (entry.provenance.recordedBy === principal) throw new ConstitutionalError('GI-2', `${principal} authored ${entry.canonicalId} and may not certify it`);
      const p = this.principals.get(principal);
      if (p?.principalKind === 'agent') throw new ConstitutionalError('IN-A3', `autonomous principal ${principal} may not certify`);
    }
    if (act === 'ratify') {
      if (this.isMember(principal, this.meta.registryOffice)) throw new ConstitutionalError('GI-3', `recorder ${principal} may not ratify`);
      if (entry.evidence.certification?.certifier === principal) throw new ConstitutionalError('GI-1', `${principal} certified ${entry.canonicalId} and may not ratify it`);
      const p = this.principals.get(principal);
      if (p?.principalKind === 'agent') throw new ConstitutionalError('IN-A2', `autonomous principal ${principal} may not ratify`);
    }
  }

  /**
   * Membership admission check: a principal may never hold both a ratifying
   * membership and a certifying one, nor a recording one and a ratifying one
   * (GI-1, GI-3). Checked when the principal is registered or amended.
   */
  membershipViolations(bodies: string[]): string[] {
    const out: string[] = [];
    const certifies = bodies.includes(this.meta.certifyingBody);
    const records = bodies.includes(this.meta.registryOffice);
    const ratifies = bodies.some((b) => b !== this.meta.certifyingBody && b !== this.meta.registryOffice);
    if (certifies && ratifies) out.push('GI-1 a certifier may not hold a ratifying membership');
    if (records && ratifies) out.push('GI-3 a recorder may not hold a ratifying membership');
    if (certifies && records) out.push('GI-2 a certifier may not hold the recording function');
    for (const b of bodies) if (!this.bodiesByName.has(b)) out.push(`body ${b} is not registered`);
    return out;
  }

  /** The three distinct roles needed to take an artifact through the pipeline. */
  pipelineRoles(namespace = 'UCOS'): { author: Actor; ratifiers: Actor[]; certifier: Actor } {
    const pick = (body: string) => this.membersOf(body).filter((p) => p.status !== 'RETIRED');
    const registrar = pick(this.meta.registryOffice)[0];
    const certifier = pick(this.meta.certifyingBody)[0];
    if (!registrar || !certifier) throw new ConstitutionalError('GI-1', 'governance is not bootstrapped: registrar and certifier required');
    const ratifierBodies = new Set<string>([this.meta.ratificationByTier['0'], this.meta.ratificationByTier['1'], this.meta.ratificationByTier['2'], this.meta.ratificationByTier.default]);
    for (const b of this.bodiesByName.values()) if (b.namespace === namespace) ratifierBodies.add(b.name);
    const ratifiers = new Map<string, Actor>();
    for (const body of ratifierBodies) for (const p of pick(body)) if (!ratifiers.has(p.canonicalId)) ratifiers.set(p.canonicalId, { principal: p.canonicalId, authority: body });
    return {
      author: { principal: registrar.canonicalId, authority: this.meta.registryOffice },
      ratifiers: [...ratifiers.values()],
      certifier: { principal: certifier.canonicalId, authority: this.meta.certifyingBody },
    };
  }
}
