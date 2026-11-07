# PHASE-004 — UNIVERSAL REGISTRY SYSTEM

**Document ID:** UCOS-REG-DOC-001
**Document Name:** Universal Registry System
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-1 / Tier-2
**Status:** CANONICAL FOUNDATION

---

## 1. PURPOSE

The ontology (002) supplies meaning and the meta model (003) supplies structure. Neither is usable until there is **one place where each thing lives**, because meaning that lives in two places is two meanings.

The Registry System exists so that any artifact in the platform can be located by identity, ranked by relevance, trusted by evidence, and depended upon without surprise. It is the operational form of the Knowledge Once Principle.

---

## 2. CONSTITUTIONAL DEFINITION

```text
UNIVERSAL REGISTRY SYSTEM

A single registry fabric in which:
  every registry has one identical meta model,
  every registry is itself a registered artifact,
  every artifact has exactly one canonical registry,
  and no artifact is canonical in two registries.

A registry is not a database. It is a governed, versioned, certified,
discoverable collection of canonical artifacts with a declared authority.
```

The final distinction matters more than it appears. Calling the registry a database invites the thought that its content may be edited in place. It may not: a registry is **append-only and evidence-bearing**, which is what allows it to be trusted by artifacts that cannot inspect its internals.

---

## 3. THEORY

### 3.1 The Self-Description Fixed Point

A registry is describable (UCI-016), therefore registrable, therefore there must be a **Registry of Registries** whose entries are registries — including itself. As in Phase 001, this is a least fixed point, the single permitted self-entry, and it is the mechanism by which the fabric becomes self-describing rather than externally-imposed.

### 3.2 Why One Meta Model For All Registries

Consider the alternative: a Product Registry with its own schema and a Policy Registry with its own schema. Then a rule that references a product must translate between them, and the translation is where the Knowledge Once Principle goes to die. Uniformity is not aesthetic preference; it is the precondition for cross-registry reference without translation layers.

### 3.3 Registry vs. Graph

A registry answers **"where does this canonically live?"**. A knowledge graph answers **"what is this connected to?"**. These are different questions and both are needed. The registry holds identity and authority; the graph holds relationships. The registry's entries are the **nodes** of every graph in the platform. No graph may introduce a node that is not a registry entry — this single rule is what prevents knowledge-graph drift, the failure mode in which ontologies and graphs silently disagree.

---

## 4. PRINCIPLES

```text
RG-P1  One artifact, one canonical registry, one canonical owner.
RG-P2  One meta model for every registry, with no exceptions.
RG-P3  A registry is append-only; correction is supersession, never edit.
RG-P4  Every registry is a registered artifact (the fixed point).
RG-P5  Every registry declares its authority envelope — what it may canonically hold.
RG-P6  No registry may canonicalize an artifact that belongs to another's envelope.
RG-P7  Registry content is public-by-default; secrecy attaches to instances.
RG-P8  Federated copies are read-only projections; there is one master per registry.
```

**RG-P8** deserves a line of its own. Federated multi-master registries create competing truths; the constitution forbids this (UCI-002). Federation is for availability and locality, never for authority. A copy that cannot reconcile must refuse to resolve rather than risk serving a divergent truth (C-FR-03).

---

## 5. REGISTRY META MODEL

One structure. Every registry in the platform — including the Registry of Registries — is an instance of it.

```text
Registry
├── identity
│    ├── registryId              UCOS-REG-<DOMAIN>-<SEQ>
│    ├── canonicalName
│    └── aliases[]
├── authority
│    ├── canonicalOwner          exactly one (UCI-002)
│    ├── ratifyingBody
│    ├── certifyingBody
│    └── envelope                the class of artifacts it may canonically hold
├── schema
│    ├── entryModel              reference to the construct it holds
│    ├── entryConstraints        validation rules, by reference
│    └── relationshipPolicy      which typed relationships its entries may form
├── policies
│    ├── admissionPolicy         what may be registered
│    ├── supersessionPolicy      how entries are replaced
│    ├── retirementPolicy        the live-dependents gate
│    └── accessPolicy            publication scope
├── contracts
│    └── providedContracts[]     the interfaces by which it is consumed
├── dependencies[]               other registries this one requires
├── lifecycle                    DRAFT → PUBLISHED → CERTIFIED → SUPERSEDED
├── security
│    ├── posture
│    └── integrityScheme         hash-chained, append-only
├── audit                        append-only trail of registry operations
├── lineage                      supersession chain of the registry itself
└── discovery
     └── descriptors[]           for the Discovery Engine
```

### 5.1 The Entry Spine (shared by all entries, all registries)

```text
Entry
├── identity          canonicalId, aliases[], externalIds[]
├── definition         canonicalStatement (single sentence)
├── classification     taxonomy paths, by reference
├── ownership          canonicalOwner + ratifyingBody + certifyingBody
├── lifecycle          status + immutable versions[]
├── relationships[]    typed, registered
├── evidence           validation results + certification record
├── securityPosture
└── descriptors[]
```

This spine is the **same** spine as the construct spine (Phase 003 §B). That is not coincidence and not duplication: a registry entry *is* the materialisation of an artifact whose structure was defined in Phase 003. Stating it twice would be a violation; stating it once and referencing it is the whole method.

---

## 6. THE REGISTRY FABRIC

### 6.1 Tier-2: The Foundational Registries

| Registry | Envelope | Registry ID |
|---|---|---|
| Foundation Registry | Foundation artifacts, all tiers | `UCOS-REG-FND-0000000001` |
| Registry of Registries | Registries (self-registering) | `UCOS-REG-META-0000000001` |
| Primitive Registry | Tier-0 primitives (7 entries only) | `UCOS-REG-PRM-0000000001` |
| Concept Registry | Tier-1 concepts (31 entries) | `UCOS-REG-CPT-0000000001` |
| Relationship Registry | Base relationship vocabulary + extensions | `UCOS-REG-REL-0000000001` |
| Artifact Template Registry | The 20-field canonical template | `UCOS-REG-TPL-0000000001` |
| Validation Rule Registry | Named, reusable validation rules | `UCOS-REG-VLD-0000000001` |
| Certification Scheme Registry | Certification schemes + evidence types | `UCOS-REG-CRT-0000000001` |
| Governance Body Registry | Authorities, councils, quorums | `UCOS-REG-GOV-0000000001` |

### 6.2 Tier-2: Construct Registries (one per canonical construct)

```text
Entity Registry          Identity Registry       Classification Registry
Taxonomy Registry        Taxon Registry          Attribute Registry
Relationship Registry    Capability Registry     Policy Registry
Rule Registry            Constraint Registry     Context Registry
Lifecycle Registry       Resource Registry       Value Registry
Measurement Registry     Unit Registry           Method Registry
Temporal Registry        Spatial Registry        Knowledge Registry
Intelligence Registry    Action Registry         Event Registry
```

**Reading note:** `Context Registry` registers *dimension and scheme definitions*, not contexts — contexts are ephemeral and resolved (Phase 007). `Value Registry` registers *valuations*, not values-as-fields. The distinction between a registry of definitions and a registry of instances is enforced by each registry's `envelope`.

### 6.3 Tier-3: Universe Registries

Each universe (Phase 001 §4) holds exactly one registry for its canonical truth, plus a contract declaring how other universes consume it.

```text
UPR  Product Registry              USE  Service Registry
UCM  Commerce Registry             UFN  Financial Registry
UID  Identity Registry             UTM  Temporal Registry
UGR  Spatial Registry              UKN  Knowledge Registry
USC  Science Registry              UMQSOCR Mathematical Registry
UAI  Intelligence Registry         UAN  Analytics Registry
UDS  Decision Registry             USM  Simulation Registry
USEC Security Registry             UGV  Governance Registry
ULA  Legal Registry                UCP  Compliance Registry
UST  Trust Registry                USU  Sustainability Registry
UQT  Quantum Registry              USCH Supply Chain Registry
UMF  Manufacturing Registry        UOR  Organisation Registry
```

### 6.4 Registry Size Is a Quality Signal

```text
Primitive Registry      7 entries      — growth is a constitutional event
Concept Registry       31 entries      — growth requires derivation proof
Attribute Registry     unbounded       — the largest registry in the platform
Taxonomy Registry      unbounded       — one scheme per classification need
Policy Registry        unbounded       — one per authority, per scope, per context
```

A platform whose Primitive Registry contains 700 entries has not built more; it has stopped doing the recursion. This is the simplest available diagnostic of architectural health.

---

## 7. REGISTRY FRAMEWORK (OPERATIONS)

```text
ADMIT      submit candidate → validate → ratify → certify → publish
RESOLVE    canonicalId | alias | externalId → certified entry
           (traverses supersession transparently)
QUERY      filter over entry metadata and classification paths
TRAVERSE   follow typed relationships across registries
SUPERSEDE  register successor; predecessor becomes read-only and resolvable
DEPRECATE  mark entry not-admissible for new artifacts
RETIRE     gate: zero live dependents; then read-only forever
ATTEST     return verifiable certification evidence for an entry
FEDERATE   publish a read-only projection to a federated copy
RECONCILE  verify a copy against the canonical master
```

Every operation is an audited Action (Phase 003, `C-13`) with an accountable authority. There are no unattributed registry mutations, anywhere.

---

## 8. REGISTRY GOVERNANCE

### 8.1 Authority Envelopes

```text
envelope declares:
  which constructs the registry may canonically hold,
  which universes it serves,
  which relationships its entries may form,
  and which policies govern admission and retirement.
```

A registry that canonicalizes an artifact outside its envelope has committed an authority violation (Phase 001 §5.1, UCL-F09-adjacent). The check is mechanical: does the artifact's owning universe match the registry's envelope?

### 8.2 Separation of Powers

Carried forward verbatim from Phase 001 §7.1: ratifier ≠ certifier ≠ author ≠ recorder. No artifact is self-certifying (GI-4).

### 8.3 Cross-Registry Disputes

When two registries both claim an artifact, resolution is **not negotiated**. It is determined by envelope: the artifact belongs to the registry whose declared envelope contains it. If both envelopes contain it, one of the envelopes is wrong, and the **Foundation Council must amend one**. An unresolved overlap is a UCI-002 violation and blocks certification of both registries.

---

## 9. REGISTRY DISCOVERY

```text
INTENT          "I need the concept that governs how a thing may change"
      ↓
SEMANTIC RESOLUTION      match descriptors against registry entries
      ↓
AUTHORITY FILTER         is the candidate certified for my envelope?
      ↓
SUPERSESSION FILTER      is it current?
      ↓
RANKING                  by specificity, authority, evidence strength
      ↓
RESOLUTION               one canonical entry, with provenance
```

Discovery rules (all phases share these; stated authoritatively here):

```text
D-RG-01  Discovery begins from registries. There is no unindexed source of truth.
D-RG-02  All identifier forms converge on one canonical entry.
D-RG-03  Superseded entries are returned flagged, never silently current.
D-RG-04  Deprecated entries are returned with their successor.
D-RG-05  Scope: entries outside the requester's envelope are not returned as
         canonical — they are returned as references, clearly marked.
D-RG-06  Discovery may traverse DERIVES-FROM edges to suggest more primitive
         alternatives, resisting unnecessary new artifacts at authoring time.
```

**D-RG-06 is the anti-bloat mechanism.** Every author who reaches for a new concept is first shown the more primitive thing they could have used. Most of the time, that ends the request.

---

## 10. REGISTRY EVOLUTION

```text
Registry-level evolution (the registry itself changes):
  E-RG-01  A registry may widen its envelope only by Foundation Council
           ratification, and only if no other registry's envelope overlaps.
  E-RG-02  A registry may narrow its envelope only by superseding or
           migrating every orphaned entry.
  E-RG-03  A registry may be superseded by a successor registry; all entries
           are re-resolved through a registered migration mapping.
  E-RG-04  A registry may never be deleted. It may be retired with zero
           live dependents, remaining resolvable and read-only forever.

Entry-level evolution:
  → Phase 001 §6 governs, unchanged: SUPERSEDES, DEPRECATES, FORKS,
    MERGES, RETIRES; no deletion; no silent relabelling.
```

---

## 11. LIFECYCLE / SECURITY / EVENTS / APIS

```text
LIFECYCLE   DRAFT → PUBLISHED → CERTIFIED → SUPERSEDED
            A registry with no CERTIFIED status may hold no certified entries.

SECURITY    Integrity-first, public-by-default (RG-P7).
            RG-S-01  append-only, hash-chained versions
            RG-S-02  write separation across ratify/record/certify
            RG-S-03  federation is read-replication, never multi-master
            RG-S-04  a divergent copy refuses to resolve rather than serve
            RG-S-05  every operation is an audited Action with an authority
            RG-S-06  revocation of a certification cascades to dependents

EVENTS      reg.registry.published      reg.entry.admitted
            reg.entry.rejected         reg.entry.superseded
            reg.entry.deprecated       reg.entry.retired
            reg.envelope.widened       reg.envelope.narrowed
            reg.federation.diverged    → constitutional event
            reg.dispute.opened         reg.dispute.resolved

APIS        ADMIT | RESOLVE | QUERY | TRAVERSE | SUPERSEDE | DEPRECATE
            | RETIRE | ATTEST | FEDERATE | RECONCILE
            Bindings are generated (Phase 009); semantics are canonical here.
```

---

## 12. DATA MODEL

```text
Registry    { identity, authority{owner, ratifier, certifier, envelope},
              schema{entryModel, entryConstraints, relationshipPolicy},
              policies{admission, supersession, retirement, access},
              contracts[], dependencies[], lifecycle, security, audit[],
              lineage, descriptors[] }

Entry       { identity, definition, classification[], ownership, lifecycle,
              relationships[], evidence, securityPosture, descriptors[] }

Projection  { sourceRegistry, contentHash, asOf, reconcileStatus }
```

Every field is typed by reference to a Tier-1 construct. No storage types appear; the schema is a generated derivative (UCL-C04).

---

## 13. VALIDATION / COMPLIANCE / CERTIFICATION

```text
VALIDATION
  V-RG-01  the registry is registered in the Registry of Registries
  V-RG-02  entryModel resolves to a registered construct
  V-RG-03  envelope overlaps no other registry's envelope
  V-RG-04  every entry satisfies the entryConstraints
  V-RG-05  every relationship type is registered with a stated inverse
  V-RG-06  inverses are computed, never stored
  V-RG-07  no entry exists in two registries canonically
  V-RG-08  retired entries have zero live dependents

COMPLIANCE
  C-RG-01  Any artifact referenced from a composition must resolve to a
           CERTIFIED entry in a registry whose envelope covers the requester.
  C-RG-02  An artifact referenced from a generated schema or API must
           additionally be traceable to that entry's certification record.
  C-RG-03  A federation copy serving resolutions without a successful
           RECONCILE is out of compliance.

CERTIFICATION
  X-RG-01  By the Certification Body, with evidence:
             envelope-non-overlap proof, validation results, quorum record,
             security posture, and a sample RESOLVE trace.
  X-RG-02  Certification of a registry is a precondition for certification
           of any entry within it. The dependency runs one way only.
  X-RG-03  Revoking a registry's certification voids its entries' certifications.
```

---

## 14. THE REGISTRY OF REGISTRIES (SEED)

The authoritative seed is `registries/registry-registry.json`. A registry is
canonical in exactly one registry — the Registry of Registries — and every
registry named in §6 appears there.

---

## 15. WHAT THE REGISTRY SYSTEM PREVENTS

```text
Without it                          With it
────────────────────────────────    ────────────────────────────────
Five definitions of "Customer"      One Customer entry, four references
A new field added to fix a bug      A registered Attribute, certified
Two teams' "price" diverging        One Value construct, many valuations
A schema that drift from intent     Schema is generated; it cannot drift
A knowledge graph with orphan nodes Every node is a registry entry
A "quick fix" that breaks callers   Supersession, with dependents computed
Multi-master federation             One master; read-only projections
```

The right-hand column is not a feature list. It is what follows from four
rules: one artifact, one registry, one owner, one truth.

---

## 16. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root)
Document:      UCOS-REG-DOC-001
Type:          Registry System Constitution
Status:        APPROVED
Coverage:      Registry meta model, framework, governance, discovery, evolution
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-TAX-DOC-001` — Universal Taxonomy Engine (Phase 005).
Registries can now hold artifacts. Phase 005 explains how those artifacts are
*organised* — with no hard-coded categories, anywhere.
