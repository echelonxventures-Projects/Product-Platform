# PHASE-009 — UNIVERSAL GENERATION ENGINE

**Document ID:** UCOS-GEN-DOC-001
**Document Name:** Universal Generation Engine
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-3
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The charter requires generators for:

```text
Database Schemas · APIs · Events · UI · Documentation
Policies · Workflows · Knowledge Graphs
```

— generated from metadata and ontology.

This phase is the mechanism by which "Generation Over Manual Construction" stops being an aspiration. It is also the phase that finally answers the objection every architect raises on first reading: *"a metadata-driven platform sounds elegant, but who writes the schema?"*

**Nobody writes the schema. The schema is a derivative, and derivatives are generated.**

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL GENERATION ENGINE

A set of registered, certified, replaceable generators, each of which is a
semantics-preserving transformation from canonical metadata into an artifact
in a target space.

A generated artifact is a DERIVATIVE. It holds no truth, defines no identity,
and may not be edited by hand. When the metadata changes, it is regenerated.
```

### 2.1 The Three Laws That Make It Safe

```text
UCL-C03   Generators are semantics-preserving functors from ontology to a
          target space.
UCL-C04   Generated artifacts are derivatives, not canonical; they hold no
          independent truth.
UCL-C05   No generated artifact may be edited by hand. It is regenerated
          from metadata.
```

UCL-C05 is the law that fails first in practice and matters most. The moment a generated schema is hand-edited, it has become an unregistered source of truth, referential integrity is broken (UCI-005), and the platform now has two descriptions of the same thing that will diverge — quietly, and then catastrophically.

---

## 3. THEORY

### 3.1 The Truth Asymmetry

```text
Metadata  is canonical.   It is registered, owned, versioned, certified, audited.
Artifacts are derivative. They are material, disposable, reproducible.
```

The asymmetry is total and it is what the rest of the architecture depends on. A database schema is *a rendering of part of the ontology for a particular storage engine*. There is no such thing as "the schema" — there are renderings, one per target space, and all of them are downstream of the same metadata.

### 3.2 A Generator Is a Functor

The word is used deliberately and it carries a precise obligation. A functor must preserve structure. Concretely, a generator must preserve:

| Must be preserved | Failure if not |
|---|---|
| **Identity** — every artifact traces to its metadata source | orphans; unauditable artifacts |
| **Type** — construct types map to target types via a registered mapping | silent type coercion; semantic drift |
| **Constraint** — validation rules survive into the target | rules that exist in metadata but not in the artifact |
| **Relationship** — relationships become target-appropriate links | broken referential integrity |
| **Cardinality** — 1:1 / 1:N / N:M preserved | data model drift from intent |
| **Lifecycle** — state machines survive into the target | runtime behaviour inconsistent with metadata |

A generator that preserves five of six is not "mostly correct"; it is **uncertifiable**, because the generated system's behaviour would contradict its own description.

### 3.3 Why This Is What Ends Vendor and Technology Lock-In

```text
Lock-in is not a contract problem. It is a *canonicity* problem.

A platform is locked into a database when the database holds the truth,
because then the truth speaks that database's dialect.

In this architecture the truth lives in metadata. The database holds a
derivative. Replacing the database is replacing a generator — a registered,
certified, replaceable artifact — and regenerating.

The same argument applies to API styles, message brokers, UI frameworks,
cloud providers, and languages. Each is a target space. Each has a generator.
None is canonical.
```

This is the concrete mechanism behind every "No … Lock-In" principle in the charter: **nothing downstream of the metadata can hold the platform hostage, because nothing downstream of the metadata is true.**

---

## 4. PRINCIPLES

```text
GN-P1  Every artifact is generated from registered, certified metadata.
GN-P2  Every generator is itself a registered, certified, replaceable artifact.
GN-P3  Generators preserve the six structural properties of §3.2, or are
       refused certification.
GN-P4  Generated artifacts are reproducible: same metadata + same generator
       version ⇒ identical artifact, bit-for-bit.
GN-P5  Hand-editing a generated artifact is a defect, detectable and
       reportable by the integrity checker.
GN-P6  Generation is policy-governed: who may request a generation, for which
       targets, under which context, is itself registered policy.
GN-P7  Every generated artifact carries its provenance: source metadata,
       generator identity, generator version, and a content attestation.
GN-P8  Multiple generators may target the same space; the choice is a
       deployment decision recorded in the deployment contract, never a
       property of the metadata.
```

**GN-P4** (reproducibility) is the property that makes hand-editing detectable: a regenerated artifact that differs from the deployed one has either been edited (defect) or the metadata has drifted without re-generation (defect). Both are found mechanically.

---

## 5. GENERATOR META MODEL

```text
Generator
├── identity                  UCOS-GEN-TRF-…
├── sourceModel               which registered construct(s) it reads
├── targetSpace               which space it writes (see §6)
├── transformation            the mapping, declared, not procedural prose
│      ├── typeMapping[]      construct type → target type
│      ├── relationshipMapping[]
│      ├── constraintMapping[]
│      ├── cardinalityMapping[]
│      ├── lifecycleMapping[]
│      └── preservationProof  evidence for §3.2's six properties
├── inputs[]                  metadata registries it consumes
├── outputs[]                 artifact kinds it produces
├── policies[]                generation policy, access policy, provenance policy
├── dependencies[]            other generators (e.g. UI generator needs API gen)
├── provenanceScheme          what attestation it embeds
├── lifecycle                 PROPOSED → CERTIFIED → COMMISSIONED → SUPERSEDED
├── governance                owner, ratifier, certifier
├── evidence                  preservation proof + test vector results
└── descriptors[]             for the Discovery Engine
```

### 5.1 Generation Request

```text
GenerationRequest
├── identity
├── subjectRef                the composition / registry / construct to render
├── generator                 identity + version
├── targetSpace + variant     e.g. "relational-storage / dialect-4"
├── context                   the context of the request (Phase 007)
├── policyEvaluation          authorisation to generate (GN-P6)
├── provenance                requester, authority, time
└── output                    artifact + attestation + integrity hash
```

### 5.2 Generated Artifact

```text
GeneratedArtifact
├── identity                  derivative identity, not canonical
├── subjectRef                → canonical metadata source
├── generator + version       exact provenance
├── targetSpace + variant
├── contentAttestation        hash + preservation summary
├── generatedAt               temporal context
├── status                    GENERATED → DEPLOYED → STALE → REGENERATED
└── forbidden                 edit history — there is none, by construction
```

---

## 6. THE TARGET SPACES AND THEIR GENERATORS

### 6.1 Database Schema Generator
```text
Reads:  Entity, Attribute, Relationship, Constraint, Lifecycle, Taxonomy
Writes: storage schemas in the registered dialect of a registered engine
Preserves:
  construct type   → column/document/graph type, via typeMapping
  relationship     → foreign key / reference / edge, per cardinality
  constraint       → declared constraints, incl. check rules from Rule (C-15)
  lifecycle        → state column or event-sourced projection, per policy
  classification   → either typed tables (if the dialect supports typing)
                     or a classification-path index — the choice is a
                     generator variant, not a metadata property
Consequence: "No Technology Lock-In" is satisfied because the storage engine
  is a generator parameter. The ontology has never heard of SQL, and
  therefore SQL cannot constrain what the platform may express.
```

### 6.2 API Generator
```text
Reads:  Capability, CapabilityContract, Construct definitions, Event, Policy
Writes: interface contracts in the registered style of a registered protocol
Preserves:
  contract inputs/outputs   → request/response shapes
  obligations/prohibitions  → enforcement annotations, never advisory comments
  events                    → event contract surface
  policy                    → authorisation requirements on each operation
Consequence: protocol style (RPC / resource / graph / message) is a generator
  variant. The capability contract is canonical; the wire form is not.
```

### 6.3 Event Generator
```text
Reads:  Event (C-07), Lifecycle, Action, Context dimensions
Writes: event schemas, topic/registry registrations, ordering guarantees
Preserves:
  payload types        → registered construct types, never free fields
  temporal context     → required field (UCI-007)
  causation            → causationId / correlationId lineage
  admissibility        → the event is only canonical if its Reality context
                         is `actual` (Phase 007 §5.9)
Consequence: a simulated event is structurally distinguishable from a real
  one, because the generator refuses to omit the dimension.
```

### 6.4 UI Generator
```text
Reads:  Construct, Attribute, Taxonomy, Capability, Context (esp. Linguistic)
Writes: interface definitions in the registered framework's vocabulary
Preserves:
  attribute semantics   → the appropriate control per construct type
                          (a Measurement is not rendered like a text value)
  taxonomy              → navigation, facets, and classification surfaces
  context               → locale, units, formats, and reality mode
                          (a `simulated` context is rendered visibly as such)
  capability            → affordances bound to authorised capabilities only
  policy                → an unauthorised affordance is not rendered hidden —
                          it is not generated at all
Consequence: "No Language Lock-In" is satisfied because locale is an input;
  the generator reads per-locale labels from registered artifacts, so a new
  language adds labels and regenerates, adding no code.
```

### 6.5 Documentation Generator
```text
Reads:  every registry; the Canonical Artifact Template (Phase 000 §7)
Writes: constitutional documents, API references, data dictionaries,
        compliance packs, audit packs
Preserves:
  canonical definitions verbatim — the generator may never paraphrase a
  definition, because paraphrase is duplication (UCI-003)
  provenance         → every statement cites its registry entry
  supersession       → documents mark superseded content
Consequence: this document itself is a candidate for regeneration, and the
  same rule applies to it — any hand-edit that diverges from the registry
  is a defect.
```

### 6.6 Policy Generator
```text
Reads:  Policy, Rule, Constraint, Context, Governance bodies, Precedence scopes
Writes: enforceable policy bundles in the registered enforcement engine's form
Preserves:
  modality           permission / prohibition / obligation preserved explicitly
  precedence         authority rank → specificity → recency, computed at
                     evaluation, not flattened into an integer
  context conditions → remain first-class, never compiled away
  exceptions         → remain governed rules with evidence
Consequence: policy portability is real — replacing the enforcement engine
  is replacing a generator.
```

### 6.7 Workflow Generator
```text
Reads:  Composition, Lifecycle, Action, Capability bindings, failure policies
Writes: executable workflow definitions for the registered runtime
Preserves:
  lifecycle guards   → transition guards remain rule-evaluated, not inlined
  failure policies   → fail / degrade / retry / compensate survive intact
  compensation       → compensating actions generated alongside their
                       counterparts, never as an afterthought
  policy envelope    → strictest-of-parts (CM-P4) enforced in the generated
                       workflow, not hoped for
Consequence: a workflow runtime is a target space, not a partner of the
  platform. Replacing it regenerates the workflows.
```

### 6.8 Knowledge Graph Generator
```text
Reads:  all registries; Relationship vocabulary; Taxonomy; Classification
Writes: graph projections — nodes, typed edges, and ontological schemas
Preserves:
  node identity       → every node is a registry entry (Phase 004 §3.3)
  edge typing         → only registered relationship types appear
  classification      → as edges, never as node properties
  supersession        → superseded entries project as flagged nodes with
                        successor edges
Consequence: the knowledge graph *cannot* drift from the registries, because
  it is generated from them. This is the mechanism that resolves the
  ontology/graph divergence failure mode permanently.
```

### 6.9 Generator Composition

Generators depend on generators, forming their own DAG:

```text
API Generator ──► UI Generator (needs the generated contract surface)
Policy Generator ──► Workflow Generator (needs enforceable rules)
Database Schema Generator ──► Event Generator (needs projection shapes)
All ──► Documentation Generator (needs every artifact's provenance)
```

Circular generator dependency is a cycle and is refused (UCI-014), for the same reason as any other dependency: it makes the derivation order undefined.

---

## 7. GENERATION PIPELINE

```text
1. REQUEST            subject + generator + target variant + context
      ↓
2. AUTHORIZATION      policy evaluated in context (UCL-G01)
      ↓
3. METADATA RESOLUTION  resolve the subject's canonical metadata,
                         honouring supersession and scope
      ↓
4. TRANSFORMATION     apply the declared mapping
      ↓
5. PRESERVATION CHECK verify the six properties of §3.2 hold in the output
      ↓
6. ATTESTATION        provenance + content hash + generator version
      ↓
7. PUBLISH            the artifact, marked DERIVATIVE, with a stale-detection
                      subscription to its source metadata
      ↓
8. STALE PROPAGATION  when source metadata changes, the artifact becomes
                      STALE; regeneration is requested by policy, which may
                      be automatic or approval-gated
```

**Step 8 is what makes the architecture live rather than merely clean.** Without stale propagation, metadata and artifacts drift apart within a week. With it, the derivative is guaranteed to follow the canonical — and a deployment that refuses to regenerate is a visible, governed decision rather than an invisible decay.

---

## 8. LIFECYCLE / GOVERNANCE / SECURITY / EVENTS / APIS

```text
LIFECYCLE
  Generator:      PROPOSED → CERTIFIED → COMMISSIONED → SUPERSEDED
                  Certification requires the preservation proof (§3.2) and
                  a test vector suite: known metadata ⇒ expected artifact.
  Generated artifact: GENERATED → DEPLOYED → STALE → REGENERATED | RETIRED
                  Retired artifacts are removed from deployment but their
                  provenance records are permanent (UCI-011).

GOVERNANCE
  Generators are owned by the universe of the target space, certified by
  the Certification Body with preservation evidence. Generation requests
  are authorised by policy in context (GN-P6). No generator is
  self-certifying (GI-4).

SECURITY
  GN-S-01  A generator may only read registries within its certified scope;
           a generator reading outside its scope is a defect.
  GN-S-02  Generators emit provenance attestations that cannot be forged
           by the generator itself — attestation is issued by the
           Certification pipeline, not by the generator (separation of
           powers, GI-1/GI-4).
  GN-S-03  Secrets and credentials are supplied by the deployment contract,
           never embedded in metadata or in generated artifacts.
  GN-S-04  A generated UI does not render unauthorised affordances —
           absence at generation is the security control, not hiding at
           runtime. (Hidden-but-present is the classic UI security defect.)
  GN-S-05  Integrity checking detects hand-edits (GN-P5) and reports them
           as violations; a hand-edited artifact is non-compliant and its
           deployment is a defect.
  GN-S-06  A `simulated` reality context propagates visibly into every
           generated artifact, so simulation cannot leak into operation.

EVENTS
  gen.request.authorized     gen.request.refused
  gen.artifact.generated     gen.artifact.redeployed
  gen.artifact.stale         gen.artifact.regenerated
  gen.artifact.tampered      → constitutional event; security-relevant
  gen.generator.certified    gen.generator.superseded
  gen.preservation.failed    → generator certification void

APIS
  GENERATE(subject, generator, targetVariant, context) → artifact + attestation
  REGENERATE(artifact)                    → after staleness, per policy
  VERIFY(artifact)                        → integrity + provenance check
  REGISTER-GENERATOR(generator)           → admission with preservation proof
  LIST-TARGETS(subject)                   → available target spaces + variants
```

---

## 9. DATA MODEL

```text
Generator         { identity, sourceModel, targetSpace, transformation{
                     typeMapping[], relationshipMapping[], constraintMapping[],
                     cardinalityMapping[], lifecycleMapping[],
                     preservationProof },
                   inputs[], outputs[], policies[], dependencies[],
                   provenanceScheme, lifecycle, governance, evidence,
                   descriptors[] }

GenerationRequest { identity, subjectRef, generator, targetSpace, variant,
                    context, policyEvaluation, provenance, output }

GeneratedArtifact { identity, subjectRef, generator, version, targetSpace,
                    variant, contentAttestation, generatedAt, status }
```

No storage types; `targetSpace` and `variant` are registered classifications, so adding a new database engine is a registration, not a code change to the platform.

---

## 10. VALIDATION / EVOLUTION / COMPLIANCE / DISCOVERY / CERTIFICATION

```text
VALIDATION
  V-GN-01  sourceModel resolves to registered constructs
  V-GN-02  the mapping is total over the constructs it claims to handle
           (a partial mapping is permitted only where explicitly declared
           as out of scope for that target space, with the reason registered)
  V-GN-03  the preservation proof covers all six properties (§3.2)
  V-GN-04  the generator is deterministic: same inputs ⇒ same output
  V-GN-05  the generator writes provenance attestations it did not author
  V-GN-06  the generator embeds no domain noun and no vendor name in its
           declared mapping (UCL-F09)
  V-GN-07  the generator's dependency graph is acyclic

EVOLUTION
  E-GN-01  A generator is superseded, never patched in place; a new
           version is a new version, and deployed artifacts are regenerated.
  E-GN-02  Metadata evolution marks all dependent artifacts STALE; the
           regeneration policy determines whether this is automatic.
  E-GN-03  A target space may be retired only when no deployment contract
           references it; affected compositions must select a successor
           generator.
  E-GN-04  Changing a typeMapping is INCOMPATIBLE for all deployed artifacts:
           they must be regenerated and re-validated, and data migration
           may be required — which is itself generated from the delta
           between the two mappings, not written by hand.

COMPLIANCE
  C-GN-01  A deployed artifact without a valid provenance attestation is
           out of compliance, and is not trusted.
  C-GN-02  A hand-edited artifact is out of compliance (UCL-C05), and its
           divergence is recorded as a security-relevant event.
  C-GN-03  An artifact generated outside the generator's certified scope is
           out of compliance.
  C-GN-04  Compliance evidence for a system includes the generator versions
           that produced its artifacts, because a system is not auditable
           without knowing what produced it.

DISCOVERY
  D-GN-01  Generators are discoverable by source model, target space,
           and variant.
  D-GN-02  Discovery prefers generators already certified for the
           requester's envelope.
  D-GN-03  Artifacts are discoverable *through* their source metadata —
           never independently, because they have no independent existence.

CERTIFICATION
  X-GN-01  By the Certification Body with evidence: preservation proof,
           test vector results, determinism verification, quorum record.
  X-GN-02  Certification is scoped: to a source model set and a target space.
  X-GN-03  Revoking a generator's certification marks all its deployed
           artifacts as requiring regeneration — computed, cascaded, and
           reported.
```

---

## 11. ANSWERING THE OBJECTION DIRECTLY

*"Generated schemas and UIs are always worse than hand-built ones."*

The response has three parts, and the second is the one that usually goes unstated:

```text
1.  It is often false. Hand-built schemas drift from intent precisely because
    nothing forces them to follow it. A generated schema is guaranteed to
    match its metadata; a hand-built one is guaranteed nothing.

2.  Where it is true, the deficiency is in the metadata, not in the
    generation. Fixing the metadata improves every artifact at once —
    schema, API, UI, docs, policies, graph — which is strictly better than
    fixing one artifact and leaving five to drift. This is the real economic
    argument for the approach, and it gets stronger as target spaces
    multiply.

3.  Nothing here forbids hand-crafted artifacts. It forbids hand-edited
    *generated* artifacts. A bespoke artifact is a new registered capability
    or a new generator, admitted through the constitution with a
    preservation proof. The constraint is not "no craft"; it is
    "no unregistered truth."
```

---

## 12. WHAT THIS PHASE ESTABLISHED

```text
1. Nothing downstream of metadata is canonical.
2. Therefore nothing downstream of metadata can hold the platform hostage —
   which is the concrete form of every "No Lock-In" principle.
3. Every target space is reached through a replaceable, certified generator.
4. Generated artifacts are reproducible, attested, and integrity-checked.
5. Staleness propagates, so the derivatives follow the truth automatically.
6. Seven target spaces are specified; a tenth target space is a registration.
```

---

## 13. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root — cross-universe fabric)
Document:      UCOS-GEN-DOC-001
Type:          Generation Engine Constitution
Status:        APPROVED
Coverage:      Generator meta model, preservation semantics, eight target
               spaces, generation pipeline, stale propagation,
               integrity and attestation
Primitives Introduced: NONE
Constructs Introduced:  NONE (Generator is a registered Capability; a
                     Generated Artifact is a derivative Entity)
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-INT-DOC-001` — Universal Intelligence Layer (Phase 010).
Everything needed to act now exists: knowledge, context, action, governance.
Intelligence is the last thing the platform specifies — because it is the
most derived thing there is.
