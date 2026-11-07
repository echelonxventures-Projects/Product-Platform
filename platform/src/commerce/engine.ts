import type { Platform } from '../platform.ts';
import type { Actor } from '../kernel/events.ts';
import type { Entry } from '../registry/types.ts';
import type { ResolvedContext } from '../context/engine.ts';
import type { Violation } from '../kernel/errors.ts';
import { ConstitutionalError } from '../kernel/errors.ts';
import { evaluateBoolean } from '../rules/expression.ts';
import { overlaps, type Interval } from '../kernel/clock.ts';

export interface EntitlementSpec {
  form: string;
  capability: string;
  duration?: { magnitude: number; unit: string };
  window?: Interval;
  quantity?: number;
  spatial?: string[];
  conditions?: { kind: string; statement: string; expression?: string }[];
  renewable?: boolean;
}

export interface OfferInput {
  subject: string;
  name?: string;
  entitlementSpec: EntitlementSpec;
  consideration: { magnitude: number; unit: string; purpose?: string; basis?: string; contextConditions?: string[] }[];
  eligibility?: string[];
  validity: { window: Interval; regions?: string[]; contextConditions?: string[] };
  stackingPolicy?: 'best-of' | 'additive' | 'exclusive';
  allocationPolicy?: { mechanism: 'first-come' | 'priority' | 'ascending-bid' | 'lottery'; capacity?: number | null; perWindowCapacity?: number | null };
  policies?: string[];
  promotionPolicies?: string[];
  namespace?: string;
}

export interface Quote {
  offer: string;
  quoteId: string;
  context: Record<string, unknown>;
  lines: { magnitude: number; unit: string; basis: string | null; valuer: string; purpose: string; sourceValue: string; converted?: { from: string; path: string[] } }[];
  adjustments: { policy: string; description: string; delta: number; unit: string }[];
  taxes: { policy: string; description: string; ratePercent: number; amount: number; unit: string }[];
  total: { magnitude: number; unit: string } | null;
  entitlementConditions: { kind: string; statement: string; source: string }[];
  validUntil: string | null;
}

const SCALAR_PRICE_KEYS = /^(price|amount|cost|fee|rate|charge|tariff)$/i;

/**
 * Universal Service Product Taxonomy (Phase 006). Four nodes — Entity,
 * Exchangeable Entity, Offer, Entitlement — and seven registered facets.
 * Product, service, subscription, booking… are roles assigned by the
 * Taxonomy Engine from facet bindings; this engine never branches on them.
 */
export class CommerceEngine {
  private readonly p: Platform;
  private facetIndex = new Map<string, { id: string; alias: string; name: string; domain: string[] }>();

  constructor(p: Platform) {
    this.p = p;
  }

  install(): void {
    this.p.validation.registerKind('ExchangeableEntity', (e) => this.validateExchangeable(e));
    this.p.validation.registerKind('Offer', (e) => this.validateOffer(e));
    this.p.validation.registerKind('Entitlement', (e) => this.validateEntitlement(e));
    this.p.lifecycles.addFactProvider((entry, to) => this.lifecycleFacts(entry, to));
  }

  hydrate(): void {
    this.facetIndex.clear();
    for (const f of this.p.fabric.iterate('Facet')) {
      const rec = { id: f.canonicalId, alias: String(f.content.alias), name: f.definition.canonicalName, domain: (f.content.domain as string[]) ?? [] };
      this.facetIndex.set(rec.alias.toLowerCase(), rec);
      this.facetIndex.set(rec.name.toLowerCase(), rec);
      this.facetIndex.set(rec.id, rec);
    }
  }

  facets(): { id: string; alias: string; name: string; domain: string[] }[] {
    return [...new Set(this.facetIndex.values())].sort((a, b) => a.alias.localeCompare(b.alias, undefined, { numeric: true }));
  }

  /** Scope for rule evaluation: each binding readable by facet alias and by facet name. */
  facetScope(bindings: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(bindings)) {
      const f = this.facetIndex.get(k.toLowerCase()) ?? this.facetIndex.get(k);
      if (f) {
        out[f.alias] = v;
        out[f.name.replace(/\s+/g, '')] = v;
      } else out[k] = v;
    }
    return out;
  }

  private normaliseFacets(bindings: Record<string, string>): { normalised: Record<string, string>; violations: Violation[] } {
    const normalised: Record<string, string> = {};
    const violations: Violation[] = [];
    for (const [k, v] of Object.entries(bindings ?? {})) {
      const f = this.facetIndex.get(k.toLowerCase()) ?? this.facetIndex.get(k);
      if (!f) {
        violations.push({ rule: 'V-US-01', message: `facet ${k} is not registered` });
        continue;
      }
      if (!f.domain.includes(v)) violations.push({ rule: 'V-US-01', message: `${f.alias} ${f.name}: "${v}" is outside the governed domain (${f.domain.join(', ')})` });
      normalised[f.alias] = v;
    }
    return { normalised, violations };
  }

  // ── validators (V-US-01..09) ────────────────────────────────────────────

  private validateExchangeable(e: Entry): Violation[] {
    const c = e.content as Record<string, unknown>;
    const out: Violation[] = [];
    const bindings = (c.facetBindings as Record<string, string>) ?? {};
    if (!c.composite) out.push(...this.normaliseFacets(bindings).violations);
    for (const rule of this.p.facetAdmissibilityRules()) {
      try {
        if (!evaluateBoolean(rule.expression, { scope: this.facetScope(bindings) })) out.push({ rule: 'V-US-02', message: `facet binding inadmissible: ${rule.statement}` });
      } catch (err) {
        out.push({ rule: 'V-US-02', message: `admissibility rule unevaluable: ${(err as Error).message}` });
      }
    }
    const scalar = Object.keys(c).filter((k) => SCALAR_PRICE_KEYS.test(k) && typeof c[k] === 'number');
    const attrScalar = Object.keys((c.attributes as Record<string, unknown>) ?? {}).filter((k) => SCALAR_PRICE_KEYS.test(k));
    if (scalar.length || attrScalar.length) out.push({ rule: 'V-US-05', message: `scalar price field(s) ${[...scalar, ...attrScalar].join(', ')} — consideration is a Value relationship on an Offer, never a field` });
    if (!c.entityRef && !c.composite) out.push({ rule: 'Phase006-§4.1', message: 'an exchangeable entity is about an underlying entity (entityRef)' });
    for (const m of (c.members as string[]) ?? []) if (!this.p.fabric.exists(m)) out.push({ rule: 'V-US-08', message: `bundle member ${m} does not resolve` });
    return out;
  }

  private validateOffer(e: Entry): Violation[] {
    const c = e.content as Record<string, unknown>;
    const out: Violation[] = [];
    const cons = (c.consideration as string[]) ?? [];
    if (!cons.length) out.push({ rule: 'V-US-04', message: 'an offer states its consideration as Value relationships' });
    const validity = c.validity as { window?: Interval } | undefined;
    if (!validity?.window?.start) out.push({ rule: 'V-US-06', message: 'offer validity is a temporal/spatial/contextual window' });
    if (!c.issuer) out.push({ rule: 'UCI-006', message: 'an offer requires an issuing authority' });
    const spec = c.entitlementSpec as EntitlementSpec | undefined;
    if (!spec?.form || !spec.capability) out.push({ rule: 'V-US-07', message: 'entitlementSpec states the entitlement form and capability' });
    else if (!spec.duration && !spec.window && spec.quantity === undefined) out.push({ rule: 'V-US-07', message: 'entitlement bounds must be stated; unbounded entitlements are inadmissible' });
    for (const expr of (c.eligibility as string[]) ?? []) {
      try {
        evaluateBoolean(expr, { scope: {} });
      } catch (err) {
        out.push({ rule: 'V-RU-01', message: `eligibility rule: ${(err as Error).message}` });
      }
    }
    return out;
  }

  private validateEntitlement(e: Entry): Violation[] {
    const c = e.content as Record<string, unknown>;
    const b = c.bounds as { temporal?: Interval; quantitative?: number | null } | undefined;
    const out: Violation[] = [];
    if (!b || (!b.temporal && (b.quantitative === undefined || b.quantitative === null))) out.push({ rule: 'V-US-07', message: 'entitlement bounds are stated; unbounded entitlements are inadmissible' });
    if (!c.holder || !c.grantor) out.push({ rule: 'Phase006-§4.6', message: 'an entitlement names grantor and holder' });
    if (!c.evidence) out.push({ rule: 'X-US-04', message: 'an entitlement carries its authorising evidence' });
    return out;
  }

  /** Facts computed for commerce lifecycle guards. */
  private lifecycleFacts(entry: Entry, _to: string): Record<string, unknown> {
    const c = entry.content as Record<string, unknown>;
    const now = this.p.clock.now();
    if (entry.kind === 'ExchangeableEntity') {
      const roles = this.p.taxonomy.effectiveAssertions(entry.canonicalId).map((a) => a.content.taxonName);
      const activeOffers = this.p.store.edgesTo(entry.canonicalId, 'OFFERS').filter((e) => this.p.fabric.get(e.source)?.lifecycle.status === 'ACTIVE').length;
      const liveEntitlements = this.p.fabric.query({ kind: 'Entitlement', status: ['GRANTED', 'ACTIVE', 'SUSPENDED', 'RENEWED'], contentPath: 'subjectRef', contentEquals: entry.canonicalId, limit: 1 }).total;
      return { facetsBound: Object.keys((c.facetBindings as object) ?? {}).length > 0 || c.composite === true, roles, activeOffers, liveEntitlements };
    }
    if (entry.kind === 'Offer') {
      const w = (c.validity as { window: Interval }).window;
      const granted = this.grantedQuantity(entry.canonicalId);
      const capacity = (c.allocationPolicy as { capacity?: number | null } | undefined)?.capacity;
      return {
        considerationEvidenced: ((c.consideration as string[]) ?? []).every((v) => this.p.fabric.exists(v)),
        contextResolvable: true,
        validityOpen: Date.parse(w.start) <= Date.parse(now) && (w.end === null || Date.parse(now) < Date.parse(w.end)),
        validityClosed: w.end !== null && Date.parse(now) >= Date.parse(w.end),
        remaining: capacity === null || capacity === undefined ? Infinity : capacity - granted,
      };
    }
    if (entry.kind === 'Entitlement') {
      const b = c.bounds as { temporal?: Interval; quantitative?: number | null };
      const usage = Number(c.usage ?? 0);
      return {
        boundsStated: !!b && (!!b.temporal || (b.quantitative !== undefined && b.quantitative !== null)),
        boundsElapsed: (!!b?.temporal?.end && Date.parse(now) >= Date.parse(b.temporal.end)) || (b?.quantitative !== null && b?.quantitative !== undefined && usage >= b.quantitative),
        renewable: c.renewable === true,
        conditionsMet: this.conditionsMet(entry),
        transferAdmissible: c.transferAdmissible === true,
      };
    }
    return {};
  }

  // ── Exchangeable entities ───────────────────────────────────────────────

  /**
   * DEFINE-EXCHANGEABLE(entity, facets) → validated, classified artifact.
   * The underlying entity is referenced (entityRef), never conflated with the
   * exchangeable form: one room, many exchangeable forms (Phase 006 §4.1).
   */
  defineExchangeable(
    input: { name: string; statement?: string; entityRef?: string; entity?: { name: string; statement?: string; attributes?: Record<string, unknown> }; facets: Record<string, string>; capabilities?: string[]; attributes?: Record<string, unknown>; knowledge?: string[]; policies?: string[]; namespace?: string; context?: Record<string, Record<string, unknown>> },
    actor: Actor,
  ): { exchangeable: Entry; roles: string[] } {
    return this.p.store.tx(() => {
      const ns = input.namespace ?? this.p.operationalNamespace();
      const ctx = this.p.context.forPurpose('classification', input.context, actor);
      let entityRef = input.entityRef ? this.p.fabric.resolve(input.entityRef).entry.canonicalId : undefined;
      if (!entityRef) {
        if (!input.entity) throw new ConstitutionalError('Phase006-§4.1', 'provide entityRef or an entity to describe');
        const ent = this.p.entities.create({ name: input.entity.name, statement: input.entity.statement ?? '', attributes: input.entity.attributes ?? {}, namespace: ns }, actor);
        entityRef = ent.canonicalId;
      }
      const { normalised, violations } = this.normaliseFacets(input.facets);
      if (violations.length) throw new ConstitutionalError(violations[0].rule, violations.map((v) => v.message).join('; '), violations);
      const x = this.p.fabric.submit(
        {
          kind: 'ExchangeableEntity',
          namespace: ns,
          name: input.name,
          statement: input.statement ?? '',
          content: { entityRef, facetBindings: normalised, capabilities: input.capabilities ?? [], attributes: input.attributes ?? {}, knowledge: input.knowledge ?? [], policies: input.policies ?? [], context: ctx.record },
          labels: { [this.p.cfg.platform.defaultLocale]: input.name },
          provenance: { source: 'commerce-engine' },
          relationships: [{ type: 'ABOUT', target: entityRef }, ...(input.policies ?? []).map((pol) => ({ type: 'GOVERNED-BY', target: pol }))],
        },
        actor,
      );
      this.p.fabric.transition(x.canonicalId, 'DEFINED', actor);
      const roles = this.classifyRoles(x.canonicalId, actor, ctx);
      this.p.bus.emit({ type: 'us.exchangeable.classified', subject: x.canonicalId, actor, payload: { roles }, context: ctx.record });
      return { exchangeable: this.p.fabric.require(x.canonicalId), roles };
    });
  }

  /** CLASSIFY-ROLE: commerce roles by admission rule over facets (never by branching). */
  classifyRoles(exchangeableId: string, actor: Actor, ctx?: ResolvedContext): string[] {
    const schemes = this.p.commerceSchemes();
    const res = this.p.taxonomy.classify(exchangeableId, actor, { schemes, context: ctx });
    const roles = this.p.taxonomy.effectiveAssertions(exchangeableId).map((a) => String(a.content.taxonName));
    const x = this.p.fabric.require(exchangeableId);
    if (roles.length && x.lifecycle.status === 'DEFINED') this.p.fabric.transition(exchangeableId, 'CLASSIFIED', actor);
    if (res.assertions.length && x.lifecycle.status !== 'DEFINED') this.p.bus.emit({ type: 'us.exchangeable.reclassified', subject: exchangeableId, actor, payload: { roles } });
    return roles;
  }

  list(exchangeableId: string, actor: Actor): Entry {
    return this.p.fabric.transition(exchangeableId, 'LISTED', actor);
  }

  /** COMPOSE-BUNDLE: PART-OF composition + one offer over the whole (Phase 006 §4.5). */
  composeBundle(input: { name: string; members: string[]; namespace?: string; offer?: Omit<OfferInput, 'subject'> }, actor: Actor): { bundle: Entry; roles: string[]; offer?: Entry } {
    return this.p.store.tx(() => {
      if (input.members.length < 2) throw new ConstitutionalError('V-US-08', 'a bundle composes at least two exchangeable entities');
      const members = input.members.map((m) => this.p.fabric.resolve(m).entry);
      for (const m of members) if (m.kind !== 'ExchangeableEntity') throw new ConstitutionalError('V-US-08', `${m.canonicalId} is not an exchangeable entity`);
      const ns = input.namespace ?? this.p.operationalNamespace();
      const bundle = this.p.fabric.submit(
        {
          kind: 'ExchangeableEntity',
          namespace: ns,
          name: input.name,
          statement: '',
          content: { composite: true, members: members.map((m) => m.canonicalId), facetBindings: {}, capabilities: [...new Set(members.flatMap((m) => (m.content.capabilities as string[]) ?? []))] },
          labels: { [this.p.cfg.platform.defaultLocale]: input.name },
          provenance: { source: 'commerce-engine' },
        },
        actor,
      );
      for (const m of members) {
        this.p.fabric.relate('PART-OF', m.canonicalId, bundle.canonicalId, actor);
        this.p.bus.emit({ type: 'us.bundle.member.added', subject: bundle.canonicalId, actor, payload: { member: m.canonicalId } });
      }
      this.p.fabric.transition(bundle.canonicalId, 'DEFINED', actor);
      const roles = this.classifyRoles(bundle.canonicalId, actor);
      let offer: Entry | undefined;
      if (input.offer) {
        if (this.p.fabric.require(bundle.canonicalId).lifecycle.status === 'CLASSIFIED') this.list(bundle.canonicalId, actor);
        offer = this.publishOffer({ ...input.offer, subject: bundle.canonicalId }, actor);
      }
      return { bundle: this.p.fabric.require(bundle.canonicalId), roles, offer };
    });
  }

  // ── Offers ──────────────────────────────────────────────────────────────

  /**
   * Publishes an offer: consideration registered as Value relationships
   * (never a number, V-US-04), then Draft → Eligible → Published → Active
   * under policy evaluation (UCL-G01).
   */
  publishOffer(input: OfferInput, actor: Actor, contextMap?: Record<string, Record<string, unknown>>): Entry {
    return this.p.store.tx(() => {
      const subject = this.p.fabric.resolve(input.subject).entry;
      if (subject.kind !== 'ExchangeableEntity') throw new ConstitutionalError('Phase006-§4.4', 'an offer is issued over an exchangeable entity');
      const ns = input.namespace ?? subject.classification.namespace;
      const ctx = this.p.context.forPurpose('pricing', contextMap, actor);
      this.p.policy.enforce({ action: 'commerce.offer', subject, actor, context: ctx });
      const offerName = input.name ?? `Offer on ${subject.definition.canonicalName} #${this.p.fabric.newCorrelationId().slice(0, 8)}`;
      const offer = this.p.fabric.submit(
        {
          kind: 'Offer',
          namespace: ns,
          name: offerName,
          statement: '',
          content: {
            subjectRef: subject.canonicalId,
            issuer: actor.authority,
            issuerPrincipal: actor.principal,
            entitlementSpec: input.entitlementSpec,
            consideration: ['pending'],
            eligibility: input.eligibility ?? [],
            validity: input.validity,
            stackingPolicy: input.stackingPolicy ?? 'best-of',
            allocationPolicy: input.allocationPolicy ?? { mechanism: 'first-come', capacity: null },
            policies: input.policies ?? [],
            promotionPolicies: input.promotionPolicies ?? [],
            context: ctx.record,
          },
          provenance: { source: 'commerce-engine' },
          relationships: [{ type: 'OFFERS', target: subject.canonicalId }, ...[...(input.policies ?? []), ...(input.promotionPolicies ?? [])].map((pol) => ({ type: 'GOVERNED-BY', target: pol }))],
        },
        actor,
      );
      const valueIds = input.consideration.map(
        (c) =>
          this.p.fabric.transition(
            this.p.measure.value({ subject: offer.canonicalId, valuer: actor.authority, purpose: c.purpose ?? 'consideration', magnitude: c.magnitude, unit: c.unit, basis: c.basis ?? 'issuer consideration', contextConditions: c.contextConditions ?? [] }, actor, ctx, ns).canonicalId,
            'EFFECTIVE',
            actor,
          ).canonicalId,
      );
      this.p.fabric.amend(offer.canonicalId, actor, (e) => {
        e.content.consideration = valueIds;
      }, 'CONSIDERATION');
      this.p.fabric.transition(offer.canonicalId, 'ELIGIBLE', actor);
      this.p.fabric.transition(offer.canonicalId, 'PUBLISHED', actor, { policyPermits: true }, undefined, 'us.offer.published');
      const facts = this.lifecycleFacts(this.p.fabric.require(offer.canonicalId), 'ACTIVE');
      if (facts.validityOpen) this.p.fabric.transition(offer.canonicalId, 'ACTIVE', actor);
      // Classify the offer itself (offer / promotion roles).
      this.p.taxonomy.classify(offer.canonicalId, actor, { schemes: this.p.commerceSchemes(), context: ctx });
      if (subject.lifecycle.status === 'LISTED' && this.p.fabric.require(offer.canonicalId).lifecycle.status === 'ACTIVE') this.p.fabric.transition(subject.canonicalId, 'TRADABLE', actor);
      return this.p.fabric.require(offer.canonicalId);
    });
  }

  withdrawOffer(offerId: string, cause: string, actor: Actor): Entry {
    return this.p.fabric.transition(offerId, 'WITHDRAWN', actor, { cause }, (e) => {
      e.content.withdrawnCause = cause;
    }, 'us.offer.withdrawn');
  }

  private offerValid(offer: Entry, ctx: ResolvedContext): string | null {
    const c = offer.content as unknown as OfferInput;
    if (offer.lifecycle.status !== 'ACTIVE') return `offer is ${offer.lifecycle.status}, not ACTIVE`;
    const instant = String(ctx.bindings.Temporal?.instant ?? this.p.clock.now());
    const w = c.validity.window;
    if (Date.parse(instant) < Date.parse(w.start) || (w.end !== null && Date.parse(instant) >= Date.parse(w.end))) return `evaluation instant ${instant} is outside the offer's validity window (V-US-06)`;
    if (c.validity.regions?.length) {
      const here = [ctx.bindings.Spatial?.jurisdiction, ...((ctx.bindings.Spatial?.regions as string[]) ?? [])].filter(Boolean).map(String);
      if (!here.some((r) => c.validity.regions!.includes(r))) return `offer is not valid in ${here.join(', ') || 'an unspecified location'} (US-S-05)`;
    }
    for (const cond of c.validity.contextConditions ?? []) if (!this.p.expressions.boolean(cond, { ...ctx.bindings, context: ctx.bindings })) return `context condition not met: ${cond}`;
    return null;
  }

  /**
   * QUOTE(offer, context) → consideration as Value relationships. Only the
   * Values applicable in the resolved context are used; currency is resolved
   * per evaluation; adjustments and tax are registered policies attached to
   * the offer or through classification (C-US-01) — never a rate table.
   */
  quote(offerId: string, actor: Actor, contextMap?: Record<string, Record<string, unknown>>, ctxIn?: ResolvedContext): Quote {
    const offer = this.p.fabric.resolve(offerId).entry;
    const ctx = ctxIn ?? this.p.context.forPurpose('pricing', contextMap, actor);
    const invalid = this.offerValid(offer, ctx);
    if (invalid) {
      this.p.bus.emit({ type: 'us.quote.refused', subject: offer.canonicalId, actor, payload: { reason: invalid }, context: ctx.record });
      throw new ConstitutionalError('D-US-03', `offer ${offer.canonicalId} is not quotable in this context: ${invalid}`);
    }
    const c = offer.content as Record<string, unknown>;
    const targetUnit = ctx.bindings.Economic?.currency ? String(ctx.bindings.Economic.currency) : null;
    const lines: Quote['lines'] = [];
    const values = ((c.consideration as string[]) ?? []).map((id) => this.p.fabric.require(id)).filter((v) => v.lifecycle.status === 'EFFECTIVE' && this.p.measure.applicable(v, ctx));
    const byUnit = new Map<string, Entry[]>();
    for (const v of values) byUnit.set(String(v.content.unit), [...(byUnit.get(String(v.content.unit)) ?? []), v]);
    // Most specific applicable Value per unit: the one with the most context conditions.
    const chosen = [...byUnit.values()].map((list) => list.sort((a, b) => ((b.content.contextConditions as string[]).length - (a.content.contextConditions as string[]).length))[0]);
    const preferred = targetUnit ? chosen.filter((v) => v.content.unit === targetUnit) : chosen;
    const candidates = preferred.length ? preferred : chosen;
    if (!candidates.length) throw new ConstitutionalError('D-US-03', `no consideration of offer ${offer.canonicalId} is applicable in this context`);
    for (const v of candidates) {
      let magnitude = Number(v.content.magnitude);
      let unit = String(v.content.unit);
      let converted: { from: string; path: string[] } | undefined;
      if (targetUnit && unit !== targetUnit && this.p.measure.unit(unit)?.content.dimension === this.p.measure.unit(targetUnit)?.content.dimension) {
        const conv = this.p.measure.convert(magnitude, unit, targetUnit, ctx);
        converted = { from: unit, path: conv.path };
        magnitude = conv.magnitude;
        unit = targetUnit;
      }
      lines.push({ magnitude, unit, basis: (v.content.basis as string) ?? null, valuer: String(v.content.valuer), purpose: String(v.content.purpose), sourceValue: v.canonicalId, converted });
    }
    const primary = lines[0];
    const adjustments: Quote['adjustments'] = [];
    const taxes: Quote['taxes'] = [];
    const policyIds = new Set<string>([...((c.promotionPolicies as string[]) ?? []), ...((c.policies as string[]) ?? []), ...this.p.taxonomy.policiesFor(offer.canonicalId).map((x) => x.policy), ...this.p.taxonomy.policiesFor(String(c.subjectRef)).map((x) => x.policy)]);
    const scope = { ...ctx.bindings, context: ctx.bindings, amount: primary.magnitude, unit: primary.unit };
    const candidatesAdj: Quote['adjustments'] = [];
    const entitlementConditions: Quote['entitlementConditions'] = [];
    for (const pid of policyIds) {
      const pol = this.p.fabric.tryResolve(pid)?.entry;
      if (!pol) continue;
      const pc = pol.content as Record<string, unknown>;
      if (!((pc.contextConditions as string[]) ?? []).every((cond) => this.p.expressions.boolean(cond, scope))) continue;
      for (const m of (pc.modifiers as { when?: string; percent?: number; amount?: number; description?: string }[]) ?? []) {
        if (m.when && !this.p.expressions.boolean(m.when, scope)) continue;
        const delta = m.percent !== undefined ? (primary.magnitude * m.percent) / 100 : Number(m.amount ?? 0);
        candidatesAdj.push({ policy: pol.canonicalId, description: m.description ?? pol.definition.canonicalName, delta, unit: primary.unit });
      }
      for (const t of (pc.taxRules as { when?: string; ratePercent: number; description?: string }[]) ?? []) {
        if (t.when && !this.p.expressions.boolean(t.when, scope)) continue;
        taxes.push({ policy: pol.canonicalId, description: t.description ?? pol.definition.canonicalName, ratePercent: t.ratePercent, amount: 0, unit: primary.unit });
      }
      for (const ec of (pc.entitlementConditions as { when?: string; kind: string; statement: string; expression?: string }[]) ?? []) {
        if (ec.when && !this.p.expressions.boolean(ec.when, scope)) continue;
        entitlementConditions.push({ kind: ec.kind, statement: ec.statement, source: pol.canonicalId });
      }
    }
    const stacking = String(c.stackingPolicy ?? 'best-of');
    if (candidatesAdj.length) {
      if (stacking === 'additive') adjustments.push(...candidatesAdj);
      else if (stacking === 'exclusive') adjustments.push(candidatesAdj[0]);
      else adjustments.push(candidatesAdj.reduce((best, a) => (a.delta < best.delta ? a : best)));
    }
    const minor = Number(this.p.measure.unit(primary.unit)?.content.minorUnits ?? 6);
    const round = (x: number) => Math.round(x * 10 ** minor) / 10 ** minor;
    const net = primary.magnitude + adjustments.reduce((s, a) => s + a.delta, 0);
    for (const t of taxes) t.amount = round((net * t.ratePercent) / 100);
    const total = { magnitude: round(net + taxes.reduce((s, t) => s + t.amount, 0)), unit: primary.unit };
    const quoteValue = this.p.measure.value({ subject: offer.canonicalId, valuer: String(c.issuer), purpose: 'quote', magnitude: total.magnitude, unit: total.unit, basis: `lines=${lines.length}; adjustments=${adjustments.length}; taxes=${taxes.length}`, quoteOf: offer.canonicalId }, actor, ctx, offer.classification.namespace);
    const q: Quote = {
      offer: offer.canonicalId,
      quoteId: quoteValue.canonicalId,
      context: ctx.record,
      lines,
      adjustments,
      taxes,
      total,
      entitlementConditions,
      validUntil: (c.validity as { window: Interval }).window.end,
    };
    this.p.bus.emit({ type: 'us.consideration.quoted', subject: offer.canonicalId, actor, payload: { quoteId: q.quoteId, total, adjustments: adjustments.length, taxes: taxes.length }, context: ctx.record });
    return q;
  }

  private grantedQuantity(offerId: string, window?: Interval): number {
    const ents = this.p.fabric.query({ kind: 'Entitlement', contentPath: 'offerRef', contentEquals: offerId, limit: 100_000 }).entries.filter((e) => !['REVOKED', 'TERMINATED', 'TRANSFERRED'].includes(e.lifecycle.status) && e.content.simulated !== true);
    return ents
      .filter((e) => !window || !(e.content.bounds as { temporal?: Interval }).temporal || overlaps((e.content.bounds as { temporal: Interval }).temporal, window))
      .reduce((s, e) => s + Number(e.content.quantity ?? 1), 0);
  }

  /**
   * ACCEPT(offer, holder, context) → Entitlement + events. Policy first
   * (UCL-G01), eligibility, allocation under the offer's registered policy
   * (rivalry in window from the Exclusivity facet), a fresh quote as
   * evidence, settlement, then the bounded entitlement.
   */
  accept(input: { offer: string; holder: string; quantity?: number; window?: Interval; payer?: string; bid?: number; namespace?: string }, actor: Actor, contextMap?: Record<string, Record<string, unknown>>): { entitlement: Entry; quote: Quote; settlement: { transferId: string } | null; obligations: string[] } {
    return this.p.store.tx(() => {
      const offer = this.p.fabric.resolve(input.offer).entry;
      const holder = this.p.fabric.resolve(input.holder).entry;
      const ctx = this.p.context.forPurpose('pricing', contextMap, actor);
      const verdict = this.p.policy.enforce({ action: 'commerce.accept', subject: offer, actor, context: ctx });
      const c = offer.content as Record<string, unknown>;
      const subject = this.p.fabric.require(String(c.subjectRef));
      const eligibilityScope = { ...ctx.bindings, context: ctx.bindings, holder: { id: holder.canonicalId, kind: holder.kind, ...(holder.content.attributes as object) }, quantity: input.quantity ?? 1 };
      for (const rule of (c.eligibility as string[]) ?? []) {
        if (!this.p.expressions.boolean(rule, eligibilityScope)) throw new ConstitutionalError('Phase006-§4.4', `holder is not eligible: ${rule}`);
      }
      const spec = c.entitlementSpec as EntitlementSpec;
      const instant = String(ctx.bindings.Temporal?.instant ?? this.p.clock.now());
      const window: Interval | undefined = input.window ?? spec.window ?? (spec.duration ? { start: instant, end: new Date(Date.parse(instant) + this.p.measure.convert(spec.duration.magnitude, spec.duration.unit, 's').magnitude * 1000).toISOString() } : undefined);
      const quantity = input.quantity ?? 1;
      const facets = this.facetScope((subject.content.facetBindings as Record<string, string>) ?? {});
      const alloc = (c.allocationPolicy as OfferInput['allocationPolicy']) ?? { mechanism: 'first-come', capacity: null };
      if (alloc.capacity !== null && alloc.capacity !== undefined && this.grantedQuantity(offer.canonicalId) + quantity > alloc.capacity) {
        throw new ConstitutionalError('RS-03', `allocation policy ${alloc.mechanism}: capacity ${alloc.capacity} exhausted`);
      }
      if (window && (facets.F3 === 'rival' || facets.F3 === 'bounded-rival')) {
        const perWindow = facets.F3 === 'rival' ? 1 : (alloc.perWindowCapacity ?? alloc.capacity ?? 1);
        const inWindow = this.p.fabric
          .query({ kind: 'Entitlement', contentPath: 'subjectRef', contentEquals: subject.canonicalId, limit: 100_000 })
          .entries.filter((e) => ['GRANTED', 'ACTIVE', 'RENEWED', 'SUSPENDED'].includes(e.lifecycle.status) && e.content.simulated !== true && (e.content.bounds as { temporal?: Interval }).temporal && overlaps((e.content.bounds as { temporal: Interval }).temporal, window))
          .reduce((s, e) => s + Number(e.content.quantity ?? 1), 0);
        if (inWindow + quantity > perWindow) throw new ConstitutionalError('V-RS-03', `exclusivity ${facets.F3}: the window ${window.start}–${window.end} is already allocated (${inWindow}/${perWindow})`);
      }
      if (alloc.mechanism === 'ascending-bid') {
        const q0 = this.quote(offer.canonicalId, actor, undefined, ctx);
        if (!(typeof input.bid === 'number' && input.bid >= q0.total!.magnitude)) throw new ConstitutionalError('Phase006-§10', `ascending-bid allocation requires a bid of at least ${q0.total!.magnitude} ${q0.total!.unit}`);
      }
      const quote = this.quote(offer.canonicalId, actor, undefined, ctx);
      const simulated = ctx.reality !== 'actual';
      const conditions = [...(spec.conditions ?? []), ...quote.entitlementConditions.map((ec) => ({ kind: ec.kind, statement: ec.statement, source: ec.source }))];
      const ns = input.namespace ?? offer.classification.namespace;
      const ent = this.p.fabric.submit(
        {
          kind: 'Entitlement',
          namespace: ns,
          name: `Entitlement ${holder.definition.canonicalName} → ${subject.definition.canonicalName} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
          statement: '',
          content: {
            grantor: String(c.issuer),
            holder: holder.canonicalId,
            subjectRef: subject.canonicalId,
            offerRef: offer.canonicalId,
            capabilityRef: spec.capability,
            form: spec.form,
            bounds: { temporal: window ?? null, spatial: spec.spatial ?? null, contextual: { reality: ctx.reality }, quantitative: spec.quantity ?? null },
            quantity,
            usage: 0,
            conditions,
            policies: [...((c.policies as string[]) ?? [])],
            renewable: spec.renewable === true,
            transferAdmissible: ['transferable', 'leaseable', 'assignable-with-consent'].includes(facets.F4 ?? ''),
            evidence: { offer: offer.canonicalId, quote: quote.quoteId, policyVerdict: verdict.reason, obligations: verdict.obligations.map((o) => o.obligation) },
            simulated,
            reality: ctx.reality,
            context: ctx.record,
          },
          provenance: { source: 'commerce-engine' },
          relationships: [
            { type: 'GRANTED-UNDER', target: offer.canonicalId },
            { type: 'HELD-BY', target: holder.canonicalId },
          ],
        },
        actor,
      );
      this.p.bus.emit({ type: 'us.offer.accepted', subject: offer.canonicalId, actor, payload: { entitlement: ent.canonicalId, holder: holder.canonicalId, simulated }, context: ctx.record });
      this.p.bus.emit({ type: 'us.entitlement.granted', subject: ent.canonicalId, actor, payload: { holder: holder.canonicalId, bounds: ent.content.bounds, simulated }, context: ctx.record });
      let settlement: { transferId: string } | null = null;
      const monetary = quote.total && this.p.measure.unit(quote.total.unit)?.content.dimension === 'currency';
      if (monetary && quote.total!.magnitude > 0) {
        settlement = this.p.ledger.transfer({ from: input.payer ?? holder.canonicalId, to: String(c.issuerPrincipal ?? c.issuer), magnitude: quote.total!.magnitude * quantity, unit: quote.total!.unit, reference: ent.canonicalId, memo: `consideration for ${offer.canonicalId}`, namespace: ns }, actor, ctx);
      }
      const active = this.p.fabric.transition(ent.canonicalId, 'ACTIVE', actor);
      const remaining = alloc.capacity === null || alloc.capacity === undefined ? Infinity : alloc.capacity - this.grantedQuantity(offer.canonicalId);
      if (remaining <= 0) this.p.fabric.transition(offer.canonicalId, 'EXHAUSTED', actor, {}, undefined, 'us.offer.exhausted');
      return { entitlement: active, quote, settlement, obligations: verdict.obligations.map((o) => o.obligation) };
    });
  }

  private conditionsMet(ent: Entry): boolean {
    const conds = (ent.content.conditions as { kind: string; expression?: string }[]) ?? [];
    const settled = this.p.ledger.settledAmount(ent.canonicalId);
    return conds.every((cond) => {
      if (cond.kind === 'payment') return Object.values(settled).some((v) => v > 0);
      if (cond.expression) return this.p.expressions.boolean(cond.expression, { entitlement: ent.content, settled });
      return true;
    });
  }

  /**
   * CHECK-ENTITLEMENT(holder, capability, context) → verdict + evidence.
   * Bounds are enforced before capability exercise (US-S-02); an entitlement
   * created in a simulated context is never effective in an actual one.
   */
  checkEntitlement(input: { holder: string; capability: string; subject?: string; quantity?: number }, actor: Actor, contextMap?: Record<string, Record<string, unknown>>): { permitted: boolean; entitlement: string | null; reasons: string[]; context: Record<string, unknown> } {
    const holder = this.p.fabric.resolve(input.holder).entry.canonicalId;
    const ctx = this.p.context.forPurpose('entitlement-check', contextMap, actor);
    const instant = String(ctx.bindings.Temporal?.instant ?? this.p.clock.now());
    const here = [ctx.bindings.Spatial?.jurisdiction, ...((ctx.bindings.Spatial?.regions as string[]) ?? [])].filter(Boolean).map(String);
    const reasons: string[] = [];
    const candidates = this.p.fabric.query({ kind: 'Entitlement', contentPath: 'holder', contentEquals: holder, limit: 100_000 }).entries;
    let found: Entry | null = null;
    for (const e of candidates) {
      const c = e.content as Record<string, unknown>;
      const b = c.bounds as { temporal: Interval | null; spatial: string[] | null; quantitative: number | null };
      if (c.capabilityRef !== input.capability) continue;
      if (input.subject && c.subjectRef !== this.p.fabric.resolve(input.subject).entry.canonicalId) continue;
      if (!['ACTIVE', 'RENEWED'].includes(e.lifecycle.status)) {
        reasons.push(`${e.canonicalId}: status ${e.lifecycle.status}`);
        continue;
      }
      if (c.reality !== ctx.reality) {
        reasons.push(`${e.canonicalId}: granted in reality "${String(c.reality)}", evaluated in "${ctx.reality}" (IN-S-04)`);
        continue;
      }
      if (b.temporal && !(Date.parse(b.temporal.start) <= Date.parse(instant) && (b.temporal.end === null || Date.parse(instant) < Date.parse(b.temporal.end)))) {
        reasons.push(`${e.canonicalId}: ${instant} outside temporal bounds`);
        continue;
      }
      if (b.spatial?.length && !here.some((r) => b.spatial!.includes(r))) {
        reasons.push(`${e.canonicalId}: location ${here.join(',') || 'unspecified'} outside spatial bounds`);
        continue;
      }
      if (b.quantitative !== null && b.quantitative !== undefined && Number(c.usage ?? 0) + (input.quantity ?? 1) > b.quantitative) {
        reasons.push(`${e.canonicalId}: quantitative bound ${b.quantitative} would be exceeded`);
        continue;
      }
      const unmet = ((c.conditions as { kind: string; statement: string; expression?: string }[]) ?? []).filter((cond) => cond.expression && !this.p.expressions.boolean(cond.expression, { ...ctx.bindings, context: ctx.bindings, entitlement: c }));
      if (unmet.length) {
        reasons.push(`${e.canonicalId}: condition unmet — ${unmet.map((u) => u.statement).join('; ')}`);
        continue;
      }
      found = e;
      break;
    }
    const permitted = found !== null;
    this.p.bus.emit({ type: 'us.entitlement.checked', subject: found?.canonicalId ?? holder, actor, payload: { capability: input.capability, permitted, reasons: permitted ? [] : reasons }, context: ctx.record });
    if (!permitted && candidates.length) this.p.bus.emit({ type: 'compliance.entitlement.outside-bounds', subject: holder, actor, payload: { capability: input.capability, reasons, rule: 'C-US-03' }, context: ctx.record });
    return { permitted, entitlement: found?.canonicalId ?? null, reasons: permitted ? [`within bounds of ${found!.canonicalId}`] : reasons.length ? reasons : ['no entitlement for this capability'], context: ctx.record };
  }

  /** Records exercise of a quantitative entitlement (checked first, US-S-02). */
  consume(input: { holder: string; capability: string; quantity?: number; subject?: string }, actor: Actor, contextMap?: Record<string, Record<string, unknown>>): Entry {
    const check = this.checkEntitlement(input, actor, contextMap);
    if (!check.permitted) throw new ConstitutionalError('US-S-02', `entitlement check failed: ${check.reasons.join('; ')}`);
    const updated = this.p.fabric.amend(check.entitlement!, actor, (e) => {
      e.content.usage = Number(e.content.usage ?? 0) + (input.quantity ?? 1);
    }, 'CONSUME', 'us.entitlement.exercised');
    const b = updated.content.bounds as { quantitative: number | null };
    if (b.quantitative !== null && Number(updated.content.usage) >= b.quantitative) return this.p.fabric.transition(updated.canonicalId, 'EXPIRED', actor, {}, undefined, 'us.entitlement.expired');
    return updated;
  }

  /** TRANSFER-ENTITLEMENT: guarded by the Transferability facet and policy (US-S-03). */
  transfer(input: { entitlement: string; newHolder: string; consentEvidence?: string }, actor: Actor, contextMap?: Record<string, Record<string, unknown>>): { from: Entry; to: Entry } {
    return this.p.store.tx(() => {
      const ent = this.p.fabric.resolve(input.entitlement).entry;
      const subject = this.p.fabric.require(String(ent.content.subjectRef));
      const f4 = this.facetScope((subject.content.facetBindings as Record<string, string>) ?? {}).F4;
      if (!['transferable', 'leaseable', 'assignable-with-consent'].includes(f4 ?? '')) throw new ConstitutionalError('US-S-03', `the Transferability facet (${f4 ?? 'unbound'}) does not admit transfer`);
      if (f4 === 'assignable-with-consent' && !input.consentEvidence) throw new ConstitutionalError('US-S-03', 'assignment requires recorded consent evidence');
      const ctx = this.p.context.forPurpose('entitlement-check', contextMap, actor);
      this.p.policy.enforce({ action: 'commerce.transfer', subject: ent, actor, context: ctx });
      if (actor.principal !== ent.content.holder && !this.p.governance.isMember(actor.principal, String(ent.content.grantor))) throw new ConstitutionalError('US-S-03', 'only the holder (or the grantor authority) may transfer an entitlement');
      const newHolder = this.p.fabric.resolve(input.newHolder).entry;
      const to = this.p.fabric.submit(
        {
          kind: 'Entitlement',
          namespace: ent.classification.namespace,
          name: `Entitlement ${newHolder.definition.canonicalName} → ${subject.definition.canonicalName} #${this.p.fabric.newCorrelationId().slice(0, 8)}`,
          statement: '',
          content: { ...ent.content, holder: newHolder.canonicalId, transferredFrom: ent.canonicalId, evidence: { ...(ent.content.evidence as object), transfer: { from: ent.content.holder, consent: input.consentEvidence ?? null, context: ctx.record } } },
          provenance: { source: 'commerce-engine' },
          relationships: [
            { type: 'GRANTED-UNDER', target: String(ent.content.offerRef) },
            { type: 'HELD-BY', target: newHolder.canonicalId },
          ],
        },
        actor,
      );
      const from = this.p.fabric.transition(ent.canonicalId, 'TRANSFERRED', actor, {}, (e) => {
        e.content.transferredTo = to.canonicalId;
      }, 'us.entitlement.transferred');
      return { from, to: this.p.fabric.transition(to.canonicalId, 'ACTIVE', actor) };
    });
  }

  suspend(entitlementId: string, cause: string, actor: Actor): Entry {
    return this.p.fabric.transition(entitlementId, 'SUSPENDED', actor, { cause }, (e) => {
      e.content.suspension = { cause, at: this.p.clock.now() };
    }, 'us.entitlement.suspended');
  }

  reinstate(entitlementId: string, actor: Actor): Entry {
    return this.p.fabric.transition(entitlementId, 'ACTIVE', actor, {}, undefined, 'us.entitlement.reinstated');
  }

  /** Renewal: a new temporal window of the same length; conditions must be met. */
  renew(entitlementId: string, actor: Actor): Entry {
    return this.p.store.tx(() => {
      const ent = this.p.fabric.require(entitlementId);
      const t = (ent.content.bounds as { temporal: Interval | null }).temporal;
      const renewed = this.p.fabric.transition(entitlementId, 'RENEWED', actor, {}, (e) => {
        if (t && t.end) {
          const len = Date.parse(t.end) - Date.parse(t.start);
          (e.content.bounds as { temporal: Interval }).temporal = { start: t.end, end: new Date(Date.parse(t.end) + len).toISOString() };
        }
        e.content.usage = 0;
        e.content.renewals = Number(e.content.renewals ?? 0) + 1;
      }, 'us.entitlement.renewed');
      return this.p.fabric.transition(renewed.canonicalId, 'ACTIVE', actor);
    });
  }

  /** REVOKE with recorded cause; cascades to dependent entitlements (US-S-04). */
  revoke(entitlementId: string, cause: string, actor: Actor): string[] {
    return this.p.store.tx(() => {
      const decision = this.p.decisions.record({ subject: entitlementId, authority: actor.authority, selection: 'REVOKE', alternatives: ['REVOKE', 'RETAIN'], rationale: cause, objective: 'entitlement-governance' }, actor);
      const revoked: string[] = [];
      const visit = (id: string) => {
        const e = this.p.fabric.get(id);
        if (!e || !['ACTIVE', 'SUSPENDED', 'GRANTED', 'RENEWED'].includes(e.lifecycle.status)) return;
        if (e.lifecycle.status === 'GRANTED') this.p.fabric.transition(id, 'ACTIVE', actor);
        this.p.fabric.transition(id, 'REVOKED', actor, { decision: decision.canonicalId }, (x) => {
          x.content.revocation = { cause, decision: decision.canonicalId };
        }, 'us.entitlement.revoked');
        revoked.push(id);
        for (const dep of this.p.fabric.query({ kind: 'Entitlement', contentPath: 'transferredFrom', contentEquals: id, limit: 1000 }).entries) visit(dep.canonicalId);
        for (const dep of this.p.fabric.query({ kind: 'Entitlement', contentPath: 'dependsOnEntitlement', contentEquals: id, limit: 1000 }).entries) visit(dep.canonicalId);
      };
      visit(entitlementId);
      return revoked;
    });
  }

  /**
   * Temporal sweep: offers whose validity closed expire; entitlements whose
   * bounds elapsed expire, or renew where renewable and conditions are met;
   * registered dunning policies suspend and terminate unmet obligations.
   */
  sweep(actor: Actor): { expiredOffers: string[]; expiredEntitlements: string[]; renewed: string[]; suspended: string[]; terminated: string[] } {
    const out = { expiredOffers: [] as string[], expiredEntitlements: [] as string[], renewed: [] as string[], suspended: [] as string[], terminated: [] as string[] };
    const now = Date.parse(this.p.clock.now());
    for (const o of this.p.fabric.query({ kind: 'Offer', status: ['PUBLISHED', 'ACTIVE', 'ELIGIBLE'], limit: 100_000 }).entries) {
      const w = (o.content.validity as { window: Interval }).window;
      if (w.end && now >= Date.parse(w.end)) {
        this.p.fabric.transition(o.canonicalId, 'EXPIRED', actor, {}, undefined, 'us.offer.expired');
        out.expiredOffers.push(o.canonicalId);
      } else if (o.lifecycle.status === 'PUBLISHED' && Date.parse(w.start) <= now) this.p.fabric.transition(o.canonicalId, 'ACTIVE', actor);
    }
    const dunning = this.p.fabric.query({ kind: 'Policy', status: ['CERTIFIED', 'ADMISSIBLE'], limit: 10_000 }).entries.filter((pol) => pol.content.dunning);
    for (const e of this.p.fabric.query({ kind: 'Entitlement', status: ['ACTIVE', 'SUSPENDED'], limit: 100_000 }).entries) {
      const t = (e.content.bounds as { temporal: Interval | null }).temporal;
      if (t?.end && now >= Date.parse(t.end)) {
        if (e.content.renewable === true && this.conditionsMet(e) && e.lifecycle.status === 'ACTIVE') {
          this.renew(e.canonicalId, actor);
          out.renewed.push(e.canonicalId);
        } else {
          this.p.fabric.transition(e.canonicalId, 'EXPIRED', actor, {}, undefined, 'us.entitlement.expired');
          out.expiredEntitlements.push(e.canonicalId);
        }
        continue;
      }
      const applicable = dunning.find((pol) => ((e.content.policies as string[]) ?? []).includes(pol.canonicalId));
      if (applicable && !this.conditionsMet(e)) {
        const d = applicable.content.dunning as { graceDays: number; retries: number; intervalDays: number };
        const due = t ? Date.parse(t.start) + d.graceDays * 86_400_000 : now;
        const attempts = Number(e.content.dunningAttempts ?? 0);
        if (now < due) continue;
        if (e.lifecycle.status === 'ACTIVE') {
          this.suspend(e.canonicalId, `dunning: payment condition unmet (policy ${applicable.canonicalId})`, actor);
          out.suspended.push(e.canonicalId);
        } else if (attempts >= d.retries) {
          this.p.fabric.transition(e.canonicalId, 'TERMINATED', actor, { cause: 'dunning exhausted' }, undefined, 'us.entitlement.terminated');
          out.terminated.push(e.canonicalId);
        } else {
          this.p.fabric.amend(e.canonicalId, actor, (x) => {
            x.content.dunningAttempts = attempts + 1;
          }, 'DUNNING', 'us.entitlement.dunning.attempted');
        }
      }
    }
    return out;
  }
}
