# PHASE-005 — UNIVERSAL TAXONOMY ENGINE

**Document ID:** UCOS-TAX-DOC-001
**Document Name:** Universal Taxonomy Engine
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-1 / Tier-2
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The charter requires the platform to represent **any product, any service, any industry, any organization, any asset, any capability — through metadata only, with no hard-coded categories.**

That requirement is not satisfiable by having many categories. It is satisfiable only by having **no categories at all in the code**, and by making categorisation itself a governed, registered act. This phase specifies the engine that does that.

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL TAXONOMY ENGINE

The system by which any entity is placed under any classification,
in any number of simultaneously valid taxonomies,
without any category being compiled, enumerated, or hard-coded anywhere
in the platform.

Categorisation is a RELATIONSHIP, not a property.
A category is a REGISTERED ARTIFACT, not a literal.
```

Two sentences do all the work here, and the second is the one that is usually missed:

- **Categorisation is a relationship.** Entities do not *have* categories; they are *related to* taxa. The relationship is asserted by someone, at some time, in some context, with some evidence — and it can be withdrawn.
- **A category is a registered artifact.** "Electronics" is not a string constant. It is an entity with an identity, an owner, an admission rule, a lifecycle, and a lineage.

---

## 3. THEORY

### 3.1 Why Hard-Coded Categories Are Fatal, Not Merely Ugly

A hard-coded category is a claim that the platform knows, in advance, every way the world will need to be sorted. That claim has never survived contact with a second industry. Worse, it is invisible: nothing breaks at the moment of hard-coding, and everything breaks when the third industry arrives and discovers that `category` is a column with an enum.

Hard-coding is therefore treated by this constitution as a **defect class**, not a style choice: it is the only way to violate "No Industry Lock-In" *before* any industry is present.

### 3.2 Trees vs. Graphs

Real classification need not be a tree. A restaurant is simultaneously in `Food Service`, `Hospitality`, `Real-Estate Occupier`, `Employer`, and `Tax-Registrant`. Forcing one primary category destroys the other four.

Therefore the engine models taxonomy as a **labelled directed graph** with:
- typed edges (`BROADER-THAN`, `NARROWER-THAN`, `RELATED-TO`, `INSTANCE-OF`),
- multiple parents permitted,
- cycles prohibited,
- and each edge context-qualified.

### 3.3 Facets Are Not Categories

A facet is an axis of classification that admits no hierarchy: `colour`, `weight class`, `regulatory regime`. Facets are modelled as **attributes with bounded domains**, not as taxa, because forcing every axis into a tree is what produces the bloated, brittle category trees that plague commerce platforms.

```text
Taxon  — hierarchical, governed, admits instances.
Facet  — non-hierarchical, attribute-borne, admits values.
Tag    — free-form assertion, governed by policy, never canonical alone.
```

Three mechanisms, because collapsing them into one is what makes every taxonomy engine either too rigid (taxon-only) or too loose (tag-only).

---

## 4. PRINCIPLES

```text
TX-P1  No category is hard-coded. Category literals in code are defects.
TX-P2  Classification is asserted, never stored as a property.
TX-P3  An entity may be classified under any number of taxa simultaneously.
TX-P4  Every classification assertion is owned, evidenced, and context-qualified.
TX-P5  Every taxonomy is a registered, versioned, certifiable artifact.
TX-P6  Conflict between classifications is resolved by declared precedence,
       never by evaluation order.
TX-P7  No taxonomy is privileged as "the" taxonomy. Multiple schemes coexist.
TX-P8  A taxon's admission rule is expressed over registered attributes only.
```

**TX-P7** is the principle that makes multi-industry operation ordinary. There is no master category tree. A pharmaceutical marketplace and a semiconductor marketplace each register their own schemes, and both are canonical within their envelopes.

---

## 5. META MODEL

### 5.1 Taxonomy Scheme

```text
TaxonomyScheme
├── identity              scheme id, owner, envelope
├── purpose               why this scheme exists (governed by Purpose, FR-07)
├── scope                 what it classifies
├── taxa[]                root taxa (references)
├── relationshipPolicy    which typed edges are permitted
├── multiParentAllowed    default true
├── conflictPolicy        precedence rule for contradictory placements
├── version               immutable, append-only
├── governance            owner + ratifier + certifier
└── lifecycle             DRAFT → PUBLISHED → CERTIFIED → SUPERSEDED
```

### 5.2 Taxon

```text
Taxon
├── identity              canonical taxon id
├── labels{}              per-locale labels — never a single hard-coded string
├── parentTaxa[]          multiple permitted; the graph is not a tree
├── childTaxa[]           COMPUTED inverse — never authored (UCI-003)
├── admissionRule         reference to a registered Rule (C-15)
├── discriminators[]      attributes that distinguish this taxon from siblings
├── attributes[]          attributes mandated for instances of this taxon
├── policies[]            policies that apply by virtue of classification
├── aliases[]             industry synonyms — all resolvable, none canonical
└── lifecycle             PROPOSED → CERTIFIED → DEPRECATED → RETIRED
```

### 5.3 Classification Assertion

```text
Classification
├── entity                the classified artifact
├── taxon                 the registered taxon
├── scheme                which taxonomy scheme this assertion belongs to
├── assertedBy            accountable authority (UCI-006)
├── assertedAt            temporal context (UCI-007)
├── context               under which the assertion is valid (Phase 007)
├── evidence              why the entity satisfies the admission rule
├── confidence            where the classification is inferred, not asserted
├── status                ASSERTED → VALIDATED → EFFECTIVE → WITHDRAWN
└── lineage               supersession chain of this assertion
```

**The `childTaxa` rule.** Authoring an inverse is the most common duplication in platform engineering. `childTaxa` is computed from `parentTaxa`; storing both is a UCI-003 violation and a drift hazard.

---

## 6. HOW THE ENGINE CLASSIFIES ANYTHING

The same six-step path serves products, services, industries, organizations, assets, and capabilities — because the engine does not know or care what it is classifying.

```text
1. INTENT          "classify this entity"
2. SCHEME SELECT   which taxonomy scheme(s) are in scope for this envelope
3. CANDIDATE RANK   taxa whose admissionRule is evaluable over the entity's
                   attributes, ranked by specificity (deeper taxon first)
4. VALIDATE        admission rule evaluated as a registered Rule (C-15)
5. CONTEXT FILTER  is the classification valid in the current context?
6. ASSERT          write the Classification artifact, with evidence + authority
                   ── or REJECT with reasons recorded as an audited Decision
```

For **inferred** classifications the same path runs, with `confidence < 1.0` and `evidence` pointing to the inference record. Inferred classifications never achieve the `EFFECTIVE` status of asserted ones without a ratified confirmation — this is what keeps machine classification auditable rather than merely automatic.

### 6.1 Six Things The Engine Must Classify (charter requirement)

| Target | What is classified | Scheme owned by | Example taxa (registered, not compiled) |
|---|---|---|---|
| Any product | entities under a commerce scheme | Commerce universe | durable-good, consumable-good, digital-good, instrument, model, dataset |
| Any service | entities under a service scheme | Service universe | performed-labour, access-grant, processing, advisory, custodial |
| Any industry | organizations under an industry scheme | Governance universe | extraction, transformation, distribution, care, instruction, mediation |
| Any organization | entities under an organization scheme | Organization universe | sole-operator, collective, institution, network, federation |
| Any asset | entities under an asset scheme | Financial universe | productive, financial, informational, rights-bearing, ephemeral |
| Any capability | capabilities under a capability scheme | Composition universe | computational, informational, physical, cognitive, governance |

**The taxa above are examples of registered content, not architecture.** They are written here for comprehension only. In the platform they are registry entries owned by their universes, replaceable and extendable without code change — and any of them may be replaced by a domain-specific scheme without touching the engine, which is the entire point.

---

## 7. MULTI-DIMENSIONAL CLASSIFICATION

An entity is classified simultaneously along independent schemes, and each scheme is governed independently:

```text
                    ┌── Commercial Scheme
                    ├── Technical Scheme
ENTITY ─────────────┼── Regulatory Scheme
                    ├── Tax Scheme
                    ├── Logistics Scheme
                    ├── Sustainability Scheme
                    ├── Risk Scheme
                    └── Industry Scheme
```

No fixed hierarchy is assumed, and no scheme is primary. A conflict between two schemes' implications is resolved by the **conflict policy registered on the evaluating scope** — not by the order in which schemes happen to be stored.

---

## 8. POLICY AND CLASSIFICATION (The Part Most Engines Get Wrong)

Classification is not merely descriptive. Placing an entity under a taxon **attaches the taxon's policies to the entity**.

```text
Taxon: regulated-medical-device
  ├── mandates attribute:  sterilityMethod, regulatoryClass, conformityEvidence
  ├── attaches policy:     medical-data-handling, traceability, adverse-event-reporting
  └── requires evidence:   conformity certificate from a registered authority
```

So classification is a **governance act with regulatory consequence**, not a tagging exercise. This has three consequences that are built into the engine:

```text
TX-G1  Classification requires an accountable authority (UCI-006).
TX-G2  Classification requires evidence where the taxon demands it.
TX-G3  Withdrawal of a classification requires re-evaluation of every
       policy that was attached through it — and this re-evaluation is
       computed and cascaded, never requested manually.
```

Failing TX-G3 is how platforms end up with entities that are still paying for policies they no longer need, or worse, no longer covered by policies they still need.

---

## 9. LIFECYCLES

```text
TAXONOMY SCHEME
  DRAFT → PROPOSED → PUBLISHED → CERTIFIED → SUPERSEDED
                                        │
                                        └──► DEPRECATED (no new placements)

TAXON
  PROPOSED → CERTIFIED → ADOPTED → DEPRECATED → RETIRED
     │                                            ▲
     └──► REJECTED (admission rule not expressible)│
                                                  │
  Retiring a taxon with live classifications requires either migrating
  each classification to a successor taxon or withdrawing each assertion.
  A taxon with live classifications cannot be retired silently.

CLASSIFICATION ASSERTION
  ASSERTED → VALIDATED → EFFECTIVE ──► WITHDRAWN
                                │
                                └──► SUPERSEDED (re-classified; prior assertion
                                                 retained for lineage)
```

---

## 10. GOVERNANCE / SECURITY / EVENTS / APIS

```text
GOVERNANCE
  Scheme owner:    the universe whose envelope the scheme serves.
  Taxon owner:     the scheme owner, or a delegated Domain Authority.
  Assertion owner: the classifier — which may differ from the entity's owner,
                   and both remain accountable for their own assertions.
  Conflict:        resolved by the evaluating scope's registered conflict policy,
                   escalated to the scheme owner if undeclared.

SECURITY
  TX-S-01  Classification of a protected entity requires authorisation to
           classify within that scheme (policy evaluated first, UCL-G01).
  TX-S-02  Evidence attached to a classification inherits the evidence's
           security posture; a classification cannot launder a protected
           artifact into a public one.
  TX-S-03  Inferred classifications are marked as such and may not be used
           to attach obligations without confirmation.
  TX-S-04  Assertions are append-only; withdrawal is a recorded event.

EVENTS
  tax.scheme.published        tax.taxon.certified
  tax.taxon.deprecated        tax.taxon.retired
  tax.assertion.effective     tax.assertion.withdrawn
  tax.assertion.conflict.detected
  tax.policy.cascade.triggered   ← TX-G3 in operation

APIS
  CLASSIFY(entity, scheme, context)      → admission verdict + ranked candidates
  RESOLVE-TAXON(name | alias | locale)   → canonical taxon
  PATHS(entity)                          → all classification paths, all schemes
  POLICIES-FOR(entity)                   → policies attached via classification
  WITHDRAW(assertion, reason)            → audited, cascades per TX-G3
  SUGGEST-TAXA(entity)                   → inference engine (Phase 010)
```

---

## 11. DATA MODEL

```text
TaxonomyScheme { identity, purpose, scope, taxa[], relationshipPolicy,
                 multiParentAllowed, conflictPolicy, version, governance,
                 lifecycle, descriptors[] }

Taxon           { identity, labels{}, parentTaxa[], admissionRule,
                  discriminators[], attributes[], policies[], aliases[],
                  lifecycle, descriptors[] }

Classification  { entity, taxon, scheme, assertedBy, assertedAt, context,
                  evidence, confidence, status, lineage }
```

No storage types. `labels{}` is a map keyed by registered locale, not a string — a taxon label is knowledge, not a constant, and it changes per linguistic context (Phase 007 §8) without the taxon changing identity.

---

## 12. VALIDATION / EVOLUTION / COMPLIANCE / DISCOVERY / CERTIFICATION

```text
VALIDATION
  V-TX-01  every taxon's admissionRule is a registered Rule (C-15)
  V-TX-02  every discriminators[] / attributes[] entry resolves to a
           registered Attribute (C-05)
  V-TX-03  every policies[] entry resolves to a registered Policy (C-16)
  V-TX-04  the taxon graph is cycle-free
  V-TX-05  childTaxa is computed, not stored
  V-TX-06  no taxon definition contains a hard-coded category literal
           (a literal is only permitted as a registered alias)
  V-TX-07  no two taxa in one scheme are synonyms of each other
  V-TX-08  an entity satisfies every mandated attribute of its taxa

EVOLUTION
  E-TX-01  Moving a taxon in the hierarchy is COMPATIBLE-EXTENDING for
           descendants, but requires re-validation of all classifications
           that relied on the old path.
  E-TX-02  Tightening an admissionRule is COMPATIBLE-NARROWING: existing
           classifications must be re-validated, and failures are reported,
           not silently dropped.
  E-TX-03  Relaxing an admissionRule is COMPATIBLE-EXTENDING.
  E-TX-04  Changing a taxon's meaning requires a new identity (fork).
  E-TX-05  Retiring a taxon requires successor migration or assertion
           withdrawal, computed across all dependents.
  E-TX-06  Every evolution event triggers the policy cascade (TX-G3).

COMPLIANCE
  C-TX-01  An entity subject to a regulatory taxon must carry the taxon's
           mandated evidence; absence is a compliance failure, not a warning.
  C-TX-02  An inferred classification may not ground a compliance claim
           without confirmation.
  C-TX-03  A classification valid in one context is not thereby valid in
           another; compliance claims must cite their context.

DISCOVERY
  D-TX-01  Taxa are discoverable by canonical name, alias, locale label,
           and semantic descriptor.
  D-TX-02  Discovery traverses BROADER-THAN / NARROWER-THAN edges.
  D-TX-03  Discovery honours scheme scope: taxa outside the requester's
           envelope are returned as references, not as canonical placements.
  D-TX-04  Superseded taxa are returned flagged, with their successor.

CERTIFICATION
  X-TX-01  Schemes and taxa are certified by the Certification Body with
           evidence: admission rule expressibility, acyclicity proof,
           duplicate-taxon search, quorum record.
  X-TX-02  A scheme cannot be certified until its owning universe is certified.
  X-TX-03  Revoking a taxon's certification cascades: classifications under
           it lose effectiveness and their attached policies are withdrawn.
```

---

## 13. THE PROOF THAT THE REQUIREMENT IS MET

The charter asked for a taxonomy engine representing any product, service, industry, organization, asset, and capability through metadata only. The proof has four steps:

```text
1. The engine defines no category.
   It defines three mechanisms: taxon, facet, tag.
   None contains a domain noun.

2. Every category is a registered artifact with a lifecycle and an owner.
   Adding a category is registration, not deployment.
   Therefore adding an industry requires no code change, ever.

3. Classification is a relationship, so an entity may hold any number of
   classifications in any number of schemes simultaneously, and each is
   independently governed, evidenced, and withdrawable.

4. Because classifications attach policies, classification is also the
   platform's mechanism for industry-specific governance without
   industry-specific code: the industry arrives as a taxonomy, brings its
   policies, and leaves the engine untouched.
```

A new industry therefore costs: one taxonomy scheme, its taxa, its policies, and a certification. It costs **zero** primitives, zero constructs, zero code, and zero changes to the engine.

---

## 14. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root)
Document:      UCOS-TAX-DOC-001
Type:          Taxonomy Engine Constitution
Status:        APPROVED
Coverage:      Taxonomy meta model, classification engine, multi-dimensional
               classification, classification-to-policy cascade
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-USPT-DOC-001` — Universal Service Product Taxonomy (Phase 006).
Classification now exists. Phase 006 uses it to show that "product", "service",
"subscription", "booking", and "asset" are not types at all — they are roles.
