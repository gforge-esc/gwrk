# 034 — Four-Layer Hexagonal Architecture and Cycle Elimination

> **Status:** Defined · **Anchored to:** ADR-011

## 1. Problem
Seven bidirectional import cycles couple `commands`, `engine`, `plugins`, `server`, `utils`, and `db`. Domain and application modules import infrastructure directly, and `ship-orchestrator.ts` is a 2,708-line god class.

## 2. Functional Requirements
- **FR-001:** `src/domain/`, `src/ports/`, `src/application/`, and `src/adapters/` MUST enforce the inward dependency rule.
- **FR-002:** All seven cross-directory dependency cycles MUST be eliminated.
- **FR-003:** `ship-orchestrator.ts` stage handlers MUST be modularized and `src/architecture.test.ts` MUST enforce layer boundaries in CI.
