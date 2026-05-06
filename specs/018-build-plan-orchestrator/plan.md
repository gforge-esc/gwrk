# Implementation Plan: 018 Build Plan Orchestrator

**Branch**: `018-build-plan-orchestrator` | **Date**: 2026-04-14 | **Spec**: [spec.md](./spec.md)

## Summary

This feature evolves the build plan from a passive markdown file into an active, solvable directed acyclic graph (DAG) stored in SQLite. It enables automated status tracking, critical path calculation, and drift detection between the plan and the actual codebase. It also integrates into the ship and define loops to ensure the build plan remains a single source of truth for the project's progress.

---

## Phases and File Structure

### Phase 1: Foundation & Data Model

Initialize the SQLite schema and implement the core `PlanStore` for graph storage, basic status reporting, and cold start bootstrapping. Provides two entry points: `gwrk plan seed` (from existing markdown) and `gwrk plan init` (scan specs/ directories).

**Files (7):**
- `src/db/migrations/006-build-plan.sql` (NEW: SQLite schema for features, phases, edges, and proposals)
- `src/db/plan.ts` (NEW: Low-level DB access for plan items)
- `src/engine/plan-store.ts` (NEW: Business logic for plan management, seed, init, and render)
- `src/engine/readiness-scanner.ts` (NEW: Scan specs/*/ to determine L0–L3 readiness level per feature)
- `src/commands/plan.ts` (NEW: CLI command entry point with empty-graph guards on all subcommands)
- `src/utils/parser-plan.ts` (NEW: Specialized parser for 000-build-plan.md YAML/Markdown)
- `src/cli.ts` (MODIFY: Wire `gwrk plan` command)

**Requirements Addressed:** FR-001, FR-005, FR-013, FR-017, FR-018, FR-019, US-003, US-008, US-011, US-016, DM-018-001, DM-018-002, DM-018-003, DM-018-004

**Dependencies:** None

**Contract Mapping:**
- `contracts/plan.md` → `seedPlan` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `initFromSpecs` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `getPlanStatus` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `addFeature` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `removeFeature` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `scanReadiness` → `src/engine/readiness-scanner.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-002 SQLite Ledger | Schema design compliance |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018-002 | Unit | `src/db/plan.ts` | Verify SQLite CRUD and recursive dependency traversal |
| TR-018-003 | E2E | `src/commands/plan.ts` | `gwrk plan seed` correctly populates from 000-build-plan.md |
| TR-018-003 | E2E | `src/commands/plan.ts` | `gwrk plan status --format json` returns valid status objects |
| TR-018-006 | Unit | `src/engine/readiness-scanner.ts` | Correctly assigns L0–L3 based on spec.md/plan.md/tasks.json presence |
| TR-018-006 | E2E | `src/commands/plan.ts` | `gwrk plan init --dry-run` lists features with correct readiness levels |
| TR-018-006 | E2E | `src/commands/plan.ts` | All `gwrk plan` subcommands on empty graph print remediation message and exit 1 |

#### Done When
- `gwrk plan seed --dry-run` shows valid seed payload from 000-build-plan.md
- `gwrk plan init` discovers features from `specs/` and assigns correct readiness levels
- `gwrk plan status` displays current project state from SQLite
- Every `gwrk plan` subcommand on empty graph prints `No build plan data. Run 'gwrk plan seed' or 'gwrk plan init'.` and exits 1

### Phase 2: Solver Engine & Ready Queue

Implement the `graphology` based solver to compute topological sorts, CPM (Critical Path Method), and the ready queue (Kahn's algorithm).

**Files (3):**
- `src/engine/plan-solver.ts` (NEW: Graph analysis logic using graphology)
- `src/commands/plan.ts` (MODIFY: Add `next`, `critical`, `waves` subcommands)
- `package.json` (MODIFY: Add `graphology` dependency)

**Requirements Addressed:** FR-002, FR-003, FR-004, FR-018, US-001, US-002, US-015, US-017, TC-004

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/plan.md` → `getReadyQueue` → `src/engine/plan-solver.ts`
- `contracts/plan.md` → `getCriticalPath` → `src/engine/plan-solver.ts`
- `contracts/plan.md` → `getTopologicalWaves` → `src/engine/plan-solver.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-004 Agent-Native | Signal protocol for solver commands |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018-001 | Unit | `src/engine/plan-solver.ts` | Verify Kahn's algorithm and CPM correctness with mock graphs |
| TR-018-001 | Unit | `src/engine/plan-solver.ts` | CPM warns when critical-path nodes have `sp_estimate = 0` |
| TR-018-001 | E2E | `src/commands/plan.ts` | `gwrk plan next` returns items with all dependencies DONE/SHIPPED |

#### Done When
- `gwrk plan critical` identifies the zero-slack path through the current project
- `gwrk plan critical` warns `⚠️ {id} has no SP estimate` for any critical-path node without SP
- `gwrk plan waves` groups tasks into mathematically parallelizable generations

### Phase 3: Graph Mutation & Lifecycle Hooks

Add capability to modify the plan via CLI and wire event hooks into `ShipOrchestrator` and `DefineOrchestrator`.

**Files (5):**
- `src/commands/plan.ts` (MODIFY: Add `add/remove`, `dep add/remove`, `set` subcommands)
- `src/engine/ship-orchestrator.ts` (MODIFY: Emit `plan:ship:complete` event)
- `src/engine/define-orchestrator.ts` (MODIFY: Emit `plan:define:complete` event)
- `src/engine/plan-store.ts` (MODIFY: Add mutation methods and hook handlers)
- `src/utils/state.ts` (MODIFY: Ensure SP additivity invariant check)

**Requirements Addressed:** FR-007, FR-008, FR-010, FR-011, FR-012, US-005, US-006, US-008, US-009, US-010

**Dependencies:** Phase 2

**Contract Mapping:**
- `contracts/plan.md` → `addPhase` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `removePhase` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `addEdge` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `removeEdge` → `src/engine/plan-store.ts`
- `contracts/plan.md` → `updatePhaseStatus` → `src/engine/plan-store.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-001 Task Tracking | Mutation gate enforcement |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018-004 | Unit | `src/engine/ship-orchestrator.ts` | Verify event emission on phase completion and status update |
| TR-018-002 | Unit | `src/engine/plan-store.ts` | Verify cycle detection on `dep add` |

#### Done When
- `gwrk plan dep add F005-P1 --on F014-R-P5` updates SQLite and shows in status
- Successful `gwrk ship` call automatically marks phase as `SHIPPED` in `gwrk plan status`

### Phase 4: Verification & Markdown Rendering

Implement drift detection to verify codebase state against the plan and provide the ability to regenerate `specs/000-build-plan.md`.

**Files (3):**
- `src/engine/drift-detector.ts` (NEW: Logic to detect .agents refs in SHIPPED phases)
- `src/engine/plan-renderer.ts` (NEW: Logic to generate Markdown from graph state)
- `src/commands/plan.ts` (MODIFY: Add `verify` and `render` subcommands)

**Requirements Addressed:** FR-006, FR-009, US-004, US-007, SC-003

**Dependencies:** Phase 3

**Contract Mapping:**
- `contracts/plan.md` → `verifyPlan` → `src/engine/drift-detector.ts`
- `contracts/plan.md` → `renderPlan` → `src/engine/plan-renderer.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| specify-sharpen | Quality check for rendered markdown |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018-005 | Unit | `src/engine/drift-detector.ts` | Detect `DRIFTED` if phase is SHIPPED but implementation artifacts remain in .agents/ |
| TR-018-003 | E2E | `src/commands/plan.ts` | `gwrk plan render` produces 000-build-plan.md with 100% fidelity |

#### Done When
- `gwrk plan verify` identifies drifted items in the current workspace
- `gwrk plan verify` reports features in `specs/` missing from graph and vice versa
- `gwrk plan render` overwrites 000-build-plan.md with updated status/edges

### Phase 5: Visualization & Monitoring

Add interactive graph visualization and heartbeat monitoring for Slack notifications.

**Files (4):**
- `src/server/plan-viz.ts` (NEW: Sigma.js HTML generation)
- `src/server/heartbeat.ts` (MODIFY: Add build plan health checks)
- `src/commands/plan.ts` (MODIFY: Add `viz` and `review` subcommands)
- `src/engine/plan-store.ts` (MODIFY: Proposal management)

**Requirements Addressed:** FR-014, FR-015, FR-016, US-012, US-013, US-014

**Dependencies:** Phase 4

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| ADR-003 State Contract | Monitoring and reporting standards |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-018-003 | E2E | `src/commands/plan.ts` | `gwrk plan viz --dry-run` exits 0 |
| TR-018-002 | Unit | `src/engine/plan-store.ts` | Verify proposal creation, approval, and rejection flows |

#### Done When
- `gwrk plan viz` opens a browser with the project dependency graph
- Heartbeat cron sends `STALE` alerts to Slack for unworked items

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| PlanFeature | `specs/018-build-plan-orchestrator/data-model.md` | `PlanStore`, CLI, Solver |
| PlanPhase | `specs/018-build-plan-orchestrator/data-model.md` | `PlanStore`, CLI, Solver, Orchestrators |
| PlanEdge | `specs/018-build-plan-orchestrator/data-model.md` | `PlanStore`, Solver |
| PlanPhaseStatus | `specs/018-build-plan-orchestrator/data-model.md` | `PlanStore`, CLI, Orchestrators |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 2 | PLANNED |
| US-002 | 2 | PLANNED |
| US-003 | 1 | PLANNED |
| US-004 | 4 | PLANNED |
| US-005 | 3 | PLANNED |
| US-006 | 3 | PLANNED |
| US-007 | 4 | PLANNED |
| US-008 | 1, 3 | PLANNED |
| US-009 | 3 | PLANNED |
| US-010 | 3 | PLANNED |
| US-011 | 1 | PLANNED |
| US-012 | 5 | PLANNED |
| US-013 | 5 | PLANNED |
| US-014 | 5 | PLANNED |
| US-015 | 2 | PLANNED |
| US-016 | 1 | PLANNED |
| US-017 | 2 | PLANNED |
| FR-001 | 1 | PLANNED |
| FR-002 | 2 | PLANNED |
| FR-003 | 2 | PLANNED |
| FR-004 | 2 | PLANNED |
| FR-005 | 1 | PLANNED |
| FR-006 | 4 | PLANNED |
| FR-007 | 3 | PLANNED |
| FR-008 | 3 | PLANNED |
| FR-009 | 4 | PLANNED |
| FR-010 | 3 | PLANNED |
| FR-011 | 3 | PLANNED |
| FR-012 | 3 | PLANNED |
| FR-013 | 1 | PLANNED |
| FR-014 | 5 | PLANNED |
| FR-015 | 5 | PLANNED |
| FR-016 | 5 | PLANNED |
| FR-017 | 1 | PLANNED |
| FR-018 | 1, 2 | PLANNED |
| FR-019 | 1 | PLANNED |
| DM-018-001 | 1 | PLANNED |
| DM-018-002 | 1 | PLANNED |
| DM-018-003 | 1 | PLANNED |
| DM-018-004 | 1 | PLANNED |
| TR-018-001 | 2 | PLANNED |
| TR-018-002 | 1, 3, 5 | PLANNED |
| TR-018-003 | 1, 4, 5 | PLANNED |
| TR-018-004 | 3 | PLANNED |
| TR-018-005 | 4 | PLANNED |
| TR-018-006 | 1 | PLANNED |
| VR-018-001 | ALL | PLANNED |
| VR-018-002 | 2 | PLANNED |
| VR-018-003 | 3 | PLANNED |
| SC-001 | 2 | PLANNED |
| SC-002 | 2 | PLANNED |
| SC-003 | 4 | PLANNED |
