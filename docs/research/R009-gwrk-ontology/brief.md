---
initiative: gwrk-ontology
prefix: R009
methodology: ontology
status: completed
created: 2026-06-05
---

# R009: gwrk-ontology

## Objective

Define a repeatable domain ontology construction methodology for `gwrk` (`ADR-009`) so every agent dispatch receives a verified, project-specific `<domain_ontology>` grounding file (`.gwrk/ontology/domain.md`) that prevents synonym collision, instance/class confusion, and buried assumptions.

## Methodology: ontology

Apply the Five-Primitive Ontology Construction algorithm (`src/plugins/builtins/workflows/gwrk-research-ontology/PROMPT.md`):
1. **Classes**: Core domain kinds with PascalCase names, one-sentence definitions, boundary tests ("Not a X"), 3 to 5 concrete individuals, and source artifact citations.
2. **Properties**: Attributes per class classified by volatility (`identifier`, `intrinsic`, `state`, `derived`, `extrinsic`).
3. **Relations**: Directed edges between classes specifying `Domain`, `Range`, `Cardinality`, `Direction`, `Inverse`, and `Required?` without duplicating inverse pairs.
4. **Individuals**: 3 to 5 named instances per class walked through the relations to validate coverage.
5. **Axioms**: Invariant rules typed as `Disjointness`, `Existential`, `Universal`, `Cardinality`, or `Conditional`, paired with the failure mode each rule blocks.

Validate the resulting model against the six failure modes (overloading, undergeneralizing, missing middle, assumption burial, synonym collision, instance/class confusion) and the seven self-reflection questions, including `## Glossary` and `## Excluded Concepts`.

## Discovery

- Maintaining two separate prompts (`gwrk-ontology-construct/PROMPT.md` and `gwrk-research-ontology/PROMPT.md`) caused `gwrk define ontology --run` to execute a 46-line summary prompt that omitted property kinds, relation direction/inverse columns, axiom types, failure-mode checks, the seven-question self-check, and excluded-concept documentation (`Issue #201`).
- Unbounded source scanning in `src/engine/source-scanner.ts` loaded every `specs/*/spec.md` and `docs/decisions/*.md` in full (~640 KB / ~160,000 tokens in `gwrk`), risking context overflow on mature repositories.
- Calling the six product concepts in `docs/product/WHAT_IS_GWRK.md` "Six Primitives" collided with the "Five Primitives" of the ontology methodology itself.

## Conclusion

1. Consolidate the ontology construction methodology in `src/plugins/builtins/workflows/gwrk-research-ontology/PROMPT.md` and reuse it directly from `gwrk-ontology-construct` via `manifest.yaml` (`prompt: ../gwrk-research-ontology/PROMPT.md`) and `<!-- @include ../gwrk-research-ontology/PROMPT.md -->`.
2. Enforce bounded token budgets and newest-first spec ranking in `src/engine/source-scanner.ts`.
3. Disambiguate "Operating Model Concepts" (six product concepts) from "Ontology Primitives" (Classes, Properties, Relations, Individuals, Axioms) in `docs/product/WHAT_IS_GWRK.md` and `.gwrk/ontology/domain.md`.
4. Validate `.gwrk/ontology/domain.md` mechanically in CI so every class has properties, 3 to 5 individuals, and a source artifact, every relation declares direction and inverse without duplicate inverse rows, and excluded concepts are documented.
