# Feature Specification: 018 Build Plan Orchestrator

**Feature Branch**: `018-build-plan-orchestrator`
**Created**: 2026-04-02
**Status**: Draft
**Input**: Build plan as a solvable DAG — graph in SQLite, CPM solver, ready queue, event hooks from ship/define, drift detection

---

## 2. User Scenarios & Testing

### US-001 - Query Ready Work Items (Priority: P0)
As a Principal Engineer, I want `gwrk plan next` to show me which build plan items are ready to work on (all dependencies satisfied), ranked by critical path priority, so that I can make the highest-leverage decision without reading the entire build plan.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: `gwrk plan next --format json | jq '.[0].id'`

**Acceptance Scenarios**:
1. **Given** a seeded build plan with F014-R-P5 depending on F014-P4 (DONE), **When** `gwrk plan next` is run, **Then**:
   - `gwrk plan next | grep F014-R-P5` exits 0
2. **Given** `--format json`, **When** `gwrk plan next --format json` is run, **Then**:
   - `gwrk plan next --format json | jq '.[0].critical'` exits 0
3. **Given** all items are DONE, **When** `gwrk plan next` is run, **Then**:
   - `gwrk plan next | grep "All build plan items complete."` exits 0

### US-002 - View Critical Path (Priority: P0)
As a Principal Engineer, I want `gwrk plan critical` to show the critical path through the build plan (zero-slack items that determine total project duration), so that I know exactly which items to protect from delay.

**Implements**: FR-002, FR-004

**Independent Test**: `gwrk plan critical --format json | jq '.[].slack'`

**Acceptance Scenarios**:
1. **Given** a seeded build plan, **When** `gwrk plan critical` is run, **Then**:
   - `gwrk plan critical | grep "→"` exits 0
2. **Given** `--format json`, **When** `gwrk plan critical --format json` is run, **Then**:
   - `gwrk plan critical --format json | jq '[-1].ef'` exits 0

### US-003 - View Build Plan Status (Priority: P0)
As a Principal Engineer, I want `gwrk plan status` to show a per-phase status report of the entire build plan from structured data, so that I have a single source of truth that doesn't require reading 727 lines.

**Implements**: FR-005

**Independent Test**: `gwrk plan status --format json`

**Acceptance Scenarios**:
1. **Given** a seeded build plan, **When** `gwrk plan status` is run, **Then**:
   - `gwrk plan status | grep "F014"` exits 0
2. **Given** F014-P4 has sp_actual > sp_estimate, **When** `gwrk plan status` is run, **Then**:
   - `gwrk plan status | grep "sp_actual"` exits 0

### US-004 - Detect Drift Between Claimed and Actual State (Priority: P0)
As a Principal Engineer, I want `gwrk plan verify` to detect discrepancies between claimed build plan status and actual codebase state, so that status markers don't silently decay.

**Implements**: FR-006

**Independent Test**: `gwrk plan verify --format json`

**Acceptance Scenarios**:
1. **Given** F014-P6 status = DONE but .agents/ refs exist, **When** `gwrk plan verify` is run, **Then**:
   - `gwrk plan verify | grep "DRIFTED"` exits 0
2. **Given** a phase with status = SHIPPED and gates pass, **When** `gwrk plan verify` is run, **Then**:
   - `gwrk plan verify | grep "CLEAN"` exits 0

### US-005 - Automatic Status Update from Ship Completion (Priority: P0)
As the Ship Loop (F004), I want phase status to automatically update to SHIPPED when `gwrk ship` completes successfully, including sp_actual and duration, so that the build plan reflects reality without manual intervention.

**Implements**: FR-007, FR-008

**Independent Test**: `gwrk ship 014-plugin-system 4 && gwrk plan status --format json`

**Acceptance Scenarios**:
1. **Given** F014-P4 status = IN_PROGRESS, **When** `gwrk ship 014-plugin-system 4` completes, **Then**:
   - `gwrk plan status --format json | jq '.[] | select(.id == "F014-P4") | .status' | grep "SHIPPED"` exits 0

### US-006 - Automatic Status Update from Define Completion (Priority: P0)
As the Define Pipeline, I want phase status to automatically update as define commands complete, so that the pipeline feeds the build plan.

**Implements**: FR-008

**Acceptance Scenarios**:
1. **Given** F018-P1 status = PLANNED, **When** `gwrk define spec 018-build-plan-orchestrator` completes, **Then**:
   - `gwrk plan status --format json | jq '.[] | select(.id == "F018-P1") | .status' | grep "SPECIFIED"` exits 0

### US-007 - Render Build Plan from Solved State (Priority: P1)
As a Principal Engineer, I want `gwrk plan render` to generate `specs/000-build-plan.md` from the solved graph state, so that the markdown becomes an output.

**Implements**: FR-009

**Acceptance Scenarios**:
1. **Given** solved graph state, **When** `gwrk plan render` is run, **Then**:
   - `test -f specs/000-build-plan.md` exits 0

### US-008 - Add/Remove Build Plan Items (Priority: P0)
As a Principal Engineer (PM), I want `gwrk plan add` and `gwrk plan remove` to create and delete features/phases in the build plan graph.

**Implements**: FR-010

**Acceptance Scenarios**:
1. **Given** no F018, **When** `gwrk plan add feature F018 "Build Plan Orchestrator" --sp 25`, **Then**:
   - `gwrk plan status | grep F018` exits 0

### US-009 - Manage Dependencies (Priority: P0)
As a Principal Engineer (PM), I want `gwrk plan dep add/remove` to manage DEPENDS_ON edges between plan items.

**Implements**: FR-011

**Acceptance Scenarios**:
1. **Given** F005-P1 exists, **When** `gwrk plan dep add F005-P1 --on F014-R-P5`, **Then**:
   - `gwrk plan status --format json | jq '.[] | select(.id == "F005-P1") | .dependencies' | grep "F014-R-P5"` exits 0

### US-010 - Set Phase Status Manually (Priority: P0)
As a Principal Engineer (PM), I want `gwrk plan set` to manually set status, SP, or health on plan items.

**Implements**: FR-012

**Acceptance Scenarios**:
1. **Given** F014-P4 SHIPPED, **When** `gwrk plan set F014-P4 --status DONE`, **Then**:
   - `gwrk plan status --format json | jq '.[] | select(.id == "F014-P4") | .status' | grep "DONE"` exits 0

### US-011 - Seed Build Plan from Existing Markdown (Priority: P0)
As a Principal Engineer, I want `gwrk plan seed` to initialize the SQLite graph from the current `specs/000-build-plan.md`.

**Implements**: FR-013

**Acceptance Scenarios**:
1. **Given** `000-build-plan.md`, **When** `gwrk plan seed`, **Then**:
   - `gwrk plan status | grep "F001"` exits 0

### US-012 - View Interactive Graph Visualization (Priority: P2)
As a Principal Engineer, I want `gwrk plan viz` to open a sigma.js interactive graph visualization in my browser.

**Implements**: FR-014

**Acceptance Scenarios**:
1. **Given** a seeded build plan, **When** `gwrk plan viz` is run, **Then**:
   - `gwrk plan viz --dry-run` exits 0

### US-013 - Heartbeat Health Monitoring (Priority: P2)
As the gwrk-ops agent, I want a periodic heartbeat to check the build plan for stale items, drifted items, and blocked items, and report findings to the Slack project channel.

**Implements**: FR-015

**Acceptance Scenarios**:
1. **Given** F006 stale, **When** heartbeat runs, **Then**:
   - `gwrk plan status --format json | jq '.[] | select(.id == "F006") | .health' | grep "STALE"` exits 0

### US-014 - Review Agent Proposals (Priority: P1)
As a Principal Engineer (PM), I want `gwrk plan review` to show pending proposals from agents and approve/reject them.

**Implements**: FR-016

**Acceptance Scenarios**:
1. **Given** a proposal exists, **When** `gwrk plan review` is run, **Then**:
   - `gwrk plan review | grep "Proposal"` exits 0

### US-015 - Compute Topological Waves (Priority: P1)
As a Principal Engineer, I want `gwrk plan waves` to show the mathematically computed parallel execution waves.

**Implements**: FR-002

**Acceptance Scenarios**:
1. **Given** a seeded build plan, **When** `gwrk plan waves` is run, **Then**:
   - `gwrk plan waves | grep "Wave 1"` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._
_Only PM can set status to DONE or approve proposals (Tier 3 Governance)._

---

## 4. Functional Requirements

- **FR-001**: System MUST store the build plan as a directed acyclic graph in SQLite with tables: `plan_features`, `plan_phases`, `plan_edges`. (Implements: US-001, US-003, US-008)
- **FR-002**: System MUST load the SQLite graph into `graphology` and compute topological sort, generations, and CPM. (Implements: US-001, US-002, US-015)
- **FR-003**: System MUST compute the ready queue using Kahn's algorithm, sorted by critical path priority. (Implements: US-001)
- **FR-004**: System MUST implement Critical Path Method (Forward/Backward pass) using SP as duration unit. (Implements: US-002)
- **FR-005**: System MUST provide `gwrk plan status` with health flags and JSON support. (Implements: US-003)
- **FR-006**: System MUST provide `gwrk plan verify` for drift detection against code state and gate results. (Implements: US-004)
- **FR-007**: `ShipOrchestrator.run()` MUST emit `plan:ship:complete` event to update status, SP actual, and duration. (Implements: US-005)
- **FR-008**: Define commands MUST emit `plan:define:complete` events to update status to SPECIFIED/DEFINED. (Implements: US-006)
- **FR-009**: System MUST provide `gwrk plan render` to generate `specs/000-build-plan.md` from graph state. (Implements: US-007)
- **FR-010**: System MUST provide `gwrk plan add/remove` for node management with cascade edge deletion. (Implements: US-008)
- **FR-011**: System MUST provide `gwrk plan dep add/remove` with cycle detection. (Implements: US-009)
- **FR-012**: System MUST provide `gwrk plan set` for manual overrides (DONE, REWORK, health). (Implements: US-010)
- **FR-013**: System MUST provide `gwrk plan seed` to initialize graph from existing markdown. (Implements: US-011)
- **FR-014**: System MUST provide `gwrk plan viz` for interactive sigma.js visualization. (Implements: US-012)
- **FR-015**: System MUST provide heartbeat cron for staleness, drift, and Slack reporting. (Implements: US-013)
- **FR-016**: System MUST provide `gwrk plan review` to display, approve, and reject agent proposals. (Implements: US-014)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Cycle detected | `Error: Dependency cycle detected` | 1 |
| Feature not found | `Feature not found` | 1 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No build plan | `No build plan data. Run 'gwrk plan seed'` | 1 |

---

## 5. Data Model Requirements

### DM-018-001: plan_features
- id (TEXT PRIMARY KEY)
- name (TEXT)
- status (TEXT)
- sp_total (INTEGER)

### DM-018-002: plan_phases
- id (TEXT PRIMARY KEY)
- feature_id (TEXT REFERENCES plan_features)
- name (TEXT)
- status (TEXT)
- health (TEXT)
- sp_estimate (INTEGER)
- sp_actual (INTEGER)
- duration_ms (INTEGER)
- completed_at (TEXT)
- evidence (TEXT)
- seq (INTEGER)

### DM-018-003: plan_edges
- from_id (TEXT)
- to_id (TEXT)
- edge_type (TEXT)
- PRIMARY KEY (from_id, to_id, edge_type)

### DM-018-004: plan_proposals
- id (TEXT PRIMARY KEY)
- target_phase_id (TEXT)
- proposal_type (TEXT)
- detail (TEXT)
- source (TEXT)
- status (TEXT)

---

## 6. Technical Constraints

- **TC-001**: Air-Gapped — No external network calls at runtime. No CDN. No telemetry.
- **TC-002**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-003**: TypeScript Only — No `.js` or `.jsx` in `src/`. ESM modules, ES2022 target.
- **TC-004**: Graph library MUST be `graphology` (pure JS, zero native deps).
- **TC-005**: Database MUST be SQLite (shared ADR-002 ledger).

---

## 7. Testing Requirements

- **TR-018-001**: `src/engine/plan-solver.ts` — Verify Kahn's algorithm and CPM correctness with mock graphs. Vitest. (FR-002, FR-003, FR-004)
- **TR-018-002**: `src/db/plan-store.ts` — Verify SQLite CRUD operations and recursive CTE traversal for dependencies. Vitest. (FR-001)
- **TR-018-003**: `src/commands/plan.ts` — E2E test for `gwrk plan seed` followed by `gwrk plan next`. Assert JSON output structure. Vitest. (FR-005, FR-013)
- **TR-018-004**: `src/engine/ship-orchestrator.ts` — Verify event emission on phase completion and state update in SQLite. Vitest. (FR-007)
- **TR-018-005**: `src/engine/drift-detector.ts` — Verify detection of known drift patterns (e.g. .agents refs). Vitest. (FR-006)

---

## 8. Success Criteria

- **SC-001**: `gwrk plan next` returns ready items in <100ms.
- **SC-002**: Critical path identified correctly for Wave 4 rework scenario.
- **SC-003**: 000-build-plan.md regenerated automatically from SQLite state with 100% fidelity.

---

## 9. Verification Requirements

- **VR-018-001**: `gwrk test 018-build-plan-orchestrator` passes all unit and integration tests.
- **VR-018-002**: Seed current build plan, then `gwrk plan next` correctly identifies F014-R-P5 as next critical item.
- **VR-018-003**: Simulate `gwrk ship` completion and verify SQLite status transitions to SHIPPED.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001, US-003, US-008 | TR-018-002 |
| US-002 | FR-002, FR-004 | FR-002 | US-001, US-002, US-015 | TR-018-001 |
| US-003 | FR-005 | FR-003 | US-001 | TR-018-001 |
| US-004 | FR-006 | FR-004 | US-002 | TR-018-001 |
| US-005 | FR-007, FR-008 | FR-005 | US-003 | TR-018-003 |
| US-006 | FR-008 | FR-006 | US-004 | TR-018-005 |
| US-007 | FR-009 | FR-007 | US-005 | TR-018-004 |
| US-008 | FR-010 | FR-008 | US-005, US-006 | TR-018-003 |
| US-009 | FR-011 | FR-009 | US-007 | TR-018-003 |
| US-010 | FR-012 | FR-010 | US-008 | TR-018-002 |
| US-011 | FR-013 | FR-011 | US-009 | TR-018-002 |
| US-012 | FR-014 | FR-012 | US-010 | TR-018-002 |
| US-013 | FR-015 | FR-013 | US-011 | TR-018-003 |
| US-014 | FR-016 | FR-014 | US-012 | DEFERRED |
| US-015 | FR-002 | FR-015 | US-013 | DEFERRED |
| | | FR-016 | US-014 | TR-018-002 |
