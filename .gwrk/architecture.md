# Project architecture target

Target context guides future work. Code conformance remains unassessed by initialization. Blocked: none.

## Selection

- Project: gwrk
- Architecture: hexagonal-functional
- Language: TypeScript
- Framework: unspecified
- Template version: 1.0.0
- Architecture checks: activation unchanged by initialization

## Rules

- Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.
- Domain code MUST NOT access external state. Isolate filesystem and network effects in adapters. Pass environment and clock values as inputs.
- Core operations MUST return explicit results without hidden mutable state. Equal inputs produce equal outputs. Test domain laws.
- Functions MUST separate policy from effects. Use one domain term per concept. Identify duplicate work and explicit error paths.
- Implementation MUST follow observed RED tests with GREEN execution evidence. Passing checks do not erase uncovered design defects.

## Language guidance

Use interfaces for ports. Inject effectful services. Keep framework types outside domain signatures.

## Framework guidance

No framework selected.

## Project decisions

- docs/decisions/ADR-013-desired-architecture.md

Read the complete decision corpus and preserve existing Decided constraints. Generated target records remain Proposed until human ratification. Resolve conflicts before implementation.

## Later assessment

Run `gwrk assess` to assess the existing code against this target. The portable gwrk-assess skill uses the same method. Assessment proposes feature specs and never certifies the entire codebase.
