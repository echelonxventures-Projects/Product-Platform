# PHASE-003 — UNIVERSAL META MODEL

**Document ID:** UCOS-META-DOC-001
**Document Name:** Universal Meta Model
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-0 / Tier-1
**Status:** CANONICAL FOUNDATION

---

## 0. HOW TO READ THIS DOCUMENT

The charter requires seven things about each of twenty-two canonical constructs:

```text
Constitution · Theory · Ontology · Taxonomy · Registry · Lifecycle · Governance
```

Each construct therefore gets **one block** below. The block is deliberately
dense and deliberately uniform — uniformity is how twenty-two independent
definitions remain mutually consistent, and density is how the document avoids
becoming twenty-two separate books.

Fields 1–5, 12, 16–20 of the Canonical Artifact Template (`00-Master-Index.md` §7)
are given once at the phase level in §A–§C below and are **not repeated** per
construct (this is the Density Rule, and it is itself an application of
UCI-003).

---

## A. PHASE-LEVEL FIELDS

### A.1 Purpose

To give each canonical construct a **structure** — not merely a meaning (Phase 002) but a *shape*: what it is composed of, how it is stored as metadata, how it is found, and what permits it to be used. Without a meta model, the ontology is a glossary; with it, the ontology becomes a system from which schemas, APIs, and UIs can be generated (Phase 009).

### A.2 Constitutional Definition

```text
UNIVERSAL META MODEL

The canonical structure of each constitutional construct, expressed
solely in terms of more primitive constructs, such that:
  every construct has one structure,
  no structure duplicates another's expressive role,
  no structure mentions an implementation,
  and every structure is registrable, discoverable, and certifiable.
```

### A.3 Theory

Every construct below is a **reification of a relationship**. "Attribute" is not a thing in the world — it is the naming of a distinction-axis, made into an object so that it can be governed. The whole meta model is the act of **lifting relationships into entities** so that they can be registered. That single move is what makes the platform metadata-driven instead of code-driven: anything that would otherwise be a line of code is instead a registered entity.

### A.4 Principles

```text
MM-P1  Structure is expressed only in primitives.  No implementation nouns.
MM-P2  Every construct is itself an Entity, hence registrable and governable.
MM-P3  Every field of every construct is typed by reference to a construct,
       never by a storage type. (There is no "string" in this document.)
MM-P4  Where two constructs would overlap, the overlap is extracted into a
       third, smaller construct, and both reference it.
MM-P5  Inverses are computed, never stored.
MM-P6  Nothing here is a schema. Schemas are generated derivatives (UCL-C04).
```

### A.5 Security (phase level)

The meta model's security posture concerns **admissibility**, not secrecy. The dangerous operations are all *structural*: registering a construct that duplicates another, introducing a cycle, or widening a construct's meaning under an existing identity. Accordingly the controls are validation (§C), governance separation (Phase 001 §7.1), and append-only lineage — not encryption. Encryption applies to *instances*, which are governed by the Entity and Policy constructs below.

---

## B. THE SHARED SPINE

Every construct below carries these six fields. Stating them once is the single largest duplication the charter would otherwise force.

```text
identity        Identity (C-02)    globally unique, UCOS-CPT-META-…  (Phase 001 §8)
classification  Classification     paths into the Taxonomy Registry (Phase 005)
governance      Governance (C-29)  one canonical owner, ratifying body,
                                  certifying body, change policy
lifecycle       Lifecycle (C-18)   DRAFT → PROPOSED → RATIFIED →
                                  CERTIFIED → DEPRECATED/RETIRED
evidence        Certification      validation results + audit trail
descriptors     Knowledge []       semantic descriptors for discovery
```

**The spine is the reason for §A's Density Rule.** Twenty-two constructs × six shared fields = one hundred and thirty-two fields that would otherwise be restated one hundred and thirty-two times, each a UCI-003 violation.

---

## C. VALIDATION / EVOLUTION / COMPLIANCE / DISCOVERY / CERTIFICATION (phase level)

```text
VALIDATION      V-MM-nn per construct below, plus universal:
  V-MM-00  every field type resolves to a registered construct
  V-MM-01  no construct duplicates another's structural role
  V-MM-02  no construct references an unregistered construct
  V-MM-03  the construct graph is acyclic (UCI-014)

EVOLUTION       Universal:
  E-MM-00  a construct's identity is permanent; meaning changes require
           a new identity and supersession (Phase 001 §6)
  E-MM-01  adding a field is COMPATIBLE-EXTENDING
  E-MM-02  removing a field is INCOMPATIBLE (requires new identity)
  E-MM-03  widening a field's semantics is INCOMPATIBLE
  E-MM-04  every change re-certifies all dependents (computed, not negotiated)

COMPLIANCE      Universal:
  C-MM-00  an instance is compliant iff every construct it uses is CERTIFIED
           and its context resolves (Phase 007)
  C-MM-01  a construct used outside its registered scope is non-compliant

DISCOVERY       Universal:
  D-MM-00  constructs are discoverable by name, alias, descriptor, and
           DERIVES-FROM traversal
  D-MM-01  discovery honours supersession and scope

CERTIFICATION   Universal:
  X-MM-00  by the Certification Body, with validation evidence + quorum record
  X-MM-01  revocation cascades to all dependent constructs and compositions
```

---

## D. THE TWENTY-TWO CANONICAL CONSTRUCTS

### 1. ENTITY — `C-01`

```text
CONSTITUTION  An existent apprehensible as one thing.
THEORY        Existence + Distinction. The widest construct: everything,
              including every other construct in this document, is an Entity.
              Universality is achieved not by a grand taxonomy of types but
              by refusing to type at this layer at all.
ONTOLOGY      derives: FR-01 Existence + FR-02 Distinction
              relates: IDENTITY (has), CLASSIFICATION (under), RELATIONSHIP (in)
TAXONOMY      by reference only — the Entity construct defines NO subtypes.
              Subtypes are registered classifications, never compiled kinds.
REGISTRY      Entity Registry (instances)
LIFECYCLE     Created → Active → Suspended → Merged | Split → Archived
GOVERNANCE    owned by the Domain Authority of the universe that instantiated it
META MODEL    Entity { identity, classification[], context, attributes[],
                      relationships[], capabilities[], state, lifecycle,
                      governance, security, lineage, knowledge[] }
              ─ NOTE: `attributes`, `relationships`, `capabilities` are
                collections of registered objects, not inline values.
```

**Why it matters most:** the single most consequential decision in the platform. Because Entity carries no type, there is no place to hard-code "product", "order", or "patient". Every such thing enters as a classification. This is the precise mechanism by which "No Hard-Coded Business Logic" is satisfied rather than asserted.

### 2. IDENTITY — `C-02`

```text
CONSTITUTION  A distinction of an entity preserved across change.
THEORY        Distinction + Change. Identity is not a key and not a name;
              it is a *stability claim*. External identifiers are assertions
              *about* identity, never identity itself.
ONTOLOGY      derives: FR-02 + FR-04
              relates: ENTITY (of), EVENT (persisted by — identity is what
                        makes a change count as a change *of* something)
TAXONOMY      Canonical / External / Regulatory / Industry / Alias
REGISTRY      Identity Registry; canonical ids minted by the Registry Office
LIFECYCLE     Minted → Bound → Reassigned (rare, audited) → Retired
GOVERNANCE    canonical ids: Registry Office; aliases: owning Domain Authority
META MODEL    Identity { canonicalId, aliases[], externalIds[], mintedAt,
                         binding, proofOfUniqueness }
```

**Validation:** V-ID-01 canonicalId globally unique. V-ID-02 every alias resolves to exactly one canonical id. V-ID-03 an external id may be rebound only with audited Decision evidence. Two entities sharing one canonical id is a constitutional failure (UCI-001).

### 3. CLASSIFICATION — `C-10`

```text
CONSTITUTION  The act or result of grouping entities by shared attribute-values.
THEORY        Attribute + Relationship. Classification is NOT a property of an
              entity; it is a relationship asserted between an entity and a
              taxon. This is the second most consequential decision in the
              platform and is developed fully in Phase 005.
ONTOLOGY      derives: C-05 Attribute + C-04 Relationship
              relates: TAXONOMY (within), ENTITY (applied to)
TAXONOMY      Single / Multiple / Faceted / Polyhierarchical
REGISTRY      Classification Registry (assertions)
LIFECYCLE     Asserted → Validated → Effective → Withdrawn
GOVERNANCE    classification assertions are owned by the classifier,
              not by the entity's owner — the two may differ, and both are
              accountable for their own assertion
META MODEL    Classification { entity, taxon, evidence, assertedBy,
                               assertedAt, context, confidence, status }
```

**Validation:** V-CL-01 the taxon is CERTIFIED. V-CL-02 the entity satisfies the taxon's admission rule. V-CL-03 the assertion is contextually valid (Phase 007). V-CL-04 no entity is simultaneously classified under two mutually exclusive taxa without a discriminating context.

### 4. TAXONOMY — `C-11`

```text
CONSTITUTION  A connected system of classifications ordered by
              distinction-refinement.
THEORY        Classification + Relationship. A taxonomy is a *structure of
              taxa*, and the structure is a graph, not a tree. Enforcing a
              tree is what forces every real-world system into an
              artificial primary hierarchy.
ONTOLOGY      derives: C-10 + C-04
              relates: TAXON (contains), ENTITY (organises)
TAXONOMY      Hierarchical / Polyhierarchical / Faceted / Tag-cloud
REGISTRY      Taxonomy Registry (schemes), Taxon Registry (nodes)
LIFECYCLE     Draft → Published → Versioned → Superseded
GOVERNANCE    schemes: Foundation Council or Domain Authority within envelope
META MODEL    Taxonomy { identity, rootTaxa[], relationships[], policies[],
                         multiParentAllowed, version }
              Taxon      { identity, parentTaxa[], admissionRule,
                           discriminators[], aliases[], localeLabels[] }
```

**Validation:** V-TX-01 the taxon graph is cycle-free. V-TX-02 every taxon has an admissionRule expressible over registered attributes. V-TX-03 no hard-coded category exists anywhere in a taxonomy definition (UCL-F09).

### 5. ATTRIBUTE — `C-05`

```text
CONSTITUTION  A typed, named axis along which entities are distinguished.
THEORY        Distinction + Identity. An attribute is NOT a column. It is a
              dimension of difference, defined once, referenced by every
              entity that varies along it.
ONTOLOGY      derives: FR-02 + C-02
              relates: ENTITY (describes), VALUE (bears), MEASUREMENT (targets)
TAXONOMY      Primitive / Composite / Derived / Reference / Formula / Model
REGISTRY      Attribute Registry (definitions, the single largest registry)
LIFECYCLE     Proposed → Certified → Widely-Adopted → Deprecated
GOVERNANCE    global attributes: Foundation Council; local: Domain Authority
META MODEL    Attribute { identity, semanticType (→ construct, not "string"),
                          unit, domain, cardinality, validationRules[],
                          defaultPolicy, localePolicies, securityPosture }
```

**Validation:** V-AT-01 `semanticType` resolves to a registered construct. V-AT-02 no attribute duplicates another's semantic role. V-AT-03 the domain and validation rules are expressible in the Rule construct. V-AT-04 an attribute's identity never changes its meaning (widening requires a new identity).

**The critical rule:** `semanticType` is a reference to a construct — `Measurement`, `MonetaryValue`, `SpatialPosition`, `TemporalPosition`, `Knowledge`, `Model` — never a storage type. Storage is decided by the generator (Phase 009), which is why the same attribute can become a SQL column, a document field, and a graph property without the ontology knowing or caring.

### 6. RELATIONSHIP — `C-04`

```text
CONSTITUTION  An identifiable relation between two or more entities.
THEORY        Relation + Identity. Relationships are reified so they can be
              governed: typed, dated, evidenced, versioned, revoked.
ONTOLOGY      derives: FR-03 + C-02
              relates: ENTITY (connects), POLICY (governed by)
TAXONOMY      Structural / Dependency / Semantic / Governance / Temporal
REGISTRY      Relationship Registry (types); relationship instances in the
              operational graph
LIFECYCLE      Asserted → Validated → Effective → Suspended → Revoked
GOVERNANCE    type registry: Foundation Council; instances: their owner
META MODEL    Relationship { identity, type, source, target, role[],
                             context, validity, confidence, evidence,
                             governance, lineage }
```

**Validation:** V-RL-01 the type is registered with a stated inverse. V-RL-02 source and target resolve. V-RL-03 the relationship is permitted by policy in the given context. V-RL-04 no self-dependency (the sole exception being the Foundation Registry's bootstrap fixed point).

### 7. CAPABILITY — `C-12`

```text
CONSTITUTION  An entity's power to cause change in a specified way.
THEORY        Relation + Change. Capabilities are the *atoms of composition*
              (Phase 008). An application is not code; it is a certified
              arrangement of capabilities.
ONTOLOGY      derives: FR-03 + FR-04
              relates: ACTION (exercised by), COMPOSITION (composed into),
                       RESOURCE (constitutes a)
TAXONOMY      Computational / Informational / Physical / Cognitive / Governance
REGISTRY      Capability Registry
LIFECYCLE     Proposed → Certified → Composable → Deprecated
GOVERNANCE    capabilities are owned by the universe that provides them and
              certified as composable by the Certification Body
META MODEL    Capability { identity, purpose, contract, inputs[], outputs[],
                           dependencies[], policies[], events[], telemetry,
                           lifecycle, securityPosture }
```

**Validation:** V-CB-01 all dependencies are CERTIFIED capabilities. V-CB-02 the contract references only registered event and policy constructs. V-CB-03 inputs/outputs are typed by construct, not by storage type. V-CB-04 the capability declares no domain noun in its purpose statement.

**Why capabilities, not services:** a service is a *deployment* of a capability; a capability is the power. Naming services here would lock the platform to a runtime shape (UCL-C01).

### 8. POLICY — `C-16`

```text
CONSTITUTION  A purpose-bearing, context-relative, authority-issued body of
              rules and objectives.
THEORY        Rule + Purpose + Context. A policy is what a rule becomes when
              it is issued by an authority, for a purpose, in a context.
              Without context, policy is impossible to evaluate correctly;
              without purpose, it is impossible to explain.
ONTOLOGY      derives: C-15 + FR-07 + C-17
              relates: RULE (contains), ENTITY (governs), CONTEXT (scoped by)
TAXONOMY      Governance / Security / Regulatory / Economic / Operational
              / Ethical
REGISTRY      Policy Registry
LIFECYCLE     Draft → Ratified → Effective → Amended → Superseded
GOVERNANCE    policies are ratified by the authority that owns the scope
              they govern; no policy may be self-certified (GI-4)
META MODEL    Policy { identity, issuer, purpose, scope, contextConditions[],
                      rules[], objectives[], precedence, effectiveFrom,
                      effectiveTo, exceptions[] }
```

**Validation:** V-PL-01 precedence is total and acyclic within a scope. V-PL-02 the policy contradicts no invariant or law above it (UCI-013). V-PL-03 every exception is itself a governed, evidenced rule. V-PL-04 effectiveFrom/To are temporal positions, never hard-coded dates.

**Precedence is by (authority rank, specificity, recency)** — computed at evaluation time, never stored as a rank field. Storing precedence invites drift between the stored order and the constitutional order.

### 9. RULE — `C-15`

```text
CONSTITUTION  A constraint expressed as a conditional over states and actions.
THEORY        Constraint + Change. A rule is the *conditional form* of a
              constraint: antecedent over states, consequent over permitted
              or required actions.
ONTOLOGY      derives: FR-05 + FR-04
              relates: POLICY (within), CONSTRAINT (expresses)
TAXONOMY      Permission / Prohibition / Obligation / Derivation / Validation
REGISTRY      Rule Registry
LIFECYCLE     Draft → Certified → Effective → Superseded
GOVERNANCE    rules are owned by the policy that contains them
META MODEL    Rule { identity, antecedent (state expression),
                    consequent (action expression), modality,
                    severity, remediation, evidence }
```

**Validation:** V-RU-01 antecedent and consequent are expressible over registered constructs only. V-RU-02 no rule may reference a domain noun. V-RU-03 a prohibition and an obligation with the same antecedent must be resolved by precedence, never by evaluation order — evaluation-order dependence is a defect, not a feature.

### 10. CONSTRAINT — `C-14` (= FR-05)

```text
CONSTITUTION  The exclusion of possibilities.
THEORY        Tier-0 primitive, restated at Tier-1 for reference completeness.
              Constraints are the non-normative, context-free form: they say
              what cannot be, before any authority issues a rule about it.
ONTOLOGY      derives: FR-05
              relates: RULE (expressed by), MEASUREMENT (bounds),
                       RESOURCE (constitutes scarcity for)
TAXONOMY      Structural / Domain / Capacity / Temporal / Semantic
REGISTRY      Constraint Registry (embedded in constructs, not standalone)
LIFECYCLE      inherent to its owning construct
GOVERNANCE    owned with its owning construct
META MODEL    Constraint { kind, expression, enforcement: reject|warn|repair,
                          remediation }
```

**Validation:** V-CN-01 the expression is evaluable over registered constructs. V-CN-02 enforcement posture is declared, never defaulted — a silent default is how constraints become unenforceable.

### 11. CONTEXT — `C-17`

```text
CONSTITUTION  The relevant situation within which an evaluation is made.
THEORY        State + Relationship + Purpose. Relevance is purpose-relative:
              the same situation is a different context for different purposes.
              Developed fully in Phase 007.
ONTOLOGY      derives: C-06 + C-04 + FR-07
              relates: POLICY (scopes), EVENT (locates), VALUE (conditions)
TAXONOMY      Identity / Temporal / Spatial / Regulatory / Security /
              Economic / Governance / Linguistic / Reality
REGISTRY      Context Registry (dimension + scheme definitions)
LIFECYCLE      Composed → Resolved → Applied (ephemeral by default;
               durable only when registered)
GOVERNANCE    dimensions: owning universe; composition: the evaluating authority
META MODEL    Context { identity?, dimensionBindings{}, precedence,
                       resolvedAt, purpose, validity }
```

**Validation:** V-CX-01 every dimension resolves to a registered dimension. V-CX-02 context merge is commutative and associative with a declared conflict rule. V-CX-03 no evaluation occurs without an explicit context (UCI-018).

### 12. STATE — `C-06`

```text
CONSTITUTION  The complete set of an entity's attribute-values at one
              position in an ordering.
THEORY        Attribute + Change. A state is a *cross-section*, not a thing.
              It is never stored as an object; it is computed, or it is
              reconstructed from the event log.
ONTOLOGY      derives: C-05 + FR-04
              relates: EVENT (bounded by), LIFECYCLE (admissible under)
TAXONOMY      Initial / Intermediate / Terminal / Exception / Compensating
REGISTRY      not registered — derived; the *admissible* state set of a
              lifecycle is registered
LIFECYCLE     instantaneous — states do not persist; they are re-derived
GOVERNANCE    governed by the entity's lifecycle policy
META MODEL    State { entity, bindings (attribute → value), orderingPosition,
                      provenance }
```

**Validation:** V-ST-01 every state is admissible under the entity's lifecycle (UCI-008). V-ST-02 every value satisfies its attribute's domain and rule set. V-ST-03 a state carries provenance — a state with no provenance is a fabrication.

### 13. EVENT — `C-07`

```text
CONSTITUTION  A transition between states, apprehended as one occurrence.
THEORY        Change + State + Apprehension. Events are the platform's only
              unit of temporal truth: states are derived, events are recorded.
              This is event sourcing, but stated as an ontological position
              rather than as an engineering choice.
ONTOLOGY      derives: FR-04 + C-06 + FR-06
              relates: STATE (between), CONTEXT (occurs in), POLICY (governed)
TAXONOMY      Lifecycle / Domain / Integration / Governance / Audit / Signal
REGISTRY      Event Registry (types and schemas)
LIFECYCLE     Emitted → Persisted → Projected → Archived
GOVERNANCE    event types: owning universe; instances: the emitter
META MODEL    Event { identity, type, subject, payload (typed by constructs),
                      temporalContext, spatialContext, actor, causationId,
                      correlationId[], evidence }
```

**Validation:** V-EV-01 temporal context present (UCI-007). V-EV-02 the transition is admissible under the subject's lifecycle (UCI-008). V-EV-03 payload types resolve to registered constructs. V-EV-04 actor resolves to an accountable authority (UCI-006). V-EV-05 events are immutable; correction is a compensating event, never an edit.

### 14. ACTION — `C-13`

```text
CONSTITUTION  An exercised capability of a purposeful entity.
THEORY        Capability + Purpose + Change. The bridge between the
              descriptive layer and the causal layer: everything that changes
              the world does so as an Action.
ONTOLOGY      derives: C-12 + FR-07 + FR-04
              relates: CAPABILITY (exercises), EVENT (produces),
                       POLICY (authorised by)
TAXONOMY      Atomic / Composite / Compensating / Autonomous
REGISTRY      Action Registry (types); actions are recorded as events
LIFECYCLE     Requested → Authorised → Executing → Completed | Compensated
              | Failed
GOVERNANCE    every action requires an accountable authority (UCI-006) and
              is auditable (UCI-011)
META MODEL    Action { identity, capability, actor, authority, context,
                      inputs, intendedEffect, actualEffect?, policyEvaluation,
                      auditRef }
```

**Validation:** V-AC-01 policy evaluation precedes execution (UCL-G01). V-AC-02 the actor is authorised by the evaluated policy. V-AC-03 the action emits an event on completion or failure. V-AC-04 an autonomous action additionally carries a registered purpose (UCI-020).

### 15. LIFECYCLE — `C-18`

```text
CONSTITUTION  The policy-governed set of states an entity may traverse, and
              the admissible transitions among them.
THEORY        State + Change + Policy. A lifecycle is *where governance and
              time meet*: it is the constraint on how a thing may become
              another thing.
ONTOLOGY      derives: C-06 + FR-04 + C-16
              relates: STATE (admits), EVENT (permits), POLICY (governed by)
TAXONOMY      Simple / State-Machine / Hierarchical / Adaptive
REGISTRY      Lifecycle Registry (definitions)
LIFECYCLE     recursive — a lifecycle has a lifecycle (Draft → Published →
              Superseded), which is the pleasant and unavoidable consequence
              of everything being an Entity
GOVERNANCE    owned by the construct's owning authority
META MODEL    Lifecycle { states[], transitions{from,to,guard,effect}[],
                          initial, terminals[], policies[] }
```

**Validation:** V-LC-01 every transition has a guard expressible as a registered Rule. V-LC-02 at least one terminal state exists. V-LC-03 no state is unreachable from the initial state. V-LC-04 the graph is cycle-free *or* cycles are explicitly designated (a renewal loop is legitimate; an accidental one is not).

### 16. RESOURCE — `C-19`

```text
CONSTITUTION  An entity whose capability is scarce relative to a purpose.
THEORY        Entity + Capability + Constraint + Purpose. Scarcity is not a
              property of a thing; it is a relation between a thing and a
              purpose. Air is not a resource until a purpose makes it scarce.
ONTOLOGY      derives: C-01 + C-12 + FR-05 + FR-07
              relates: CAPABILITY (carries), ACTION (consumed by)
TAXONOMY      Physical / Digital / Cognitive / Temporal / Spatial /
              Attentional
REGISTRY      Resource Registry (allocations, not kinds)
LIFECYCLE     Allocated → Committed → Consumed / Released
GOVERNANCE    allocations are governed by an economic policy
META MODEL    Resource { entity, capability, capacity (Measurement),
                         allocationPolicy, contentionPolicy, scarcityContext }
```

**Validation:** V-RS-01 capacity is a Measurement, with unit and precision. V-RS-02 allocation requires a policy evaluation. V-RS-03 contention has a declared resolution policy (queue, price, auction, priority) — an undeclared contention policy is how systems deadlock.

**Note:** Resource is a *role*, not a type. An entity becomes a resource by allocation under purpose, exactly as an entity becomes a Product by classification (Phase 006).

### 17. VALUE — `C-20`

```text
CONSTITUTION  A purpose-relative magnitude of preference attributed to an
              entity or state in a context.
THEORY        Purpose + Measurement + Context. The most violently violated
              construct in ordinary platform design: value is stored as an
              attribute of a thing, when it is in fact a four-place relation
              (valuer, valued, purpose, context).
ONTOLOGY      derives: FR-07 + C-21 + C-17
              relates: MEASUREMENT (expressed by), CONTEXT (conditioned by)
TAXONOMY      Economic / Utility / Informational / Ethical / Aesthetic
REGISTRY      Value Registry (valuations, by reference)
LIFECYCLE     Quoted → Effective → Superseded
GOVERNANCE    valuations are owned by the valuing authority, never by the
              entity's owner
META MODEL    Value { subject, valuer, purpose, magnitude, unit, context,
                      basis, validity, confidence }
```

**Validation:** V-VL-01 valuer and purpose are present. V-VL-02 magnitude is a Measurement with unit. V-VL-03 context is resolved. V-VL-04 no entity carries a value field — values are relationships (this is the rule that makes dynamic pricing a *non-feature*: it is the only behaviour the construct supports).

### 18. MEASUREMENT — `C-21`

```text
CONSTITUTION  The assignment of a symbolic magnitude to a distinction-axis by
              comparison to a unit under a stated method.
THEORY        Distinction + Apprehension + Constraint. Measurement carries
              the *method* and the *uncertainty*, because a magnitude without
              them is not a measurement — it is a guess.
ONTOLOGY      derives: FR-02 + FR-06 + FR-05
              relates: ATTRIBUTE (targets), UNIT (denominated in),
                       VALUE (constitutes)
TAXONOMY      Direct / Derived / Estimated / Observed / Simulated / Reported
REGISTRY      Measurement Registry; Unit Registry; Method Registry
LIFECYCLE     Observed → Validated → Certified | Rejected
GOVERNANCE    units and methods: Foundation Council (physical) or Domain
              Authority (domain-specific)
META MODEL    Measurement { attribute, magnitude, unit, method,
                           precision, uncertainty, observedAt, observer,
                           instrument, context }
```

**Validation:** V-MS-01 unit is registered (no free-text units — "5.3" without a unit is meaningless). V-MS-02 method is registered. V-MS-03 uncertainty is stated where the method admits one. V-MS-04 magnitudes are convertible along registered conversion paths only; an unregistered conversion is a fabrication.

### 19. TIME — `C-08`

```text
CONSTITUTION  The ordering induced by change.
THEORY        Change. Time is not a clock; a clock is an instrument that
              measures positions in the ordering. The construct is the
              ordering, and the ordering is derived from change — which is
              why the platform has one temporal construct rather than a
              dozen date libraries.
ONTOLOGY      derives: FR-04
              relates: EVENT (orders), STATE (positions), SPACE (co-constitutes
                       ORDERING)
TAXONOMY      Instant / Interval / Duration / Sequence / Recurrence /
              Validity-Window
REGISTRY      Temporal Registry (calendars, reference instants,
              recurrence schemes)
LIFECYCLE     n/a — time is not itself temporally lifecycle-governed; the
              *schemes* are
GOVERNANCE    reference instants and calendars: Foundation Council;
              recurrence schemes: Domain Authority
META MODEL    TemporalPosition { instant | interval, calendar, precision }
            Recurrence     { scheme, anchor, period, bounds, exceptions[] }
```

**Validation:** V-TM-01 every temporal expression is denominated in a registered calendar. V-TM-02 intervals are half-open with a declared convention — ambiguity here is the classic source of off-by-one scheduling defects. V-TM-03 recurrence bounds are declared, not infinite-by-default.

### 20. SPACE — `C-09`

```text
CONSTITUTION  The ordering induced by co-existent distinction — the manifold
              of "alongside".
THEORY        Distinction + Change. Space is the *other* reading of the same
              primitive pair that gives Time (Phase 002 §5.5). Interval and
              region are one construct under two readings.
ONTOLOGY      derives: FR-02 + FR-04
              relates: TIME (co-constitutes ORDERING), ENTITY (locates)
TAXONOMY      Point / Region / Containment / Adjacency / Distance / Coverage
REGISTRY      Spatial Registry (reference frames, coordinate systems,
              jurisdiction geometries)
LIFECYCLE     schemes are lifecycle-governed; spatial positions are not
GOVERNANCE    reference frames: Foundation Council; jurisdiction geometries:
              Governance universe
META MODEL    SpatialPosition { frame, geometry, precision, context }
```

**Validation:** V-SP-01 the frame is registered. V-SP-02 geometry is expressed in the frame's registered vocabulary. V-SP-03 a jurisdiction geometry carries its temporal validity — borders change, which is precisely why geography must not be hard-coded (No Geography Lock-In).

### 21. KNOWLEDGE — `C-22`

```text
CONSTITUTION  A justified, contextualised apprehension of existents, held
              such that it can ground action.
THEORY        Apprehension + Relationship + Context. Knowledge requires
              justification; raw apprehension is signal. The justification
              is what makes it auditable, and auditability is what makes it
              governable.
ONTOLOGY      derives: FR-06 + C-04 + C-17
              relates: MEANING (carries), EVIDENCE (grounded by),
                       INTELLIGENCE (consumed by)
TAXONOMY      Declarative / Procedural / Provenance / Hypothetical /
              Derived / Certified
REGISTRY      Knowledge Registry (Canonical Knowledge Objects)
LIFECYCLE     Asserted → Evidenced → Certified → Refined / Refuted → Archived
GOVERNANCE    knowledge is authored once, referenced everywhere (UCI-003);
              refutation does not delete, it supersedes
META MODEL    Knowledge { identity, subject, content (typed by construct),
                          justification, context, provenance, confidence,
                          status }
```

**Validation:** V-KW-01 justification is present and traceable to evidence. V-KW-02 content types resolve to constructs. V-KW-03 no duplicate knowledge object exists for the same subject + context (UCI-003). V-KW-04 confidence is stated where the knowledge is inferential.

### 22. INTELLIGENCE — `C-25`

```text
CONSTITUTION  The purposeful application of knowledge to select and execute
              actions that move states toward objectives.
THEORY        Knowledge + Purpose + Action. Intelligence is the construct that
              licenses Phase 010 to exist, and it is placed last deliberately:
              it is the *most derived* construct in the meta model, which is
              why an intelligence layer built before the other twenty-one is
              incoherent.
ONTOLOGY      derives: C-22 + FR-07 + C-13
              relates: KNOWLEDGE (consumes), DECISION (produces),
                       POLICY (bounded by)
TAXONOMY      Reactive / Deliberative / Learning / Autonomous / Collective
REGISTRY      Intelligence Registry (models, agents, objectives, alignments)
LIFECYCLE     Proposed → Aligned → Certified → Operating → Suspended
GOVERNANCE    every intelligent action is still an Action (C-13): it requires
              an accountable authority (UCI-006), a registered purpose
              (UCI-020), and full auditability (UCI-011). Intelligence is
              never exempt from governance; autonomy is a *policy parameter*,
              not a privilege.
META MODEL    Intelligence { objective, knowledgeBase[], model (registered),
                             policyEnvelope, autonomyLevel, learningPolicy,
                             alignmentEvidence, auditRef[] }
```

**Validation:** V-IN-01 objective is a registered purpose. V-IN-02 policyEnvelope bounds every action the intelligence may take. V-IN-03 autonomyLevel is declared, with a defined escalation path. V-IN-04 alignmentEvidence is present and verifiable. V-IN-05 no intelligence is self-certifying (GI-4) and no intelligence may amend its own policyEnvelope (UCI-013).

**The alignment invariant, stated plainly:** an intelligence that can modify the policy that governs it has escaped governance. The constitution forbids this structurally — the policy is owned by a different authority than the intelligence, so the intelligence cannot ratify a change to it.

---

## E. CROSS-CONSTRUCT RELATIONSHIPS (THE META GRAPH)

```text
ENTITY ──has──► IDENTITY
       ──under─► CLASSIFICATION ──within──► TAXONOMY
       ──bears──► ATTRIBUTE ──measured by──► MEASUREMENT ──constitutes──► VALUE
       ──in──────► RELATIONSHIP ──typed by──► (Relationship Registry)
       ──carries─► CAPABILITY ──exercised by──► ACTION ──produces──► EVENT
                        │                              │
                        └── constitutes ──► RESOURCE    │
                                                      │
POLICY ──contains──► RULE ──expresses──► CONSTRAINT     │
   │                                                │
   └── scopes ──► CONTEXT ──conditions──► VALUE, POLICY, EVENT
                       ▲
                       │
LIFECYCLE ──admits──► STATE ──bounded by──► EVENT
     │                                    │
     └── positions in ──► TIME / SPACE (both = ORDERING)

KNOWLEDGE ──grounds──► EVIDENCE ──supports──► CERTIFICATION
      │                                          │
      └── consumed by ──► INTELLIGENCE ──bounded by──► POLICY
```

Every arrow is a typed, registered relationship. Every node is a construct in this document. There are no other nodes, and no arrow may be added without registering its type and stating which existing relationship it specialises.

---

## F. WHAT THIS META MODEL COST US (Honest Constraints)

A constitution that lists only its benefits is a brochure. Three consequences of the above are deliberately uncomfortable:

```text
1. You cannot add a field to an Entity. You can register an Attribute.
   The distinction is not pedantic: it is the difference between a
   platform and a schema.

2. You cannot store a price on a product. You can register a Value
   relationship between an offer, a valuer, a purpose, and a context.
   Dynamic pricing then costs nothing, but static pricing costs the same
   nothing — which frustrates teams who expected the platform to have
   opinions about their industry. It does not. That is the point.

3. You cannot make an exception for a domain. Every industry-specific
   construct enters as a classification under a registered taxonomy and
   must satisfy the same validation as everything else. Where an industry
   genuinely needs a new primitive, it must survive the derivation
   recursion in public, before the Foundation Council.
```

---

## G. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root)
Document:      UCOS-META-DOC-001
Type:          Universal Meta Model Constitution
Status:        APPROVED
Coverage:      22 canonical constructs; shared spine; meta graph
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-REG-DOC-001` — Universal Registry System (Phase 004).
The constructs now have structure. Phase 004 gives them a home — one
registry shape, instantiated for every canonical object, describing itself.
