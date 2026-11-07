# PHASE-001 — UNIVERSAL FOUNDATION REGISTRY

**Document ID:** UCOS-FR-DOC-001
**Document Name:** Universal Foundation Registry
**Version:** 1.0
**Classification:** Constitutional Foundation
**Tier:** Tier-0
**Status:** CANONICAL FOUNDATION

> **Constitutional constraint for this phase (per charter):**
> *Do not generate implementation. Generate only foundations.*

This document contains no code, no schema, no storage, no runtime. It contains only **the registry of that upon which all else depends**, and the four graphs that order it.

---

## 1. PURPOSE

Every artifact in the platform must be discoverable, owned, versioned, and governed. Those properties cannot be conferred by the artifacts themselves without circularity. Therefore a **root artifact** is required whose sole function is to hold the identity and ordering of the artifacts from which all others are composed.

That root artifact is the **Master Foundation Registry (MFR)**. It is the registry of registries, the ground of discoverability, and the only object in the platform that is permitted to be its own ancestor.

---

## 2. CONSTITUTIONAL DEFINITION

```text
MASTER FOUNDATION REGISTRY

The single canonical registry whose entries are the Foundation
Artifacts: those artifacts upon which one or more other artifacts
depend, and which depend upon nothing but Foundation Artifacts.

It is the root node of the registry lattice.
It is the only self-registering object in the platform.
It is the sole authority for the identity, ordering, ownership,
and admissibility of every Foundation Artifact.
```

**Constitutional note.** "Upon which all else depends" is not a metaphor. An artifact that *nothing* depends on, and that depends on nothing, is not a Foundation Artifact — it is an **orphan** (forbidden by UCI-016 in combination with the No Orphan Artifacts principle). Every entry in the MFR must have at least one dependent or be the MFR itself.

---

## 3. THEORY

Three results justify the registry's shape.

### 3.1 Well-Foundedness ⇒ the Registry is a Lattice

Let `A → B` read "A depends on B". The constitutional prohibition on circular dependencies (UCI-014) makes `→` a **strict partial order**. By the well-ordering principle, every such order has minimal elements. The minimal elements are the Tier-0 primitives; the registry is the **Hasse diagram** of that order. Hence:

> The Foundation Registry is not a list. It is the **picture of a partial order**, and its shape is not a design choice — it is forced by the acyclicity invariant.

### 3.2 Self-Description ⇒ One Bootstrap Entry

The registry must be describable (UCI-016), therefore registrable, therefore it must be an entry in itself. This is not a paradox but a **fixed point**: the registry's own entry is its least-fixed-point, and it is the unique artifact permitted to be its own ancestor. All other self-reference would constitute a cycle and is prohibited.

> **UCL-F10.** The Foundation Registry shall be its own first entry.

### 3.3 Single Canonical Source ⇒ One Registry Per Truth

If two registries could both define the primitive "Identity", then Identity would have two truths, violating UCI-002/UCI-003 and UCI-017. Therefore there is exactly one MFR, and it is the only place a Foundation Artifact may be **defined**. Other registries **reference** its entries; they never re-define them.

---

## 4. FOUNDATION HIERARCHY

The tiering is by *derivation depth from Tier-0*, not by importance. Depth is computed, not assigned: `tier(A) = 1 + max(tier(B))` over `A → B`.

```text
TIER 0   IRREDUCIBLE PRIMITIVES (7)
         Existence · Distinction · Relation · Change
         Constraint · Apprehension · Purpose

TIER 1   DERIVED PRIMITIVES (19)
         Identity · Reality · Entity · Space · Time · State
         Event · Relationship · Attribute · Classification
         Capability · Action · Rule · Policy · Context
         Lifecycle · Resource · Value · Measurement

         ── also at Tier 1 ──
         Knowledge · Meaning · Decision · Intelligence
         Trust · Certification · Evolution

TIER 2   META CONSTRUCTS
         Meta-Ontology · Meta-Registry · Meta-Knowledge-Graph
         Artifact Template · Identification Scheme
         Validation · Supersession · Certification

TIER 3   UNIVERSES (authority envelopes)
         Existence · Identity · Temporal · Spatial · Knowledge
         Science · Mathematics · Intelligence · Analytics
         Decision · Simulation · Financial · Security
         Governance · Commerce · Product · Service
         Marketplace · Supply Chain · Manufacturing
         Legal · Compliance · Trust · Sustainability · Quantum
         ── and Future Universes

TIER 4   DOMAIN CONTENT
         concepts, taxonomies, attributes, capabilities,
         policies, events, contracts — as authored by
         Domain Authorities within a Universe

TIER 5   COMPOSITIONS & GENERATIONS
         systems, applications, workflows, schemas, APIs,
         UIs, documents, knowledge graphs
         (derivatives — hold no independent truth)
```

### 4.1 The Tiering Invariant

```text
An artifact at tier N may only reference artifacts at tier ≤ N
that are not itself.
```

A Tier-5 generated API may reference a Tier-3 universe and a Tier-1 primitive. It may not reference "the schema generated alongside it" without going through the Tier-2 generator that produced both. This is what makes generated artifacts derivatives (UCL-C04) rather than participants in the truth.

---

## 5. DEPENDENCY GRAPH

Dependencies are **declared at registration** and **verified by the Certification Body**. Undeclared dependencies are forbidden (No Hidden Dependencies).

### 5.1 Dependency Types

| Type | Code | Semantics | Severable? |
|---|---|---|---|
| Constitutive | `CONSTITUTIVE` | The dependent literally *is* a structure built on this. Removing it destroys the dependent. | No |
| Semantic | `SEMANTIC` | The dependent's definition references this concept. | No |
| Functional | `FUNCTIONAL` | The dependent requires this capability to act. | Yes, with degradation |
| Contractual | `CONTRACTUAL` | The dependent consumes this universe's truth through a contract. | Yes, by contract amendment |
| Optional | `OPTIONAL` | Enhances but is not required. | Yes |
| Future | `FUTURE` | Declared but not yet available; certification is withheld. | n/a — not certifiable |

### 5.2 The Graph (Tier 0 → Tier 1, constitutive and semantic edges)

```text
                    [Existence]
                    │  │  │
        ┌───────────┘  │  └──────────────┐
        ▼              ▼                 ▼
   [Distinction]   [Relation]        [Change]
        │  │           │  │            │  │
        │  └────┐      │  │            │  │
        ▼       ▼      ▼  │            ▼  │
   [Identity] [Entity] [Relationship]  │  │
        │       │       │              │  │
        │       │       └──────┐       │  │
        ▼       ▼              ▼       ▼  ▼
   [Attribute]        [Capability] [State] [Time]
        │                  │          │      │
        ▼                  ▼          ▼      ▼
   [Classification]   [Action]    [Event]  [Lifecycle]
        │                  │          │
        ▼                  ▼          ▼
   [Taxonomy]         [Rule]      [Context]
                          │          │
                          ▼          ▼
                       [Policy]  [Resource]
                          │          │
                          ▼          ▼
                       [Value]   [Measurement]

    [Constraint] ─────► Rule, Policy, Measurement, Resource
    [Apprehension] ───► Knowledge, Meaning, Measurement
    [Purpose] ────────► Value, Decision, Intelligence, Policy
```

### 5.3 Acyclicity Enforcement

Acyclicity is not checked at runtime; it is **proved at registration**. A candidate artifact is admissible only if the topological sort of its declared closure succeeds. Failure of the sort is a registration refusal, and the refusal is itself an audited decision.

```text
ADMIT(A):
  closure ← transitive(dependencies(A)) ∪ {A}
  if topological_sort(closure) FAILS:  → REJECT (UCI-014)
  if any dependency ∉ MFR:             → REJECT (UCI-016, UCL-F06)
  if A duplicates an existing concept:  → REJECT (UCI-003, UCI-017)
  else:  certify, record, publish
```

---

## 6. EVOLUTION GRAPH

Foundations change. The constitution does not forbid change; it forbids change that silently breaks dependents (UCI-015).

### 6.1 Evolution Relations

```text
SUPERSEDES     A replaces B. B becomes read-only. All B references
               remain resolvable; resolution returns A with a
               provenance marker. Nothing is deleted.

DEPRECATES    A marks B as not-to-be-used-in-new-compositions.
               Existing compositions retain certification until
               their own next evolution, then must migrate.

FORKS         Two incompatible specialisations of one parent.
               Requires a Discriminating Classification registered
               in the Taxonomy Registry stating when each applies.

MERGES        Two artifacts unified into one. Requires an equivalence
               proof plus a mapping table; both superseded.

RETIRES       B is removed from admissibility for new artifacts.
               Retention of historical instances is permanent.
               Retiring an artifact with live dependents is
               constitutionally void.
```

### 6.2 The Evolution Graph Is a Forest

```text
v1 ──SUPERSEDES──► v2 ──SUPERSEDES──► v3 ──DEPRECATES──► (read-only)
 │                  │
 └──FORKS──► v1a    └──FORKS──► v2a
            │                  │
            MERGES ◄───────────┘
            (into v2b)
```

Two invariants govern it:

- **No deletion.** Supersession archives; it never erases. Referential integrity (UCI-005) is permanent.
- **No silent relabelling.** An identity that changes meaning must be a new identity, not a new version. Changing what a thing *is* is a fork, not a revision.

### 6.3 Compatibility Classes

| Class | Meaning |
|---|---|
| `COMPATIBLE-EXTENDING` | New optional content only. All dependents unaffected. |
| `COMPATIBLE-NARROWING` | Constraints tightened. Dependents must re-validate. |
| `INCOMPATIBLE` | Meaning changed. Requires fork. Dependent compositions must re-certify. |

An `INCOMPATIBLE` change to a Tier-0 or Tier-1 artifact requires ratification by the **Constitutional Assembly**, because it alters what can be said at all.

---

## 7. GOVERNANCE GRAPH

```text
                    ┌─────────────────────────────┐
                    │  CONSTITUTIONAL ASSEMBLY    │
                    │  ratifies: Invariants,      │
                    │  Constitution, Tier-0 change│
                    └──────────────┬──────────────┘
                                   │ ratifies
                    ┌──────────────┴──────────────┐
                    │  FOUNDATION COUNCIL         │
                    │  ratifies: Tier-1/Tier-2    │
                    └──────────────┬──────────────┘
                                   │ ratifies
                    ┌──────────────┴──────────────┐
                    │  DOMAIN AUTHORITIES         │
                    │  ratify: Tier-3/Tier-4      │
                    │  within their own envelope  │
                    └──────────────┬──────────────┘
                                   │ records
                    ┌──────────────┴──────────────┐
                    │  REGISTRY OFFICE            │
                    │  assigns identity, version, │
                    │  timestamp, lineage         │
                    └──────────────┬──────────────┘
                                   │ verifies
                    ┌──────────────┴──────────────┐
                    │  CERTIFICATION BODY         │
                    │  issues or withholds the    │
                    │  certification that licenses│
                    │  an artifact for composition│
                    └─────────────────────────────┘
```

### 7.1 Separation Invariants

```text
GI-1  He who ratifies shall not certify.                (separation of powers)
GI-2  He who certifies shall not author.                (independence of audit)
GI-3  He who records shall not ratify.                  (registry neutrality)
GI-4  No artifact is self-certifying.                   (UCI-012)
GI-5  No body may amend an invariant it did not ratify. (UCI-013)
```

### 7.2 Ownership Fields on Every Entry

```text
governance
├── canonicalOwner        (exactly one — UCI-002)
├── ratifyingBody
├── certifyingBody
├── changePolicy          (who may propose amendments)
├── amendmentQuorum
└── disputeAuthority
```

---

## 8. REGISTRY ENTRY META MODEL

One structure serves every entry. It is the **only** structural innovation of this phase, and it is deliberately expressed in terms of Tier-1 concepts so that the registry can describe itself without new primitives.

```text
FoundationArtifact
├── identity
│    ├── canonicalId          UCOS-FR-…
│    ├── aliases[]            human shorthand, resolvable
│    └── externalIds[]        provenance from legacy systems
├── definition
│    ├── canonicalName        one name, one meaning
│    ├── canonicalStatement   one sentence (the constitutional definition)
│    └── derivationChain[]    ordered, terminating at Tier-0
├── classification
│    ├── tier                 0..5, computed
│    ├── layer                FOUNDATION | CONCEPT | UNIVERSE | …
│    └── taxonomyPaths[]      references into the Taxonomy Registry
├── ordering
│    ├── dependencies[]       {target, type, strength}
│    └── dependents[]         computed inverse, never authored
├── ownership                 → §7.2
├── lifecycle
│    ├── status              DRAFT | PROPOSED | RATIFIED | CERTIFIED
│    │                       | DEPRECATED | RETIRED
│    └── versions[]          immutable, append-only
├── security
│    ├── posture             classification level of the artifact
│    └── accessPolicy        reference into the Policy Registry
├── evidence
│    ├── certificationRecord
│    └── auditTrail[]        append-only, UCI-011
└── discovery
     ├── descriptors[]       semantic, for the Discovery Engine
     └── publicationScope    who may see this entry
```

**`dependents` is computed, never authored.** Authoring one's own dependents would permit an artifact to claim to be depended upon, defeating the orphan rule. This is the concrete form of "No Orphan Artifacts".

---

## 9. RELATIONSHIPS

The MFR participates in exactly five relationship types. Each is a reference into the Relationship Registry (Phase 004), which is itself a registered artifact — the self-describing closure completes here.

| Relationship | Reading | Cardinality |
|---|---|---|
| `REGISTERS` | MFR **registers** FoundationArtifact | 1 : N |
| `GOVERNED-BY` | MFR **governed by** ConstitutionalAssembly | N : 1 |
| `SUPERSEDES` | entry **supersedes** earlier entry | 0 : N |
| `DERIVES-FROM` | entry **derives from** Tier-0 primitive | 1 : N |
| `BOOTSTRAPS` | MFR **bootstraps** itself (fixed point, unique) | 1 : 1 |

The `BOOTSTRAPS` edge is the single permitted self-loop in the entire platform, and it is permitted only because it is the identity relation, not a dependency. It carries no ordering consequence.

---

## 10. LIFECYCLE

```text
DRAFT ──► PROPOSED ──► RATIFIED ──► CERTIFIED ──► ADMISSIBLE
                                        │
                                        ├──► DEPRECATED ──► RETIRED
                                        │        (read-only, permanent)
                                        └──► SUPERSEDED
                                                 (read-only, resolvable)

  REJECTED ◄── any pre-CERTIFIED state   (refusal is audited)
```

| Transition | Guard |
|---|---|
| DRAFT → PROPOSED | derivation chain stated and terminating at Tier-0 |
| PROPOSED → RATIFIED | quorum of the competent body; no open dispute |
| RATIFIED → CERTIFIED | evidence complete; acyclicity proved; no duplicate concept |
| any → DEPRECATED | successor certified and resolvable |
| any → RETIRED | **zero live dependents** (this is the hard gate) |
| any → REJECTED | reason recorded as an audited Decision artifact |

The zero-live-dependents gate is what makes retirement safe. It is checked against the computed `dependents` set, not the authored one.

---

## 11. SECURITY

The MFR is the highest-value object in the platform: corrupting it corrupts all downstream truth. Its posture is therefore maximal and mostly structural rather than cryptographic.

```text
FR-SEC-01   Integrity over confidentiality. The registry is
            aggressively published; it is tamper-evident, not secret.
FR-SEC-02   Append-only. No entry is ever modified. Every change is
            a new version. (UCI-011)
FR-SEC-03   Tamper-evidence by hash-chained lineage across versions.
FR-SEC-04   Write separation. Ratify, record, and certify are three
            distinct principals (GI-1..GI-3).
FR-SEC-05   No bulk delete, ever. Retirement is a status, not removal.
FR-SEC-06   Every read may be proven against the certification record,
            so a consumer can verify that what it resolved was
            certified (UCI-012).
FR-SEC-07   Denial-of-service against the registry is a platform-wide
            constitutional event, because discovery fails with it.
            The registry is therefore required to be cacheable and
            eventually-consentable across federated copies — the
            canonical master remains the single source of truth,
            copies are read-only projections.
```

Federation here is **read replication**, not multi-master. Multi-master would create competing truths and violate UCI-002.

---

## 12. APIs

Only the minimal contract surface. Shapes are given as semantics, not syntax — the concrete bindings are *generated* (Phase 009) and are therefore not canonical.

```text
REGISTER     submit a candidate artifact for admission
             → returns ADMITTED | REJECTED-with-reasons
RESOLVE      canonicalId | alias → current certified entry
             (resolution through supersession chains is transparent)
DEPENDENTS   canonicalId → computed dependent set (for retirement gates)
LINEAGE      canonicalId → version chain + audit trail
SUPERSEDE    canonicalId ← successorId   (privileged)
ATTEST       canonicalId → verifiable certification evidence
SEARCH       semantic descriptor → candidate entries   (Phase 010)
```

Every call is itself an audited action with an accountable authority (UCI-006, UCI-011). There are no anonymous registry mutations.

---

## 13. EVENTS

```text
fr.artifact.admitted          new entry certified and published
fr.artifact.rejected          registration refused, reasons recorded
fr.artifact.superseded        entry replaced; references remain resolvable
fr.artifact.deprecated        entry withdrawn from new composition
fr.artifact.retired           entry removed from admissibility (zero deps)
fr.dependency.violated        undeclared or cyclic dependency detected
fr.certification.revoked      evidence found insufficient post-hoc
fr.registry.bootstrapped      the fixed-point entry written (once, ever)
```

Every event carries: canonicalId, identity of the accountable authority, temporal context (UCI-007), pre-state, post-state, and the certification record that licensed the transition. An event lacking any of these is itself a violation.

---

## 14. DATA MODEL

Expressed as **metadata**, never as a schema. The generated schema is a derivative (UCL-C04). Note that every field below is typed by reference to a Tier-1 concept rather than to a storage type — there is no `varchar` in a constitutional document.

```text
FoundationArtifact
  identity      : Identity
  name          : Classification  (canonical label)
  statement     : Knowledge       (the canonical definition)
  derivation    : Relationship [] (terminating at Tier-0)
  dependencies  : Relationship []
  dependents    : Relationship [] (computed)
  ownership     : Governance
  lifecycle     : Lifecycle
  versions      : Event        [] (append-only)
  posture       : Constraint     (security classification)
  evidence      : Certification
  descriptors   : Knowledge   [] (for discovery)
```

---

## 15. VALIDATION RULES

```text
V-FR-01  canonicalId is globally unique and matches the identification scheme.
V-FR-02  derivationChain is finite, acyclic, and terminates in Tier-0.
V-FR-03  every dependency resolves to a CERTIFIED or ADMISSIBLE entry.
V-FR-04  canonicalStatement is a single sentence containing no domain,
         technology, vendor, geography, currency, or language noun. (UCL-F09)
V-FR-05  canonicalName is unique across all registries. (UCI-017)
V-FR-06  governance.canonicalOwner is exactly one body. (UCI-002)
V-FR-07  dependents (computed) is non-empty, OR the artifact is the MFR itself.
V-FR-08  no entry is both ratified and certified by the same body. (GI-1)
V-FR-09  retired entries have zero live dependents.
V-FR-10  superseded entries remain resolvable and read-only.
```

---

## 16. EVOLUTION RULES

```text
E-FR-01  A Tier-0 primitive may be retired only by the Constitutional Assembly,
         and only with zero live dependents — which in practice means never.
         Its realistic path is FORK with a discriminating classification.
E-FR-02  Adding a dependency requires re-certification of the dependent
         and everything transitively above it.
E-FR-03  Removing a dependency requires proof the dependent's semantics
         are unaffected.
E-FR-04  An INCOMPATIBLE change requires a new identity; the old is superseded.
E-FR-05  Every evolution event emits an event (§13) and appends one
         immutable version. No exceptions.
E-FR-06  Evolution may never leave the registry in a state where a
         certified composition references a deprecated artifact —
         that is a constitutional failure, not a warning.
```

---

## 17. COMPLIANCE RULES

```text
C-FR-01  Compliance is demonstrated by evidence, not assertion (UCI-012).
C-FR-02  The registry must answer, for any artifact, the five questions:
             who owns it, what depends on it, what it depends on,
             who certified it, and when did any of that change.
         Inability to answer any one is a compliance failure.
C-FR-03  A federation copy that cannot reconcile to the canonical master
         must refuse to serve resolutions rather than serve a
         possibly-divergent truth.
C-FR-04  No compliance assertion about an artifact is valid beyond the
         lifetime of its certification record.
```

---

## 18. DISCOVERY RULES

```text
D-FR-01  If it exists, it is registered (UCI-016). Discovery therefore
         begins from the registry, never from an unindexed source.
D-FR-02  Resolution by alias, by external id, or by canonical id must all
         converge on exactly one canonical entry. Convergence failure
         is a UCI-002 violation.
D-FR-03  Every entry publishes semantic descriptors sufficient for the
         Discovery Engine to rank it against an intent.
D-FR-04  Superseded entries are discoverable but flagged; they are
         never returned silently as current.
D-FR-05  Retirement removes admissibility for new artifacts but never
         removes discoverability of the historical record.
```

---

## 19. CERTIFICATION RULES

```text
X-FR-01  Certification is granted by the Certification Body only, never
         by the artifact's owner, never by the Registry Office.
X-FR-02  Required evidence:
           (a) validation rules V-FR-01..10 satisfied;
           (b) acyclicity proof of the declared closure;
           (c) duplicate-concept search returned empty;
           (d) governance quorum record;
           (e) security posture statement.
X-FR-03  Certification is scoped: it licenses an artifact for composition
         within a stated envelope, not universally.
X-FR-04  Certification is revocable. Revocation cascades to dependents
         whose own certification depended on it. This cascade is
         computed, not negotiated.
X-FR-05  The registry's own bootstrap entry is certified by unanimous
         Assembly resolution and carries the special class
         FOUNDATIONAL CONSTITUTION.
```

---

## 20. THE REGISTRY (SEED CONTENT)

The seed entries are given in machine-readable form in
`registries/foundation-registry.json`. That file **is** the Master Foundation
Registry's authoritative seed — this document is its narrative; the JSON is its
content. Neither is subordinate: the document defines meaning, the registry
holds identity. Both are required; neither alone is sufficient.

---

## 21. WHAT PHASE-001 ESTABLISHES FOR ALL LATER PHASES

```text
1. Identity   — every artifact can be named, once.
2. Ordering   — every artifact knows what it rests on.
3. Ownership  — every artifact has one accountable owner.
4. Change     — every artifact can evolve without silent breakage.
5. Evidence   — every artifact can be certified or refused.
6. Discovery  — every artifact can be found.
```

Remove any one of the six and the platform collapses into the ordinary world of
hand-built systems, where truth is scattered across codebases and nobody can
say who owns a definition. **The Foundation Registry is the single object that
prevents that.**

---

## 22. CERTIFICATION

```text
Universe:      UCOS Ω∞ (root)
Document:      UCOS-FR-DOC-001
Type:          Foundation Registry Constitution
Status:        APPROVED
Coverage:      Foundation Hierarchy, Dependency, Evolution, Governance graphs
Ownership Boundaries:    DEFINED
Dependency Boundaries:   DEFINED
Certification: FOUNDATIONAL CONSTITUTION
```

---

**NEXT:** `UCOS-ONT-DOC-001` — Universal Ontology (Phase 002).
The registry now exists and is empty of meaning. Phase 002 fills it with the
primitives from which everything is said.
