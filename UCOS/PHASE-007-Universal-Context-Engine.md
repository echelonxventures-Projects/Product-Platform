# PHASE-007 — UNIVERSAL CONTEXT ENGINE

**Document ID:** UCOS-CTX-DOC-001
**Document Name:** Universal Context Engine
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-2
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The charter requires that **all platform behavior be context aware**, and names nine context dimensions. Phase 006 showed why this is not optional: an offer's consideration is a Value, and Value is conditioned by Context (C-20). A price without a context is not a price — it is a number.

The Context Engine exists so that no evaluation in the platform — policy, price, entitlement, classification, recommendation, or governance — is ever performed in an undefined situation.

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL CONTEXT ENGINE

The system that computes, merges, and applies the relevant situation
for any evaluation, across nine registered dimensions, such that:

  no evaluation occurs without a context,
  every context is decomposable into registered dimensions,
  context merging is deterministic, commutative, and associative,
  and conflicts between contexts are resolved by declared precedence,
  never by evaluation order.
```

**Three properties are doing the constitutional work:**

```text
Deterministic   — merging the same inputs always yields the same context.
                  Without this, behaviour is unreproducible and audit is moot.
Commutative     — the merge result does not depend on the order of inputs.
                  Without this, behaviour depends on the order in which
                  middleware happens to run, which is how production systems
                  acquire "seasonal" bugs.
Associative     — grouping of inputs does not matter.
                  Without this, partial pre-merges would change results.
```

Together these make context a **commutative semilattice** — which is not a mathematical flourish but the reason the engine can be distributed and still auditable.

---

## 3. THEORY

### 3.1 Context Is Purpose-Relative (C-17)

The same situation is a different context for different purposes. For a price evaluation, the relevant dimensions are Economic, Temporal, and Regulatory. For an access evaluation, they are Identity, Security, and Governance. Therefore:

```text
Context = Situation filtered by Purpose.
```

An engine that builds "the context" as a single object ignores this and pays for it with irrelevant data in every evaluation and relevant data missing from some.

### 3.2 The Nine Dimensions Are Registered, Not Enumerated

The charter names nine. They are registered in the Context Registry as **dimension definitions**, each owned by its universe. The engine does not contain them. Consequences:

- A tenth dimension is a registration, not a release.
- A dimension may be superseded without touching the engine.
- No dimension is privileged; precedence is declared per scope, per purpose.

### 3.3 Space and Time Are One Construct, Two Readings

Carried forward from Phase 002 §5.5: both dimensions are instances of the **Ordering** primitive. The engine therefore treats "valid from 09:00 to 17:00 on weekdays" and "valid within the delivery zone" through one mechanism, with two readings. A booking and a spatial reservation are the same object (Phase 006 §4.3), and a validity window and a coverage region are the same structure.

---

## 4. PRINCIPLES

```text
CX-P1  No evaluation without an explicit context. (UCI-018)
CX-P2  Every dimension is a registered artifact with an owning universe.
CX-P3  Context is composed, not fetched — it is computed from contributions.
CX-P4  Merge is deterministic, commutative, associative.
CX-P5  Conflict resolution is by declared precedence: authority rank,
       then specificity, then recency. Never by order of arrival.
CX-P6  Precedence is computed at evaluation time, never stored as a field.
CX-P7  A context is ephemeral unless explicitly registered; registered
       contexts are artifacts with owners and lineage.
CX-P8  An evaluation's result is meaningless without the context that
       produced it — so the context is recorded with every result.
```

**CX-P8** is the auditability rule for context, and it is the one most often omitted. A policy verdict that cannot be reproduced is not evidence.

---

## 5. THE NINE CONTEXT DIMENSIONS

Each: constitutional definition, owning universe, and what it conditions.

### 5.1 IDENTITY CONTEXT
```text
Who or what is acting, and what are they acting as.
Owns:   Identity Universe
Holds:   principal identity, authentication strength, asserted roles,
         delegation chain, acting-on-behalf-of, session scope
Conditions: authorisation, personalisation, accountability, entitlement scope
Note:    the acting principal and the beneficial principal may differ
         (an agent acting for a user). Both are carried, separately, and
         each is accountable (UCI-006). Collapsing them into "the user"
         is how delegation-based systems lose auditability.
```

### 5.2 TEMPORAL CONTEXT
```text
When the evaluation occurs, and the temporal validity of everything in scope.
Owns:   Temporal Universe
Holds:   evaluation instant, timezone, calendar, locale-of-time,
         applicable validity windows, business-calendar, recurrence position
Conditions: offer validity, entitlement bounds, policy effectiveness windows,
         tax periods, seasonality
Invariants: present (UCI-007); always denominated in a registered calendar;
         intervals half-open by declared convention (V-TM-02)
```

### 5.3 SPATIAL CONTEXT
```text
Where the evaluation is situated, physically and jurisdictionally.
Owns:   Spatial Universe
Holds:   position, region membership, jurisdiction, delivery reach,
         origin, transit path, applicable jurisdictional validity
Conditions: delivery eligibility, jurisdiction, tax situs, licensing reach,
         currency applicability
Note:    jurisdiction is derived from geometry plus temporal validity —
         borders change, so jurisdiction is a contextual computation,
         never a stored attribute. This is where "No Geography Lock-In"
         is actually enforced.
```

### 5.4 REGULATORY CONTEXT
```text
Which obligations and permissions apply in this situation.
Owns:   Compliance Universe
Holds:   applicable regimes, required consents, mandatory disclosures,
         prohibited actions, licensing prerequisites, data-residency duties
Conditions: admissibility of an action, required evidence, prohibited terms,
         residency of processing
Note:    regulatory context is *attached through classification* (Phase 005 §8).
         An entity is classified under a regulated taxon, and the taxon's
         policies supply the regime. Regulation therefore arrives with the
         industry taxonomy, never as platform code.
```

### 5.5 SECURITY CONTEXT
```text
What the trust posture of this evaluation is.
Owns:   Security Universe
Holds:   trust level, assurance level, channel posture, device posture,
         risk indicators, consent state, classification level of data in scope
Conditions: data access admissibility, encryption requirements,
         step-up authentication, data-minimisation duties
Invariant: every protected object has a posture (UCI-009); policy is
         evaluated before protected access (UCL-G02); trust is never
         implicit (UCL-G01)
```

### 5.6 ECONOMIC CONTEXT
```text
What the exchange conditions are.
Owns:   Financial Universe
Holds:   applicable currency, price basis, tax treatment, tariff regime,
         settlement expectations, account standing, credit posture,
         applicable economic policy
Conditions: consideration computation, currency, discount stacking,
         payment-method eligibility
Note:    currency is a registered unit, never a hard-coded field (V-MS-01).
         "No Currency Lock-In" is satisfied because the unit is metadata
         resolved per evaluation, not a column type.
```

### 5.7 GOVERNANCE CONTEXT
```text
Which authorities and policies have jurisdiction over this evaluation.
Owns:   Governance Universe
Holds:   jurisdictional authority chain, applicable policies, precedence
         scope, ratifying bodies, open disputes, delegation limits
Conditions: policy precedence, authority to act, escalation paths,
         dispute suspension
Note:    an open dispute over a governing artifact may suspend its effect;
         this is registered on the dispute, not inferred at runtime
```

### 5.8 LINGUISTIC CONTEXT
```text
In what language and semantic frame the interaction is conducted.
Owns:   Knowledge Universe (semantics)
Holds:   locale, language, script, measurement system, naming conventions,
         semantic frame, honourifics, date/number formats
Conditions: label resolution, document generation, unit presentation,
         semantic disambiguation
Note:    "No Language Lock-In" is structural: every label in the platform
         is a per-locale map on a registered artifact (V-TX-06, Phase 005 §11),
         never a string constant. Adding a language adds labels, not code.
```

### 5.9 REALITY CONTEXT
```text
In what mode of existence the evaluation is taking place.
Owns:   Existence Universe
Holds:   actual | simulated | hypothesised | projected | training | test
Conditions: admissibility of consequences, persistence of outcomes,
         trust requirements, whether emitted events are canonical
Note:    this dimension is what makes digital twins and simulation
         first-class without a parallel platform: a simulation runs in a
         Reality context of `simulated`, its events are marked non-canonical,
         and no entitlement, price, or obligation created inside it is
         effective outside it. The transition is a context value, not a
         separate system.
```

### 5.10 The Charter's Nine, and One More

The nine above are the charter's list. Reality Context is included within it as specified. The engine admits a tenth — **Computational Context** (execution fabric, region, latency budget, offline posture) — registered, not privileged, and used by the Composition Engine (Phase 008). It is mentioned here only because it exists in the registry; nothing depends on it yet.

---

## 6. CONTEXT META MODEL

```text
ContextDimension
├── identity              canonical dimension id
├── owningUniverse        the authority for its values
├── valueModel            typed by construct (Position, Interval, Regime, …)
├── resolutionPolicy      how a value is determined from contributions
├── conflictPolicy        how competing values are reconciled
└── lifecycle             registered, versioned, certifiable

ContextContribution
├── dimension             which dimension this speaks to
├── value                 the contributed value
├── contributor           accountable authority (UCI-006)
├── authorityRank         for precedence (computed, not stored)
├── specificity           narrower contributions win over broader
├── precedence            declared, per scope and purpose
└── evidence              why this contribution is asserted

Context
├── identity?             present only if registered (CX-P7)
├── purpose               the relevance filter (C-17)
├── dimensionBindings{}   dimension → resolved value
├── precedenceScope       which precedence rules applied
├── resolvedAt            temporal context of the resolution itself (UCI-007)
├── provenance[]          every contribution, retained
└── validity              when this context may be used
```

**`precedence` lives on the contribution, not the context**, and is computed at evaluation time (CX-P6). Storing a precedence number invites drift between the stored order and the constitutional order — the same hazard as storing policy precedence (Phase 003 §8).

---

## 7. THE CONTEXT RESOLUTION PIPELINE

```text
1. INTENT                 what is being evaluated, for what purpose
      ↓
2. SITUATION GATHERING    contributions arrive from: principal, request,
                         environment, classification attachments,
                         governing policies, registered defaults
      ↓
3. PURPOSE FILTER         contributions irrelevant to this purpose are dropped
                         (CX: relevance is purpose-relative)
      ↓
4. DIMENSION RESOLUTION   per dimension: apply resolutionPolicy to the
                         contributing values
      ↓
5. CONFLICT RESOLUTION    precedence = (authorityRank, specificity, recency),
                         computed — the semilattice merge
      ↓
6. VALIDATION             every required dimension is bound; every value
                         satisfies its dimension's value model
      ↓
7. CONTEXT OBJECT         immutable, provenance-bearing, recorded with the
                         evaluation it enabled (CX-P8)
      ↓
8. APPLICATION            passed to policy evaluation, consideration
                         computation, entitlement checking, classification
```

### 7.1 Merge Semantics (why the three properties hold)

```text
merge(c₁, c₂) per dimension:
   if one value is undefined              → the other
   if values agree                        → that value
   if the dimension is set-like           → union
   if the dimension is interval-like      → intersection (the situation
                                            common to both contributions)
   otherwise                              → conflict → precedence
        precedence = compare (authorityRank, specificity, recency)
        tie and still conflicting         → UNRESOLVED → evaluation refuses

UNRESOLVED is a hard stop, not a default. An evaluation that silently
picks a winner is an evaluation whose audit trail cannot be reproduced.
```

The refusal is deliberate and it is the engine's most important property: **it is better to refuse than to guess**, because a guessed context produces a confident, wrong, unauditable result.

---

## 8. CONTEXT AND EVERYTHING ELSE

Where context binds, and what breaks if it is absent:

| Construct | Binding | Failure mode without context |
|---|---|---|
| **Policy** (C-16) | scoped by context | a policy applied everywhere, or nowhere |
| **Rule** (C-15) | antecedent evaluated in context | rules firing on irrelevant facts |
| **Value** (C-20) | conditioned by context | a single global price — i.e. wrong everywhere |
| **Entitlement** | bounds include context | rights valid in the wrong jurisdiction |
| **Classification** | assertions are context-qualified | stale classifications enforced forever |
| **Event** (C-07) | occurs in context | unauditable, unreplayable history |
| **Action** (C-13) | executed in context | unaccountable action |
| **Offer** | validity is a window in context | offers honoured where they were never made |
| **Intelligence** | bounded by policy in context | autonomous action outside its authority |

The last row is the one that carries the most weight in Phase 010: **autonomy is a context-relative property**. An agent autonomous in one context is not thereby autonomous in another, which is why autonomyLevel is resolved per evaluation rather than granted once.

---

## 9. LIFECYCLE / GOVERNANCE / SECURITY / EVENTS / APIS

```text
LIFECYCLE
  Dimension definitions:  PROPOSED → CERTIFIED → SUPERSEDED (registered artifacts)
  Contributions:          asserted → merged → resolved (ephemeral)
  Registered contexts:    DRAFT → CERTIFIED → SUPERSEDED (rare; used where a
                          stable, repeatable situation must be governed)

GOVERNANCE
  Dimensions are owned by their universes; contributions by their contributors;
  precedence scopes by the governing authority of the evaluation scope.
  A dimension's conflictPolicy is ratified by its owning universe and
  certified — it is the rule that determines behaviour, so it is an artifact.

SECURITY
  CX-S-01  Contributions are authored; spoofed contributions are refused.
  CX-S-02  Security context participates in its own resolution — a low-trust
           contribution cannot elevate the security context it helped compose.
  CX-S-03  Context records are retention-classified; they carry identity
           data, so their storage is governed by the regulatory context
           they describe. (Context is self-referential by nature; the
           platform handles this by treating the context record as data
           governed by the resolved regulatory dimension.)
  CX-S-04  A simulated reality context may never be merged into an actual
           one to authorise a real action. This is the firewall between
           simulation and operation, and it is a merge rule, not a
           separate subsystem.

EVENTS
  ctx.dimension.registered     ctx.contribution.refused
  ctx.unresolved.conflict      → hard stop; recorded with both candidates
  ctx.resolved                 (recorded with the evaluation it enabled)
  ctx.registered.durable

APIS
  CONTRIBUTE(dimension, value, authority, precedence)  → contribution accepted/refused
  RESOLVE(purpose, contributions[]) → Context object or UNRESOLVED-with-causes
  EVALUATE-IN(context, artifact)    → verdict + the context that produced it
  REGISTER-CONTEXT(context)         → durable artifact (rare)
  DESCRIBE-DIMENSION(dimension)     → value model, resolution & conflict policy
```

---

## 10. DATA MODEL

```text
ContextDimension   { identity, owningUniverse, valueModel, resolutionPolicy,
                     conflictPolicy, lifecycle, descriptors[] }

ContextContribution{ dimension, value, contributor, authorityRank,
                     specificity, precedence, evidence }

Context            { identity?, purpose, dimensionBindings{}, precedenceScope,
                     resolvedAt, provenance[], validity }
```

`dimensionBindings{}` is a map keyed by dimension identity — never by ordinal or by string literal, so that dimension supersession cannot silently rebind a stored context.

---

## 11. VALIDATION / EVOLUTION / COMPLIANCE / DISCOVERY / CERTIFICATION

```text
VALIDATION
  V-CX-01  every evaluation supplies or resolves a context (UCI-018)
  V-CX-02  every dimension resolves to a registered dimension definition
  V-CX-03  every value satisfies its dimension's value model
  V-CX-04  merge is deterministic, commutative, associative (testable
           property, verified by the Certification Body over random inputs)
  V-CX-05  precedence is computed at evaluation time, never stored
  V-CX-06  UNRESOLVED is a refusal, never a default
  V-CX-07  a context record carries provenance for every contribution
  V-CX-08  a simulated context cannot authorise an actual action (CX-S-04)

EVOLUTION
  E-CX-01  Adding a dimension is registration; the engine is untouched.
  E-CX-02  Changing a dimension's conflictPolicy is COMPATIBLE-NARROWING:
           every stored evaluation's reproducibility must be re-verified.
  E-CX-03  Superseding a dimension requires rebinding every registered
           context that referenced it — computed across dependents.
  E-CX-04  Precedence rules for a scope may be amended only by the
           authority that owns the scope (UCI-013).

COMPLIANCE
  C-CX-01  Any verdict must be reproducible from its recorded context
           and contributions. Non-reproducibility is a compliance failure.
  C-CX-02  An action taken under a context in which it was inadmissible
           is a compliance failure regardless of the actor's authority.
  C-CX-03  Regulatory context must be attached through classification,
           never hard-coded by geography or industry literal.

DISCOVERY
  D-CX-01  Dimensions are discoverable by name, owning universe, descriptor.
  D-CX-02  Discovery honours supersession; a superseded dimension is
           returned flagged with its successor.
  D-CX-03  A registered context is discoverable as an artifact in its own
           right, with lineage.

CERTIFICATION
  X-CX-01  Dimensions are certified by the Certification Body with evidence:
           value-model expressibility, conflict-policy determinism,
           quorum record.
  X-CX-02  A dimension cannot be certified until its owning universe is.
  X-CX-03  The engine itself is certified against the algebraic properties
           (V-CX-04) — this is the one place where a proof, not a review,
           is the required evidence.
```

---

## 12. THE RESULT, STATED AS A WORKED EXAMPLE

One exchangeable entity, three contexts, three different outcomes — with no code differing between them:

```text
Exchangeable Entity:  a seasonal goods listing, F6=time-bounded
Offer:                consideration = Value(magnitude, unit, purpose, context)

CONTEXT A    Temporal: in-season        Economic: currency=registered-unit-1
                                   Regulatory: regime-1 permits sale to minors
             → QUOTE(offer, A) = Value(100, unit-1, …)

CONTEXT B    Temporal: off-season       Economic: currency=registered-unit-1
                                   Regulatory: regime-1 permits sale to minors
             → QUOTE(offer, B) = Value(140, unit-1, …)   or REFUSED
                                   (per the offer's temporal validity)

CONTEXT C    Temporal: in-season        Economic: currency=registered-unit-2
                                   Regulatory: regime-2 restricts to adults
             → QUOTE(offer, C) = Value(96, unit-2, …)
             and the offer's entitlementSpec gains an age-bound condition
             attached by the regulatory regime through classification —
             not by an if-statement.
```

Nothing in the platform changed between A, B, and C. The offer did not change. **Only the context changed, and the context is metadata.** That is what "all platform behavior is context aware" means when it is a structural property rather than a design intention.

---

## 13. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root — cross-universe fabric)
Document:      UCOS-CTX-DOC-001
Type:          Context Engine Constitution
Status:        APPROVED
Coverage:      Nine registered context dimensions, resolution pipeline,
               deterministic-associative-commutative merge, precedence model
Primitives Introduced: NONE
Constructs Introduced:  NONE (Context is C-17; all structure is composition)
Ownership Boundaries:    DEFINED — each dimension owned by its universe
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-CMP-DOC-001` — Universal Composition Engine (Phase 008).
Context is now computable. Phase 008 assembles registered capabilities into
whole systems — and shows that ERP, CRM, and marketplace are recipes, not
software.
