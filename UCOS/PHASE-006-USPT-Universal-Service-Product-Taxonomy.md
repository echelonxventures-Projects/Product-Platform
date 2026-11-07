# PHASE-006 — UNIVERSAL SERVICE PRODUCT TAXONOMY (USPT)

**Document ID:** UCOS-USPT-DOC-001
**Document Name:** Universal Service Product Taxonomy
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-2
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The charter requires a single universal commerce object model capable of representing:

```text
Products · Services · Subscriptions · Events · Experiences
Assets · Licenses · Bookings · Offers · Bundles
```

…and, by the Quality Standard, to do so **without introducing new architectural primitives**.

This phase demonstrates the method working at full strength. The result is not ten entity types, and not one giant entity with ten flags. It is **one construct and seven facets**, plus the observation that nine of the ten nouns in the charter are *roles*, not types.

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL SERVICE PRODUCT TAXONOMY

A constitutional model in which all exchangeable things are instances of
one construct — the EXCHANGEABLE ENTITY — distinguished not by type
but by seven registered facets, and in which the commercial nouns of the
charter are CLASSIFICATIONS (roles) assumed by entities rather than
kinds of entity.

The model adds ZERO primitives and ZERO constructs to the platform.
Everything below is composed from Phase 002 and Phase 003.
```

---

## 3. THEORY — THE DERIVATION THAT MAKES THIS POSSIBLE

### 3.1 Applying the Universal Question

Take the ten nouns. Ask of each: "what is the more fundamental concept from which this can be derived?"

| Charter noun | Derivation |
|---|---|
| **Product** | An entity durable enough to be identified and transferred. → Entity + Identity + Transferability |
| **Service** | An entity whose value is delivered as a performance, not transferred. → Entity + Capability + Temporality |
| **Subscription** | A periodic entitlement to a capability. → Entitlement + Temporality(periodic) |
| **Event** | An entity that exists only within a temporal window. → Entity + Ordering(temporal, bounded) |
| **Experience** | An event in which an entity participates as observer. → Event + Apprehension |
| **Asset** | An entity held for the value it realises. → Entity + Value(role) + Scarcity |
| **License** | A right, granted, to exercise a capability under conditions. → Right + Constraint + Grant |
| **Booking** | An exclusive allocation of a resource for a temporal window. → Resource + Ordering(interval) + Exclusivity |
| **Offer** | A proposal to create an entitlement in exchange for consideration. → Proposal + Entitlement + Value |
| **Bundle** | A composition offered as one exchangeable whole. → Composition(PART-OF) + Offer |

Reading the right-hand column: the vocabulary is entirely Tier-1. **No noun required a new primitive.** Each noun is a *modulation* of a small number of recurring facets.

### 3.2 The Key Recognition

There are only **four** things happening on the right-hand side, repeated ten times:

```text
TEMPORALITY       how the thing exists in time (durable | instantaneous
                                                      | periodic | windowed)
ENTITLEMENT       what the acquirer gets (ownership | access | use | grant
                                                        | participation)
EXCLUSIVITY       whether acquisition excludes others (rival | shared | non-rival)
COMPOSITION       whether the thing is one part or a whole of parts
```

Plus three auxiliary modulations that appear in the definitions: **materiality** (physical | digital | informational), **transferability** (transferable | non-transferable | leaseable), and **scarcity** (unbounded | bounded | unique).

**Seven facets. Ten nouns. Zero types.**

### 3.3 Why "Type" Is the Wrong Notion

If Product were a *type* of entity, then a thing would be a product or a service, and the platform would need a rule for which. In reality:

- A **software package** is a product (durable, transferable) when sold as a license, and a service (access, periodic) when sold as a subscription — *the same artifact, two roles, chosen by the offer, not by the thing*.
- A **hotel room** is an asset when valued, a resource when allocated, a product when listed, and a booking when reserved — *the room never changes; the role does*.
- A **consulting engagement** is a service when performed and a subscription when retainered.

Role identity is therefore carried by the **offer and the entitlement**, not by the entity. This is not a subtlety; it is the entire mechanism by which the platform avoids hard-coded commerce logic while remaining able to express all of commerce.

---

## 4. THE ONE CONSTRUCT

### 4.1 Exchangeable Entity

```text
EXCHANGEABLE ENTITY

An entity capable of being the subject of an entitlement, in exchange
for consideration, under a governing policy, within a context.

Composed entirely of Tier-1 constructs:
  Entity (C-01) + Identity (C-02) + Capability (C-12) + Value (C-20)
  + Ordering (C-08/C-09) + Policy (C-16) + Context (C-17)
```

**Meta model:**

```text
ExchangeableEntity
├── identity                  canonical, aliases, external ids
├── entityRef                 the underlying Entity (the room, the song, the hour)
├── facetBindings{}           the seven facets, each a reference to a registered value
├── capabilities[]            what may be done with / by this thing
├── classifications[]         commerce roles (Phase 005 assertions)
├── context                   applicability of this exchangeable form (Phase 007)
├── policies[]                governance inherited from classification + explicit
├── lifecycle                 ExchangeableLifecycle (§6)
├── relationships[]           compositions, alternatives, dependencies, variants
├── knowledge[]               descriptions, specs, media — as registered Knowledge
└── lineage                   provenance + supersession
```

**The critical field is `entityRef`.** The exchangeable entity is *about* a thing; it is not the thing. One hotel room → one entity, and many exchangeable entities (a nightly rate, a monthly corporate rate, a package with breakfast). Conversely one exchangeable entity can bind a composition of many underlying entities (the bundle). This separation is what prevents the classic collapse in which "the product" and "the thing" become indistinguishable and pricing becomes an attribute of the thing.

### 4.2 The Seven Facets

Each facet is a **registered attribute with a governed domain**, not an enum in code.

| # | Facet | Domain | Governs |
|---|---|---|---|
| F1 | **Materiality** | physical · digital · informational · energetic | fulfilment modality, storage, tax treatment |
| F2 | **Temporality** | instantaneous · durable · periodic · windowed · episodic | entitlement duration, renewal, expiry |
| F3 | **Exclusivity** | rival · shared · non-rival · bounded-rival | availability, concurrency, allocation policy |
| F4 | **Transferability** | transferable · leaseable · non-transferable · assignable-with-consent | secondary markets, gifting, returns |
| F5 | **Fulfilment** | delivery · access · performance · grant · instantiation · participation | capability selection in composition |
| F6 | **Scarcity** | unbounded · bounded · unique · time-bounded | allocation policy, price mechanism |
| F7 | **Entitlement Form** | ownership · license · subscription · membership · rental · booking · option · participation | rights granted, obligations, revocation |

### 4.3 The Charter Nouns As Facet Signatures

This is the deliverable's core table. Each charter noun is a **typical facet binding**, registered as a taxon whose admission rule is expressed over the facets. Nothing below is a type; everything is a classification.

| Noun | F1 Materiality | F2 Temporality | F3 Exclusivity | F5 Fulfilment | F7 Entitlement |
|---|---|---|---|---|---|
| **Product** | physical/digital | durable | rival | delivery / instantiation | ownership |
| **Service** | physical/digital | instantaneous | shared | performance | — (performance itself) |
| **Subscription** | any | periodic | non-rival/bounded | access | subscription |
| **Event** | any | windowed | bounded-rival | instantiation | participation |
| **Experience** | any | episodic | bounded-rival | participation | participation |
| **Asset** | any | durable | rival | — | ownership |
| **License** | informational | durable/bounded | non-rival | grant | license |
| **Booking** | any | windowed | rival (in window) | access | booking |
| **Offer** | any | — | — | — | proposal |
| **Bundle** | composite | composite | composite | composite | composite |

**Reading the table correctly:** these are *typical bindings used as admission rules for registered taxa*, not a switch statement. A taxon's admission rule may be any registered Rule over any facets, including ones not in this table. A "product" that is episodic and non-rival is admissible if its taxon's rule admits it; the platform does not refuse, because the platform has no opinion.

### 4.4 Offer — the Construct That Carries Commerce

Offers are the active half of the model, and they are where most platforms go wrong by bolting pricing onto the product.

```text
OFFER

A proposal, issued by an authority, to create an entitlement in an
Exchangeable Entity in exchange for consideration, valid in a context.
```

```text
Offer
├── identity
├── subjectRef               the Exchangeable Entity (or Bundle)
├── issuer                   accountable authority (UCI-006)
├── entitlementSpec          what the acquirer gets (F7 + conditions)
├── consideration            Value (C-20) relationships — never a field
│      ├── magnitude · unit · valuer · purpose · context · basis
├── eligibility[]            rules restricting who may accept
├── validity                 temporal + spatial + contextual window
├── stackingPolicy           how this offer combines with others
├── allocationPolicy         how scarcity is allocated when demand exceeds supply
├── policies[]               pricing policy, tax policy, promotion policy
├── lifecycle                OfferLifecycle (§6)
├── evidence                 basis for the consideration value
└── context                  without which the offer has no price (Phase 007)
```

**`consideration` is a list of Value relationships, not a number.** The consequences are immediate and they are the reason this architecture does not need a "pricing engine" as a special component:

```text
• A price is context-dependent by construction, because Value is
  context-conditioned (C-20). Dynamic pricing is not a feature; it is
  the only behaviour the construct supports.
• Multiple consideration forms are native: monetary, barter, attention,
  data, labour. Each is a Value with a different unit.
• A price has an issuer and a purpose, so every price is auditable and
  explainable (UCI-006, UCI-011).
• Currency is a unit, registered in the Unit Registry — never a
  hard-coded field. No Currency Lock-In is satisfied structurally.
```

### 4.5 Bundle — Composition, Not a Type

A bundle is not a kind of entity. It is an Exchangeable Entity whose `relationships` contain PART-OF edges to other Exchangeable Entities, plus one Offer over the whole.

```text
Bundle = ExchangeableEntity { relationships: PART-OF*[member…] } + Offer(whole)
```

The same PART-OF relationship serves product kits, service tiers, subscription add-ons, event packages, and marketplace baskets. **No `Bundle` construct exists.** This is UCI-003 working: the composition primitive already existed (Phase 003, Capability; Phase 005, PART-OF), so a new one was refused.

### 4.6 Entitlement — the Outcome

```text
ENTITLEMENT

The right created when an offer is accepted: a governed, context-bound,
time-bounded permission to exercise a capability of an Exchangeable Entity.
```

```text
Entitlement
├── identity · grantor · holder
├── subjectRef              the Exchangeable Entity
├── capabilityRef           what the holder may do
├── bounds                  temporal · spatial · contextual · quantitative
├── conditions[]            ongoing obligations (payment, usage, attribution)
├── policies[]              governance of the entitlement
├── lifecycle               Granted → Active → Suspended → Renewed / Expired
│                           / Revoked / Transferred
└── evidence                the accepted offer + the authorising decision
```

Entitlements are what subscriptions, licenses, memberships, and bookings *are*: they differ only in `bounds` and `conditions`, which is to say in facet values, which is to say in metadata.

---

## 5. THE ROLE REGISTRY (HOW THE MODEL MEETS THE CHARTER LIST)

Each charter noun is registered once as a **taxon** in the Commerce Taxonomy, with an admission rule over the seven facets. The engine (Phase 005) classifies; nothing is compiled.

```text
TAXON                          ADMISSION RULE (over facets)
product                        F2=durable ∧ F7=ownership
service                        F5=performance ∧ F2=instantaneous
subscription                   F2=periodic ∧ F7=subscription
event                          F2=windowed ∧ F5=instantiation
experience                     F5=participation ∧ F2=episodic
asset                          F7=ownership ∧ F6≠unbounded
license                        F7=license
booking                        F7=booking ∧ F2=windowed
offer                          is-a Proposal (a distinct role; not a facet binding)
bundle                         has PART-OF composition of ≥2 exchangeable entities
membership                     F7=membership ∧ F2=periodic
rental                         F7=rental ∧ F2=windowed
promotion                      Offer with consideration modified by a Policy
option                         F7=option ∧ F2=windowed
```

**`promotion` and `pricing`** appear here because the charter's principle list mentions them. Note what they are: a promotion is *an offer whose consideration is modified by a policy*, and pricing is *the consideration facet of an offer evaluated in a context*. Neither is a construct. Neither is a component. Both are compositions.

### 5.1 The Full Commerce Object Model

```text
                    ┌──────────────┐
                    │   ENTITY     │  ← the thing (room, song, hour, right)
                    └──────┬───────┘
                           │ described-as (one or many)
                    ┌──────▼───────────────┐
                    │ EXCHANGEABLE ENTITY  │  ← facets bound, roles classified
                    └──────┬───────────────┘
                           │ subject-of
                    ┌──────▼───────┐         PART-OF (bundles)
                    │    OFFER     │◄──────────┘
                    └──────┬───────┘
                           │ accepted (an Action, C-13)
                    ┌──────▼───────┐
                    │  ENTITLEMENT │  ← the right, bounded and governed
                    └──────────────┘
```

Four nodes. Every commerce system that has ever existed is a composition over these four plus the Capability Registry (Phase 008 §7).

---

## 6. LIFECYCLES

```text
EXCHANGEABLE ENTITY
  Conceived → Defined → Classified → Listed → Tradable → Deprecated → Retired
  Classification changes are Phase 005 assertions; the entity's identity
  is unaffected by role changes — a room does not become a different room
  because today it is a booking rather than a product.

OFFER
  Draft → Eligible → Published → Active → Exhausted | Withdrawn | Expired
  • Exhausted: allocation policy consumed the scarcity
  • Expired:    validity window closed
  • Withdrawn:  revoked by issuer; existing entitlements are unaffected
                unless the withdrawal policy states otherwise

ENTITLEMENT
  Granted → Active → Suspended ──► Renewed
                     │              ► Expired
                     │              ► Revoked   (breach or policy)
                     │              ► Transferred (F4 permitting)
                     └────────────► Terminated
  Every transition is guarded by a registered Rule (UCI-008) and emits an Event.

BUNDLE
  inherits Exchangeable Entity lifecycle; additionally, member changes are
  versioned, and a member's own retirement does not retire the bundle —
  the bundle's policy determines whether it degrades or fails.
```

---

## 7. GOVERNANCE / SECURITY / EVENTS / APIS

```text
GOVERNANCE
  The Exchangeable Entity is owned by the universe that defines the
  underlying Entity; the Offer is owned by the issuing authority; the
  Entitlement is owned jointly — granted by the issuer, held by the holder,
  governed by policy. Three owners, three accountabilities, no ambiguity,
  because each owns a different artifact rather than a slice of one.

SECURITY
  US-S-01  An offer's consideration is protected data; price manipulation
           is a policy-governed, audited action.
  US-S-02  Entitlement bounds are enforced before capability exercise
           (policy evaluated first, UCL-G01). An entitlement check is not
           a runtime afterthought; it is the precondition.
  US-S-03  Transfer requires the transferability facet to admit it and
           the holder's authority; a transfer outside the facet is void.
  US-S-04  Revocation of an entitlement requires recorded cause
           (a Decision artifact) and triggers all dependent entitlements.
  US-S-05  An offer valid in one context is not valid in another; serving
           an offer outside its context is a compliance violation.

EVENTS
  us.exchangeable.classified       us.exchangeable.reclassified
  us.offer.published               us.offer.withdrawn
  us.offer.expired                 us.offer.exhausted
  us.offer.accepted                us.entitlement.granted
  us.entitlement.renewed           us.entitlement.expired
  us.entitlement.revoked           us.entitlement.transferred
  us.entitlement.suspended
  us.bundle.member.added           us.bundle.member.removed
  us.consideration.quoted          us.consideration.superseded

APIS
  DEFINE-EXCHANGEABLE(entity, facets)  → validated, classified artifact
  CLASSIFY-ROLE(exchangeable)          → commerce role(s), by admission rule
  QUOTE(offer, context)                → consideration as Value relationships
  ACCEPT(offer, holder, context)       → Entitlement + events
  CHECK-ENTITLEMENT(holder, capability, context) → verdict + evidence
  COMPOSE-BUNDLE(members[], offer)     → exchangeable + PART-OF relationships
  TRANSFER-ENTITLEMENT(ent, newHolder) → guarded by F4 and policy
```

---

## 8. DATA MODEL

```text
ExchangeableEntity { identity, entityRef, facetBindings{F1..F7},
                     capabilities[], classifications[], context, policies[],
                     lifecycle, relationships[], knowledge[], lineage }

Offer              { identity, subjectRef, issuer, entitlementSpec,
                     consideration: Value[], eligibility[], validity,
                     stackingPolicy, allocationPolicy, policies[],
                     lifecycle, evidence, context }

Entitlement        { identity, grantor, holder, subjectRef, capabilityRef,
                     bounds{temporal, spatial, contextual, quantitative},
                     conditions[], policies[], lifecycle, evidence }
```

All field types resolve to Tier-1 constructs. `Value[]` is a reference to the Value construct (C-20) — never a scalar, which is the single most important typing decision in this phase.

---

## 9. VALIDATION / EVOLUTION / COMPLIANCE / DISCOVERY / CERTIFICATION

```text
VALIDATION
  V-US-01  every facet binding resolves to a registered facet value
  V-US-02  facet values are jointly admissible (e.g. F7=booking ∧ F2=durable
           is inadmissible — a booking that lasts forever is not a booking;
           the rule is registered, not hard-coded, and may be overridden by
           a domain scheme that ratifies a different pairing)
  V-US-03  every role classification satisfies its taxon's admission rule
  V-US-04  every consideration is a Value with valuer, purpose, unit, context
  V-US-05  no exchangeable entity carries a scalar price field
           (this is a structural defect, not a style issue)
  V-US-06  every offer's validity is a temporal/spatial/contextual window
  V-US-07  every entitlement's bounds are stated; unbounded entitlements
           are inadmissible
  V-US-08  every PART-OF bundle member resolves, and the graph is acyclic
  V-US-09  no construct in this phase introduces a new primitive
           (checked by derivation proof against the Concept Registry)

EVOLUTION
  E-US-01  Adding a commerce role is a taxonomy registration (Phase 005).
           It requires no code change and no primitive.
  E-US-02  Adding a facet requires Foundation Council ratification, because
           facets are the closest thing this phase has to structure.
           It should be rare — most new "types" turn out to be facet values.
  E-US-03  Changing a taxon's admission rule re-validates its instances.
  E-US-04  Superseding an offer does not revoke entitlements already granted.
  E-US-05  An entitlement's bounds may be narrowed only by a policy that
           the grantor is authorised to invoke, and only with recorded cause.

COMPLIANCE
  C-US-01  Tax applicability is derived from classification + context,
           never from a hard-coded rate table.
  C-US-02  Regulatory restrictions attach via the taxon's policies (Phase 005
           §8) and are enforced before capability exercise.
  C-US-03  An entitlement exercised outside its bounds is a compliance
           failure, and is recorded as an audited Event.
  C-US-04  Currency is a registered unit; a price without a registered unit
           is non-compliant (V-MS-01).

DISCOVERY
  D-US-01  Exchangeable entities are discoverable by role, facets,
           classification, and capability.
  D-US-02  Offers are discoverable by subject, context, and eligibility.
  D-US-03  Discovery filters by context: an offer outside the requester's
           context is returned as a reference, never as a quotable price.
  D-US-04  Bundles are discoverable both as wholes and through their members.

CERTIFICATION
  X-US-01  Facet vocabularies are certified by the Foundation Council.
  X-US-02  Commerce taxa are certified by the Commerce universe's authority.
  X-US-03  An offer is certifiable only if its consideration is evidenced
           and its context is resolvable.
  X-US-04  An entitlement is certifiable only if its bounds and conditions
           are machine-checkable — a bound that cannot be evaluated cannot
           be enforced, and therefore cannot be certified.
```

---

## 10. THE EXTENDED PROOF (charter requirement, tested harder)

The charter listed ten nouns. The platform's promise is that *any* commerce noun works the same way. Testing the claim against nouns the charter did not name:

| Noun not in charter | Derivation | New primitive? |
|---|---|---|
| Rental | F7=rental ∧ F2=windowed | No |
| Membership | F7=membership ∧ F2=periodic | No |
| Auction | Offer whose allocationPolicy is ascending-bid | No |
| Reservation | Booking with contingent confirmation | No |
| Gift card | Offer with consideration pre-paid by a third party | No |
| Loyalty point | Value with a registered unit, non-rival, periodic issuance | No |
| NFT / token | Exchangeable Entity, F6=unique, F1=digital, F4 per policy | No |
| Data product | Exchangeable Entity, F1=informational, F3=non-rival | No |
| API call quota | Entitlement, quantitative bounds, F3=bounded-rival | No |
| Airline seat | Booking; F6=unique-in-window; F5=participation | No |
| SaaS seat | Subscription; quantitative bounds on a non-rival capability | No |
| Consultancy retainer | Subscription over a Service-typed exchangeable | No |

Twelve further nouns, zero new primitives. The model is not *configured* to accept these; it is **incapable of refusing** them, because it defines none of them. That is the difference between a flexible schema and a universal one.

---

## 11. WHAT THIS PHASE COST

One honest constraint, and it is significant:

```text
The platform has no opinion about commerce.

It will not tell you what a product "should" cost, that a subscription
must renew monthly, or that a bundle should be cheaper than its parts.
Every such rule is a registered Policy owned by a commerce authority.

Teams arriving with an industry model in hand sometimes read this as a
gap. It is the entire point: the platform supplies the four nodes and
the seven facets; the industry supplies its own meaning. No industry
Lock-In is possible precisely because no industry is preferred — not
even the one that built the platform.
```

---

## 12. CERTIFICATION

```text
Universe:      UCOS Ω∞ — Commerce / Product / Service universes
Document:      UCOS-USPT-DOC-001
Type:          Universal Service Product Taxonomy Constitution
Status:        APPROVED
Coverage:      Exchangeable Entity, seven facets, Offer, Entitlement,
               Bundle by composition; ten charter nouns as registered roles
Primitives Introduced: NONE
Constructs Introduced:  NONE (Exchangeable Entity is a composition of C-01,
                     C-02, C-12, C-20, C-08/C-09, C-16, C-17)
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-CTX-DOC-001` — Universal Context Engine (Phase 007).
Offers now carry prices that mean nothing without a context. Phase 007
specifies the nine context dimensions and how they are computed and merged.
