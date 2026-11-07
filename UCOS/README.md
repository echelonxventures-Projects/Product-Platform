# UCOS Ω∞ — Universal Civilization Operating System

**Start here:** [`00-Master-Index.md`](00-Master-Index.md) — constitution, invariants, laws, and the phase map.

This directory contains the constitutional specification of UCOS Ω∞: a universal,
metadata-driven, ontology-first, registry-driven platform from which any product,
service, capability, process, organization, industry, marketplace, ecosystem,
intelligence system, or civilization-scale construct can be **composed and generated**
rather than built.

## The claim, in three lines

```text
1. Everything that is, is an Entity.
2. Everything about an Entity is metadata.
3. Everything an Entity does is a composition governed by policy.
```

## What exists here

| | |
|---|---|
| `00-Master-Index.md` | Constitution, 20 invariants, 23 laws, governance graph, the 20-field artifact template |
| `PHASE-001 … PHASE-010` | The ten deliverables in constitutional dependency order |
| `registries/*.json` | Machine-readable registry seeds — the platform's own self-description |

The phases are **not a schedule; they are a strict dependency lattice**. No phase may
reference a concept defined in a later phase (verified: zero forward references).

## The reduction that makes it work

The legacy foundation listed nineteen primitives. Applying the charter's Universal
Question recursively collapsed them to **seven Tier-0 irreducibles**, from which all
thirty-one Tier-1 concepts are derived with stated derivation chains:

```text
Existence · Distinction · Relation · Change · Constraint · Apprehension · Purpose
```

Nothing was discarded — the nineteen were **re-tiered**, and now each carries a proof
of its necessity. The Primitive Registry holds exactly seven entries; its smallness is
a quality signal, not a limitation.

## The three most consequential structural decisions

```text
1. Classification is a RELATIONSHIP, not a field.
   → There is no place to hard-code a category. No Industry Lock-In is possible.

2. Product, Service, Asset, License, Booking, Offer, Bundle are ROLES, not types.
   → USPT is one construct and seven facets. Twelve further commerce nouns,
     including ones the charter never named, were derived with zero new primitives.

3. Nothing downstream of metadata is canonical.
   → Schemas, APIs, UIs, and policies are generated derivatives. This is the
     concrete form of every "No … Lock-In" principle in the charter.
```

## How to audit it in one minute

```text
Pick any construct. Ask: "From what more fundamental concept is this derived?"
  → recursion ends at a Tier-0 primitive     : sound
  → "it just is"                              : violation
  → names a domain noun (order, patient, listing) : the construct has escaped
                                                the ontology; re-derive it
```

## Honest constraints

Each phase ends with what it costs. The platform has no opinion about commerce,
no preferred industry, no privileged taxonomy, and no exemption from governance for
intelligent actors. Autonomy inside this architecture is autonomy *inside a
constitution*; an agent that could amend its own policy envelope has escaped
governance, and the ownership separation that prevents this is structural rather
than policy-based.

---

*The architecture is incomplete by design. The last line of every registry reads the
same — **Future Universes** — and admitting one costs a registration, not a redesign.*
