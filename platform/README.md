# UCOS Ω∞ platform

This is a working implementation of the architecture in `../UCOS`, `../Architecture1.txt`, `../Architecture2.txt`, `../new 5.txt` and `../new 6.txt`.

The platform follows the constitution's own rule: **systems are compositions and content is metadata**. The code is a small, generic kernel (the ten UCOS phases). Everything domain-specific is registered metadata inside that kernel: universes, authorities, laws, invariants, taxonomies, models, flows, facets, capabilities and compositions. It is read from the architecture documents themselves. It is not retyped into code.

## Run it

Requires Node.js 24 or later. The runtime has no dependencies; TypeScript is used only for type-checking.

```sh
npm install              # dev tooling only (typescript, @types/node)
npm run build:all        # genesis + constitution (~4 s), then ingests the full corpus (~40 s)
npm run validate         # audits all 20 invariants, hash-chain integrity and the context-merge algebra
npm run coverage         # proves every heading of every source document maps to a registered artifact
npm run serve            # API + UI at http://127.0.0.1:8787
npm test                 # 14 end-to-end tests against a fresh, isolated platform
npm run typecheck
```

Principal credentials are written to `var/credentials.json` (mode 0600). Paste one into the UI's **Credential** dialog, or send it as `Authorization: Bearer <token>`. Tokens can also be supplied through `UCOS_TOKEN_<ALIAS>` environment variables, and the attestation key through `UCOS_ATTESTATION_KEY`.

## What a full build contains

| | |
|---|---|
| Corpus coverage | **9,418 / 9,418 headings registered** across 21 source files; 0 refused |
| Universes | 88 (86 from Architecture1, UMQSOCR from Architecture2, plus the UCOS root), each with its own registry and Domain Authority |
| Registered artifacts | ~18,300: 3,692 sections, 1,558 authorities, 928 invariants, 775 laws, 3,366 taxa, 756 models, 4,091 attributes, 553 flows, 158 lifecycles… |
| Constitution | 7 primitives, 31 concepts, 20 invariants, 23 UCL laws + the `new 6.txt` laws, 418 phase rules, 20 lifecycles, 33 relationship types |
| Systems | 12 certified compositions (Marketplace, ERP, CRM, Booking, Calendar, Offer Engine, Subscription Engine, Workflow Engine, AI System, CMS, Supply Chain, Financial System) over 40 contracted capabilities |
| Generators | 8 certified generators (DB schema, API, events, UI, docs, policy, workflow, knowledge graph) with 15 variants |
| Audit | all 20 UCI invariants hold; ~111k append-only, hash-chained versions and events verify |

## Map of the code (`src/`)

| Phase | Where | What it does |
|---|---|---|
| 001 Foundation Registry | `kernel/store.ts`, `registry/fabric.ts` | Append-only, hash-chained versions and events (enforced by database triggers). Admission, the governance pipeline (DRAFT → PROPOSED → RATIFIED → CERTIFIED), supersession, the zero-dependents retirement gate, revocation cascade, federation and reconciliation |
| 002 Ontology | `constitution/ontology.ts` | Derivation chains to Tier-0, computed tiers, and the UCL-F09 lexicon check |
| 003 Meta Model | `registry/types.ts`, `validation/engine.ts` | The shared spine, plus kind validators for every construct |
| 004 Registry System | `registry/fabric.ts`, `metadata/registries.json` | One meta-model for every registry, envelope resolution and overlap refusal, typed relationships with acyclicity, and inverses that are computed rather than stored |
| Governance | `registry/governance.ts`, `metadata/governance.json` | Bodies, quorums, separation GI-1 to GI-5, principals and credentials |
| 005 Taxonomy | `taxonomy/engine.ts` | Classification as an evidenced, contextual assertion; admission rules; policy attachment; withdrawal cascade (TX-G3) |
| 006 USPT | `commerce/*` | Exchangeable entity with 7 facets, roles by classification, offers whose consideration is Value relationships, quotes, entitlements with bounds, rivalry in window, transfer, renewal, dunning, bundles, a double-entry ledger, and units with registered conversions |
| 007 Context | `context/engine.ts`, `metadata/context-models.json` | Ten registered dimensions, purpose filtering, a semilattice merge (proven on random inputs), UNRESOLVED as refusal, and the simulation firewall |
| Policy | `policy/engine.ts`, `metadata/policies.json` | Default deny; precedence computed as (authority rank, specificity, recency); prohibition wins ties |
| 008 Composition | `composition/engine.ts`, `capabilities/*`, `metadata/capabilities.json` | Contract-driven wiring without cycles, V-CM-01 to V-CM-10, the strictest-of-parts envelope, certification, instantiation, suspension, and a generic capability runtime |
| 009 Generation | `generation/*`, `metadata/generator-mappings.json` | Eight generators; six-property preservation check; deterministic output; HMAC attestation kept separate from generators; tamper detection; stale propagation; idempotent regeneration |
| 010 Intelligence | `intelligence/*` | Knowledge (with reconciliation), reasoning (closure, Horn rules, derivation chains, contradictions from "X is not Y" invariants), discovery (FTS5/BM25 with supersession flags and primitive suggestions), recommendation as Value relationships, optimization (two-phase simplex, branch-and-bound, Monte Carlo uncertainty, refusal without an objective), and autonomous governance (per-context autonomy, alignment evidence, escalation, an engine that cannot amend its own envelope) |
| Constitutional validation | `validation/engine.ts` | Five layers (invariant, constitution, law, policy, implementation), plus a global audit of all 20 invariants |
| Corpus | `corpus/parser.ts`, `corpus/ingest.ts`, `config/corpus-interpretation.json` | A configuration-driven parser and ingestor, the coverage map, and findings |
| Surfaces | `api/server.ts`, `ui/*`, `cli.ts` | REST API with a live event stream, a web explorer that renders generated UI definitions as working apps, and the CLI |

## Where "hard-coding" was avoided, and what remains

- **No domain nouns exist in code.** Product, service, booking, subscription and similar roles are taxa with admission rules over facets. Named systems are compositions. Universes and authorities are data parsed from the corpus.
- **Every behavioural parameter is registered metadata.** That covers lifecycles and their guards, policies, context value models, capability contracts, type mappings, units, facet admissibility and the prohibited lexicon. Changing one is a registration, not a code change.
- The kernel *does* contain the platform's own mechanisms (validators keyed by constitutional rule, the merge algebra, the simplex solver, the eight generator transforms, and the capability handler families). The constitution places these at the platform level: they are the registered capabilities and generators, not domain logic.

## Findings in the source documents

The ingestor records issues in the documents rather than hiding them. See `GET /api/findings` or `npm run coverage`. In the current corpus:

- 24 identifiers are stated twice with different text, mostly across Part 97 v1.0 and v2.0 for USICO.
- 8 universes are referenced but never defined: UQMQC, UELM, UGAPA, UIU, UKO, USS, UTME and USPE. They are recorded as FUTURE dependencies.
- One circular dependency claim, between UMQSOCR and USICO, was refused under UCI-014.
- Restatements (the same text under two identifiers) are registered as aliases of one entry, not duplicated.

## Operational notes

- The UI and API run single-process on SQLite in WAL mode. Federation is available as read-only projections (`federate` / `reconcile`), not multi-master, which the constitution itself requires (RG-P8).
- Notifications dispatch to `outbox`. Other channels read their endpoint and token from `UCOS_CHANNEL_<NAME>_URL` / `_TOKEN` (the deployment contract, GN-S-03).
- Regenerate everything from scratch with `rm -rf var generated && npm run build:all`.
