# ADR-013: Desired project architecture

> **Status:** Proposed
> **Date:** 2026-11-11
> **Decision:** Adopt hexagonal-functional as the target for gwrk.
> **Constraint:** Future implementation MUST follow the declared target rules after project adoption.
> **Depends on:**
> **Supersedes:**
> **Author:** Project owner · **Decision Scope:** Project architecture target

## 1. Context

The owner selected a target during deterministic initialization. Existing code conformance remains unassessed. Existing Decided records retain authority.

## 2. Decision

### 2.1 Constraint

Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.

### 2.2 Constraint

Domain code MUST NOT access external state. Isolate filesystem and network effects in adapters. Pass environment and clock values as inputs.

### 2.3 Constraint

Core operations MUST return explicit results without hidden mutable state. Equal inputs produce equal outputs. Test domain laws.

### 2.4 Constraint

Functions MUST separate policy from effects. Use one domain term per concept. Identify duplicate work and explicit error paths.

### 2.5 Constraint

Implementation MUST follow observed RED tests with GREEN execution evidence. Passing checks do not erase uncovered design defects.

## 3. Decision Record

| Field | Value |
|---|---|
| Position | hexagonal-functional |
| Confidence | Unassessed |
| Reversibility | Amend through project decisions |
| Risk | Migration scope unassessed |

## 4. Alternatives Rejected

No alternatives were evaluated during initialization. Human adoption requires review of existing decisions.

## 5. Impact on Existing Code

Initialization changes context only. Later assessment identifies code changes and executable checks.

## 6. Consequences

The target guides later planning and implementation. It does not establish present compliance.

## 7. References

- .gwrk/architecture.md
- Template version 1.0.0

## Amendments

| Amending | At | Summary |
|---|---|---|
