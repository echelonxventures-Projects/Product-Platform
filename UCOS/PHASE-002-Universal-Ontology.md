# PHASE-002 — UNIVERSAL ONTOLOGY

**Document ID:** UCOS-ONT-DOC-001
**Document Name:** Universal Ontology
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-0
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The Foundation Registry (Phase 001) can hold anything. Without an ontology it will hold an unorganised heap of mutually inconsistent definitions, and the platform will reproduce, at the level of meaning, every duplication it was designed to eliminate at the level of code.

The Universal Ontology exists to settle, **once**, what each thing means, and to state the relationships by which meanings combine. It is the semantic content of the Foundation Registry.

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL ONTOLOGY

The single canonical theory of what may be said to be,
composed of:
  a set of Universal Concepts,
  a smaller set of Universal Primitives from which those concepts derive,
  one Canonical Definition per concept,
  a set of Ontological Relationships by which concepts combine,
and a Meta-Ontology that governs how the ontology itself may be extended.

The ontology is not a model of the platform.
The platform is an instance of the ontology.
```

The last line is the load-bearing one. If the ontology were *our* model of *our* platform, it would be a design document. Because the ontology is prior, any system — present or future, ours or not — is an instance of it. That is what makes the platform industry-agnostic rather than merely multi-industry.

---

## 3. THEORY

### 3.1 The Method (the Universal Question, formalised)

For a candidate concept C, construct the derivation:

```text
C = f(c₁, c₂, … cₖ)      where each cᵢ is strictly simpler
```

"Simpler" means: expressible in fewer primitives, or applicable to a strictly larger class of situations. Recurse until every operand is irreducible — until simplification destroys the concept rather than refining it.

The recursion terminates iff there is a finite basis. We claim the basis is seven (§4) and demonstrate the termination by exhibiting derivations for all Tier-1 concepts (§5).

### 3.2 The Criterion for Calling Something Primitive

A concept is primitive iff **removing it reduces expressive power** — that is, some true statement becomes inexpressible — **and** it cannot be defined in terms of the remaining primitives without circularity.

Both halves matter:
- The first half prevents trivial primitives (a concept that is just shorthand).
- The second half prevents duplicate primitives (a concept that is another primitive wearing a different name — a UCI-017 violation).

### 3.3 Why Seven and Not Nineteen

The legacy foundation listed nineteen primitives. Applying §3.1 rigorously, eleven of them are derivable. We do not discard them — they are real, necessary, and load-bearing — we **re-tier** them. This is the difference between pruning and collapsing:

```text
Before:  19 primitives, flat, mutually entangled, several reducible.
After:    7 primitives, 26 derived primitives, each with a stated derivation.
```

The gain is not elegance. The gain is that **every Tier-1 concept now carries a proof of its necessity**, and the acyclicity invariant (UCI-014) becomes checkable instead of aspirational.

---

## 4. UNIVERSAL PRIMITIVES — TIER 0

These are the seven. Each is stated, then defended against the attempt to reduce it further.

### 4.1 EXISTENCE

```text
That something is.
```

**Irreducibility.** Any attempted definition ("that which is perceived", "that which has properties") already presupposes existence in its verb. It is the one concept that appears in every other definition, including the definitions of the concepts used to define it.

**Registration:** `FR-01` · canonical `UCOS-FR-PRIM-0000000001`

### 4.2 DISTINCTION

```text
That something can be told apart from something else.
```

**Irreducibility.** Distinction is prior to identity, type, and attribute, each of which is a *stabilised* or *named* distinction. Without distinction there is one undifferentiated thing and no statement is possible other than "it is".

**Registration:** `FR-02` · canonical `UCOS-FR-PRIM-0000000002`

### 4.3 RELATION

```text
That existents can be connected.
```

**Irreducibility.** Structure is relation. Composition, containment, dependency, and causation are all typed relations. Without relation there is a mere set, and no composition is expressible — which would make Phase 008 impossible in principle rather than merely hard.

**Registration:** `FR-03` · canonical `UCOS-FR-PRIM-0000000003`

### 4.4 CHANGE

```text
That existence and relation can differ across an ordering.
```

**Irreducibility.** State, event, time, process, lifecycle, and evolution are all change under different descriptions (an ordering of states; a single transition; the ordering itself; a governed sequence of transitions; and change applied to the ontology, respectively). Collapsing any of these into Change loses the *governing* or *ordering* aspect, so they survive as Tier-1; but none of them is primitive.

**Registration:** `FR-04` · canonical `UCOS-FR-PRIM-0000000004`

### 4.5 CONSTRAINT

```text
That not all possibilities obtain.
```

**Irreducibility.** Constraint is what makes "must", "cannot", and "may" meaningful. Rule, policy, law, invariant, and validation are constraint in different scopes and with different enforcement postures. Without constraint there is no normativity, hence no governance, hence no trust (which is constraint plus evidence).

**Registration:** `FR-05` · canonical `UCOS-FR-PRIM-0000000005`

### 4.6 APPREHENSION

```text
That a system can represent and respond to existents.
```

**Irreducibility.** This is the minimal, non-anthropocentric form of "knowing" and "observing": a system S apprehends X iff S holds a structure whose states covary reliably with X and S can act on that covariance. Knowledge, meaning, observation, measurement, and modelling are all refinements. Crucially, apprehension does **not** require consciousness, which keeps the ontology usable for instruments, devices, and artificial agents.

**Registration:** `FR-06` · canonical `UCOS-FR-PRIM-0000000006`

### 4.7 PURPOSE

```text
That a system is directed toward preferred states.
```

**Irreducibility.** Purpose is what makes value, decision, ethics, and optimisation expressible. A preferred state is not derivable from existence or change — the universe as described by the other six primitives is indifferent. Purpose is the smallest addition that introduces "should".

Two things follow immediately, and both are important for Phase 010:
- **Value is not objective.** Value is purpose-relative; a different purpose yields a different value for the same state.
- **Intelligence is not computation.** Computation is change under constraint; intelligence additionally requires purpose.

**Registration:** `FR-07` · canonical `UCOS-FR-PRIM-0000000007`

### 4.8 What Was Deliberately Not Made Primitive

| Candidate | Why rejected |
|---|---|
| Identity | A **distinction preserved across change**. Derivable. |
| Reality | The class of existents apprehended as **not model-dependent** — a distinction about apprehension. Derivable. |
| Space / Time | Orderings over distinction and change. Derivable, and derivable *together* (§5.5). |
| State / Event | A cross-section of change; a single transition. Derivable. |
| Relationship | A **reified, identifiable relation**. Derivable. |
| Knowledge / Meaning | Apprehension plus justification plus context. Derivable. |
| Policy / Rule | Constraint plus conditional structure. Derivable. |
| Decision | Selection among alternatives under purpose. Derivable. |
| Intelligence | Purposeful application of knowledge to action. Derivable. |
| Trust | Constraint (expectation) plus evidence. Derivable. |
| Certification | Trust formalised as a registered, verifiable claim. Derivable. |
| Evolution | Change applied to the descriptive layer itself. Derivable. |

---

## 5. UNIVERSAL CONCEPTS — TIER 1 (THE DERIVATION REGISTER)

Each entry: **definition → derivation → registration ID.** The derivation column is the constitutional record required by UCL-D01; a concept without one cannot be registered as canonical (UCL-D03).

### 5.1 The Foundational Set

| # | Concept | Canonical Definition | Derivation | ID |
|---|---|---|---|---|
| 01 | **Entity** | An existent apprehensible as one thing. | Existence + Distinction | `C-01` |
| 02 | **Identity** | A distinction of an entity preserved across change. | Distinction + Change | `C-02` |
| 03 | **Reality** | The class of existents whose distinction does not depend on any particular model. | Distinction + Apprehension | `C-03` |
| 04 | **Relationship** | An identifiable relation between two or more entities. | Relation + Identity | `C-04` |
| 05 | **Attribute** | A typed, named axis along which entities are distinguished. | Distinction + Identity | `C-05` |
| 06 | **State** | The complete set of an entity's attribute-values at one position in an ordering. | Attribute + Change | `C-06` |
| 07 | **Event** | A transition between states, apprehended as one occurrence. | Change + State + Apprehension | `C-07` |
| 08 | **Time** | The ordering induced by change. | Change | `C-08` |
| 09 | **Space** | The ordering induced by co-existent distinction — the manifold of "alongside". | Distinction + Change | `C-09` |
| 10 | **Classification** | The act or result of grouping entities by shared attribute-values. | Attribute + Relationship | `C-10` |
| 11 | **Taxonomy** | A connected system of classifications ordered by distinction-refinement. | Classification + Relationship | `C-11` |
| 12 | **Capability** | An entity's power to cause change in a specified way. | Relation + Change | `C-12` |
| 13 | **Action** | An exercised capability of a purposeful entity. | Capability + Purpose + Change | `C-13` |
| 14 | **Constraint** | The exclusion of possibilities. *(Tier-0, restated at Tier-1 for reference completeness)* | = FR-05 | `C-14` |
| 15 | **Rule** | A constraint expressed as a conditional over states and actions. | Constraint + Change | `C-15` |
| 16 | **Policy** | A purpose-bearing, context-relative, authority-issued body of rules and objectives. | Rule + Purpose + Context | `C-16` |
| 17 | **Context** | The relevant situation within which an evaluation is made; relevance is purpose-relative. | State + Relationship + Purpose | `C-17` |
| 18 | **Lifecycle** | The policy-governed set of states an entity may traverse, and the admissible transitions among them. | State + Change + Policy | `C-18` |
| 19 | **Resource** | An entity whose capability is scarce relative to a purpose. | Entity + Capability + Constraint + Purpose | `C-19` |
| 20 | **Value** | A purpose-relative magnitude of preference attributed to an entity or state in a context. | Purpose + Measurement + Context | `C-20` |
| 21 | **Measurement** | The assignment of a symbolic magnitude to a distinction-axis by comparison to a unit under a stated method. | Distinction + Apprehension + Constraint | `C-21` |

### 5.2 The Cognitive Set

| # | Concept | Canonical Definition | Derivation | ID |
|---|---|---|---|---|
| 22 | **Knowledge** | A justified, contextualised apprehension of existents, held such that it can ground action. | Apprehension + Relationship + Context | `C-22` |
| 23 | **Meaning** | The relation between a representation and that which it is about, as established in a context. | Apprehension + Relationship + Context | `C-23` |
| 24 | **Decision** | The selection of one alternative over others by a purposeful authority. | Purpose + Constraint + Knowledge | `C-24` |
| 25 | **Intelligence** | The purposeful application of knowledge to select and execute actions that move states toward objectives. | Knowledge + Purpose + Action | `C-25` |
| 26 | **Trust** | A justified expectation that another entity will act within a stated constraint. | Constraint + Knowledge | `C-26` |
| 27 | **Certification** | A registered, verifiable claim that an artifact satisfies a stated standard, issued by an authority separate from its owner. | Trust + Identity + Governance | `C-27` |
| 28 | **Evolution** | Change applied to the descriptive layer, preserving referential integrity. | Change + Identity + Relationship | `C-28` |
| 29 | **Governance** | The system of authorities, constraints, and decisions that governs action within a scope. | Constraint + Purpose + Decision + Context | `C-29` |
| 30 | **Contract** | A mutually binding specification of expected behaviour between two authorities. | Constraint + Trust + Relationship | `C-30` |
| 31 | **Evidence** | An artifact that justifies a claim, sufficient to ground trust or certification. | Knowledge + Identity | `C-31` |

### 5.3 Notes on Three Derivations That Carry the Most Weight

**5.3.1 Space and Time are one structure, two orderings.** Both are derived from Distinction + Change. Time is the ordering along which a *single* entity's distinctions differ; Space is the ordering along which *distinct* entities are simultaneously present. The platform therefore does not have a Time module and a Space module with duplicated scaffolding — it has **one Ordering primitive with two readings** (§5.5, Phase 007). This is a concrete collapse, not a slogan.

**5.3.2 Value is tri-relative, not intrinsic.** Value = Purpose + Measurement + Context. It follows that no entity has a value; an entity has a value *for a purpose in a context*. Any architecture that stores "the price" as an attribute of a product has already violated the constitution — which is why Phase 006 treats pricing as a **relationship between an offer, a context, and a unit of measurement**, never as a field.

**5.3.3 Resource requires scarcity and purpose.** A thing is a resource only relative to a purpose. Air is not a resource until a purpose makes its scarcity relevant. This is why Resource is not a type in the data model and never appears as a column: it is a **classification assumed under context**, exactly like Product or Service (Phase 006).

### 5.4 The Full Derivation Lattice

```text
EXISTENCE ──┬───────────────────────────────────────────────────┐
            │                                                   │
DISTINCTION ┼── Identity ── Attribute ── Classification ── Taxonomy
            │        │                                   │
            │        ├── Relationship ── Capability ── Action
            │        │        │              │
            │        │        │              └── Resource (with Constraint, Purpose)
            │        │        │
            │        └── Contract ── Trust ── Certification
            │
RELATION ───┤
            │
CHANGE ─────┼── Time ── Event ── Lifecycle
            │    │        │
            │    └── State ── Context ── Policy ── Rule ── Constraint(=FR-05)
            │                        │
            │                        └── Value (with Purpose, Measurement)
            │
            └── Space ── (with Distinction) ── Reality

APPREHENSION ── Measurement ── Knowledge ── Meaning
                    │              │
                    │              └── Evidence ── Trust
                    │
                    └── Intelligence (with Purpose, Action)

PURPOSE ──────── Value · Decision · Intelligence · Governance · Resource
```

### 5.5 Ordering — the Unification of Space and Time

```text
ORDERING
├── reading TEMPORAL   → Time, Schedule, Interval, Deadline, Validity
└── reading SPATIAL    → Space, Location, Region, Containment, Proximity
```

An interval and a region are the same primitive under different readings. A schedule and a capacity plan are the same structure. A booking (Phase 006) and a spatial reservation are the same object. This single unification removes an entire duplicated subsystem that most platforms build twice without noticing.

---

## 6. ONTOLOGICAL RELATIONSHIPS

Relationships are **first-class, registered objects** (concept `C-04`). The ontology defines the base vocabulary; extensions are registered in the Relationship Registry (Phase 004) and must cite a base relationship they specialise.

### 6.1 Base Relationship Vocabulary

| Relationship | Reading | Inverse | Notes |
|---|---|---|---|
| `IS-A` | X is a kind of Y | `SUBSUMES` | Taxonomic; transitive. |
| `PART-OF` | X is a component of Y | `CONTAINS` | Meronomic; transitive; used for composition. |
| `DERIVES-FROM` | X is defined in terms of Y | `DERIVES` | Semantic; acyclic; terminates at Tier-0. |
| `DEPENDS-ON` | X requires Y | `REQUIRED-BY` | Ordering; must be declared, verified acyclic. |
| `CLASSIFIED-AS` | X is placed under taxon T | `CLASSIFIES` | Asserted, not stored. Phase 005. |
| `GOVERNED-BY` | X is subject to policy P | `GOVERNS` | |
| `OWNS` | X holds canonical authority over Y | `OWNED-BY` | Exactly one owner per artifact (UCI-002). |
| `REFERENCES` | X cites Y without depending on it | `REFERENCED-BY` | Weakest link; severable. |
| `SUPERSEDES` | X replaces Y | `SUPERSEDED-BY` | Retains resolvability. |
| `CONSUMES` / `PRODUCES` | capability flow | — | Used in composition (Phase 008). |
| `OCCURS-IN` | event occurs in context | — | UCI-007 ground. |
| `MEASURES` | measurement targets attribute | — | |

### 6.2 Relationship Integrity Rules

```text
R-01  Every relationship is itself an Entity (C-01) and therefore
      identifiable, versioned, and governable.
R-02  No relationship may be created without a registered type.
R-03  IS-A must form a forest (multiple inheritance through
      classification paths is allowed, but the taxonomy must remain
      cycle-free).
R-04  DERIVES-FROM must terminate at Tier-0 (UCL-D02).
R-05  The inverse of a relationship is derivable and therefore is
      never stored separately (UCI-003).
```

Rule R-05 is worth emphasising: storing an inverse is the most common and most avoidable duplication in platform engineering.

---

## 7. META-ONTOLOGY

```text
META-ONTOLOGY

The ontology of the ontology: the theory of how the Universal Ontology
itself may be described, extended, and certified.
```

### 7.1 Meta-Concepts

```text
Concept          — a unit of meaning, with one canonical definition
Classification   — how concepts are grouped
Relationship     — how concepts connect
Constraint       — what a concept cannot be
Context          — where a concept's meaning is bounded
Meaning          — what a concept is about
Authority        — who may define a concept
Lifecycle        — how a concept is born, changed, retired
Evolution        — how a concept may be replaced without breaking meaning
```

### 7.2 The Meta Principle (the chain that drives everything)

```text
If it exists,           it must be describable.
If it is describable,   it must be registrable.
If it is registrable,   it must be discoverable.
If it is discoverable,  it must be composable.
If it is composable,    it must be governable.
If it is governable,    it must be certifiable.
```

This chain is not rhetoric. It is the **derivation of the phase order**:
describable → ontology (002); registrable → registry (004); discoverable →
discovery (004/010); composable → composition (008); governable → governance (002/004); certifiable → certification (all phases). Every phase exists because the previous phase made its precondition satisfiable.

### 7.3 Meta-Ontology Rules

```text
M-01  No concept may be added to the ontology without a derivation chain.
M-02  No concept may be added if an existing concept expresses it.
M-03  No concept's canonical definition may be changed; it may only be
      superseded by a new concept with a new identity.
M-04  Every extension to the ontology must state which meta-concept
      it extends and how.
M-05  The ontology is federable: a Domain Authority may extend it
      within its envelope, but extensions are not canonical outside it
      unless ratified by the Foundation Council.
```

---

## 8. PRINCIPLES (as embodied by this phase)

```text
Ontology First       — meaning is settled before structure, always.
Knowledge Once       — one concept, one definition, one registry entry.
No Duplication       — derivations replace restatements.
No Orphan Artifacts  — every concept has a derivation, hence a parent.
No Circular Deps     — the derivation lattice is a proof-carrying DAG.
Generalise Aggressively — a concept that mentions a domain noun is not a concept.
```

---

## 9. REGISTRIES

This phase seeds three registries (all defined as *registry types* in Phase 004; their content begins here):

| Registry | Holds | Seed |
|---|---|---|
| Primitive Registry | the 7 Tier-0 primitives | `registries/primitive-registry.json` |
| Concept Registry | the 31 Tier-1 concepts | `registries/concept-registry.json` |
| Relationship Registry | the base relationship vocabulary | Phase 004 §6 |

Note the discipline: the Primitive Registry holds **only seven** entries. If it ever holds eight, either a genuine irreducible was found (Assembly ratification required) or a duplication has occurred (UCI-017 violation). The smallness of that file is a quality signal, not a limitation.

---

## 10. LIFECYCLE, GOVERNANCE, SECURITY, EVOLUTION

```text
LIFECYCLE   A concept is DRAFT → PROPOSED → RATIFIED → CERTIFIED
            → (eventually) SUPERSEDED. Concepts are never deleted and
            never silently redefined (M-03). Supersession preserves
            resolution for all dependents (Phase 001 §6).

GOVERNANCE  Tier-0 concepts:  Constitutional Assembly only.
            Tier-1 concepts:  Foundation Council.
            Domain extensions: Domain Authority, non-canonical outside
            its envelope (M-05).

SECURITY    The ontology's integrity posture is maximal-and-public:
            it is tamper-evident rather than secret. Attacks of concern
            are semantic (redefinition, circularity, duplication) not
            confidentiality-based. Validation rules V-ON below are the
            primary control.

EVOLUTION   See Phase 001 §6. Special case: because concepts are
            referenced by definition rather than by value, a superseded
            concept continues to mean exactly what it always meant.
            Meaning is immutable; only admissibility changes.
```

---

## 11. APIs / EVENTS / DATA MODEL

```text
APIS        DEFINE(concept) → admits or rejects with derivation proof
            RESOLVE(name|id) → canonical concept
            DERIVATION(id) → ordered chain to Tier-0
            SIMILAR(intent) → ranked concepts        (Phase 010)
            SPECIALISE(base, discriminator) → new registered subtype

EVENTS      ont.concept.admitted
            ont.concept.rejected
            ont.concept.superseded
            ont.concept.deprecated
            ont.derivation.cycle.detected    → constitutional failure
            ont.duplicate.detected           → constitutional failure
            ont.extension.ratified

DATA MODEL  All fields typed by reference to Tier-1 concepts:
            Concept { identity, canonicalName, canonicalStatement,
                      derivationChain[], tier, governance, lifecycle,
                      descriptors[], evidence }
            No storage types appear. Schema is generated (Phase 009).
```

---

## 12. VALIDATION / COMPLIANCE / DISCOVERY / CERTIFICATION

```text
VALIDATION
  V-ON-01  canonicalName is globally unique across all registries.
  V-ON-02  canonicalStatement is one sentence and contains no domain,
           technology, vendor, geography, currency, or language noun.
  V-ON-03  derivationChain is finite, acyclic, and terminates at Tier-0.
  V-ON-04  no concept duplicates another's expressive role
           (checked by a duplicate-concept search, not by name matching).
  V-ON-05  every relationship used is registered, with a stated inverse.
  V-ON-06  inverses are derivable, never separately stored.

COMPLIANCE
  C-ON-01  Any system construct that cannot be traced to a registered
           concept is out of compliance, and is not certifiable.
  C-ON-02  A system construct that re-defines a registered concept in
           its own terms has committed a duplication violation.
  C-ON-03  Compliance is evidenced by the derivation chain, not by
           narrative description.

DISCOVERY
  D-ON-01  Concepts are discoverable by canonical name, alias, and
           semantic descriptor.
  D-ON-02  Discovery honours supersession: superseded concepts are
           returned flagged, never silently as current.
  D-ON-03  Discovery may traverse DERIVES-FROM edges to suggest more
           primitive alternatives — this is how the platform resists
           unnecessary new concepts at the point of authoring.

CERTIFICATION
  X-ON-01  Certified by the Certification Body with evidence:
           derivation proof, duplicate search result, quorum record.
  X-ON-02  Certification is scoped to the ontology's canonical scope.
  X-ON-03  Revocation cascades to dependent concepts and compositions.
```

---

## 13. THE ONE-QUESTION AUDIT

Any reviewer can test this ontology in under a minute, with no tooling:

```text
Pick any construct in the platform. Ask:
   "From what more fundamental concept is this derived?"

If the answer names another construct, recurse.
If the answer names one of the seven Tier-0 primitives, the construct is sound.
If the answer is "it just is", the construct is a violation.
If the answer names a domain noun (order, invoice, patient, listing),
   the construct has escaped the ontology and must be re-derived.
```

---

## 14. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root)
Document:      UCOS-ONT-DOC-001
Type:          Universal Ontology Constitution
Status:        APPROVED
Coverage:      7 Tier-0 primitives, 31 Tier-1 concepts,
               base relationship vocabulary, meta-ontology
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-META-DOC-001` — Universal Meta Model (Phase 003).
The ontology says what concepts *mean*. Phase 003 says what a concept *is* —
structure for each of the twenty-two canonical constructs the charter names.
