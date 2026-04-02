# R005 — F018 Build Plan Orchestrator: Spec Input Document

> **Status:** Draft — Ready for `gwrk define spec`
> **Research:** [R005 brief](file:///Users/gonzo/Code/gwrk/docs/research/R005-better-build-plan/brief.md) + [R005 draft](file:///Users/gonzo/Code/gwrk/docs/research/R005-better-build-plan/draft.md)
> **PM Decisions:** Locked 2026-04-02

---

## PM Decisions (Locked)

| # | Decision | Detail |
|---|----------|--------|
| 1 | Feature number | F018 |
| 2 | CLI pillar | `gwrk plan` — new pillar command, part of F001 rework |
| 3 | Drift detection | Warn only. Blocking is a harvest concern (F011) |
| 4 | Priority | F018-P1+P2 ships before F014-R-P5 |
| 5 | Visualization | sigma.js for interactive graph. Links served on-demand via build server, shared in Slack. Post-F003-Slack rework |
| 6 | Editing | First-class `gwrk plan edit` commands. Gantt view preferred (future), mermaid interim. sigma.js is read-only |

---

## 1. Problem Statement

`specs/000-build-plan.md` is a 727-line passive markdown scratchpad. It drifts from reality because nothing actively maintains it. When `gwrk ship` completes a phase, the build plan doesn't update. When research discovers rework, cascade propagation is manual. When agents claim completeness, nobody verifies. The PM re-reads the entire file and re-derives critical path by hand. LLM agents drown in 42KB of context trying to assist.

The build plan is Foxtrot Charlie's "Internal Roadmap: The Commitment Spine" (Definition Pillar §2) but it has no spine — no state, no computation, no feedback loops. It violates FC Invariant 2: "Reality is expressed as state, not narrative."

**The fix:** The build plan is a **directed acyclic graph (DAG) to solve.** Every question — "what next?", "what's blocking?", "what's the fastest path?" — is a graph query, not a document scan.

---

## 2. User Scenarios & Testing

### US-001 — Query Ready Work Items (Priority: P0)

As a **Principal Engineer**, I want `gwrk plan next` to show me which build plan items are ready to work on (all dependencies satisfied), ranked by critical path priority, so that I can make the highest-leverage decision without reading the entire build plan.

**Implements:** FR-001, FR-002, FR-003

**Independent Test:** `gwrk plan next --format json | jq '.[0].id'` returns a phase ID.

**Acceptance Scenarios:**
1. **Given** a seeded build plan with F014-R-P5 depending on F014-P4 (DONE), **When** `gwrk plan next` is run, **Then:**
   - F014-R-P5 appears in the ready queue
   - Output includes: id, name, sp_estimate, critical (boolean), slack
   - Items are sorted by slack ascending (critical first)
2. **Given** `--format json`, **When** `gwrk plan next --format json` is run, **Then:**
   - `jq '.[].critical'` shows `true` for zero-slack items
   - `jq '. | length'` returns count of ready items
3. **Given** all items are DONE, **When** `gwrk plan next` is run, **Then:**
   - stdout: `All build plan items complete.`
   - Exit code: 0

---

### US-002 — View Critical Path (Priority: P0)

As a **Principal Engineer**, I want `gwrk plan critical` to show the critical path through the build plan (zero-slack items that determine total project duration), so that I know exactly which items to protect from delay.

**Implements:** FR-002, FR-004

**Independent Test:** `gwrk plan critical --format json | jq '.[].slack'` returns all `0`.

**Acceptance Scenarios:**
1. **Given** a seeded build plan, **When** `gwrk plan critical` is run, **Then:**
   - Output lists the critical path as an ordered chain: `F014-R-P5 → F004-R → F005-P1 → ...`
   - Each item shows: id, name, sp_estimate, earliest_start, latest_finish
   - Total SP on critical path is shown
2. **Given** `--format json`, **When** `gwrk plan critical --format json` is run, **Then:**
   - `jq '[-1].ef'` returns the total project duration in SP

---

### US-003 — View Build Plan Status (Priority: P0)

As a **Principal Engineer**, I want `gwrk plan status` to show a per-phase status report of the entire build plan from structured data, so that I have a single source of truth that doesn't require reading 727 lines.

**Implements:** FR-005

**Independent Test:** `gwrk plan status --format json | jq '. | length'` returns the number of features.

**Acceptance Scenarios:**
1. **Given** a seeded build plan, **When** `gwrk plan status` is run, **Then:**
   - Output shows each feature with its phases, status, health, SP estimate, and SP actual
   - Status uses the FSM states: PLANNED, SPECIFIED, DEFINED, IN_PROGRESS, SHIPPED, VERIFIED, DONE, REWORK
   - Health flags: CLEAN, DRIFTED, STALE, BLOCKED
2. **Given** F014-P4 has `sp_actual > sp_estimate`, **When** `gwrk plan status` is run, **Then:**
   - F014-P4 shows both values, enabling effort tracking

---

### US-004 — Detect Drift Between Claimed and Actual State (Priority: P0)

As a **Principal Engineer**, I want `gwrk plan verify` to detect discrepancies between claimed build plan status and actual codebase state, so that status markers don't silently decay.

**Implements:** FR-006

**Independent Test:** `gwrk plan verify --format json | jq '.[].drifted'` shows drift flags.

**Acceptance Scenarios:**
1. **Given** F014-P6 (init overhaul) status = DONE but `init.ts` still contains `.agents/` references, **When** `gwrk plan verify` is run, **Then:**
   - F014-P6 is flagged as DRIFTED
   - Output shows: expected (DONE), actual (code still has hardcoded paths), evidence (file:line references)
2. **Given** a phase with status = SHIPPED and all gate scripts passing, **When** `gwrk plan verify` is run, **Then:**
   - Phase shows CLEAN health
3. **Given** `--fix` flag, **When** `gwrk plan verify --fix` is run, **Then:**
   - DRIFTED phases have health flag updated to DRIFTED in SQLite
   - Summary printed: `N phases verified, M drifted, K stale`

---

### US-005 — Automatic Status Update from Ship Completion (Priority: P0)

As the **Ship Loop (F004)**, I want phase status to automatically update to SHIPPED when `gwrk ship` completes successfully, including sp_actual and duration, so that the build plan reflects reality without manual intervention.

**Implements:** FR-007, FR-008

**Independent Test:** Run `gwrk ship 014-plugin-system 4` → verify `gwrk plan status --format json | jq '.[] | select(.id == "F014-P4") | .status'` returns `"SHIPPED"`.

**Acceptance Scenarios:**
1. **Given** F014-P4 status = IN_PROGRESS, **When** `gwrk ship 014-plugin-system 4` completes with exit 0, **Then:**
   - `plan_phases` row for F014-P4: status = SHIPPED, sp_actual = (from execution manifest), duration_ms = (from run), evidence = (path to manifest)
2. **Given** `gwrk ship` fails (exit non-zero), **When** ship exits, **Then:**
   - Status stays IN_PROGRESS
   - A proposal is created: "F014-P4 ship failed. Rework iteration N. Consider SP adjustment."
3. **Given** `gwrk ship` starts for a PLANNED phase, **When** first dispatch begins, **Then:**
   - Status transitions: PLANNED → IN_PROGRESS

---

### US-006 — Automatic Status Update from Define Completion (Priority: P0)

As the **Define Pipeline**, I want phase status to automatically update as define commands complete (SPECIFIED after spec, DEFINED after tasks), so that the pipeline feeds the build plan.

**Implements:** FR-008

**Acceptance Scenarios:**
1. **Given** F018-P1 status = PLANNED, **When** `gwrk define spec 018-build-plan-orchestrator` completes, **Then:**
   - F018-P1 status → SPECIFIED
2. **Given** F018-P1 status = SPECIFIED, **When** `gwrk define tasks 018-build-plan-orchestrator` completes, **Then:**
   - F018-P1 status → DEFINED, sp_estimate updated from tasks.json

---

### US-007 — Render Build Plan from Solved State (Priority: P1)

As a **Principal Engineer**, I want `gwrk plan render` to generate `specs/000-build-plan.md` from the solved graph state, so that the markdown becomes an output (not a hand-maintained input).

**Implements:** FR-009

**Acceptance Scenarios:**
1. **Given** solved graph state, **When** `gwrk plan render` is run, **Then:**
   - `specs/000-build-plan.md` is regenerated with:
     - Mermaid dependency graph (from plan_edges)
     - Per-feature sections with per-phase status (from solver)
     - Wave strategy (from topologicalGenerations)
     - Critical path annotation
     - Effort table (sp_estimate vs sp_actual)
2. **Given** `--stdout`, **When** `gwrk plan render --stdout`, **Then:**
   - Rendered markdown goes to stdout (does not overwrite file)

---

### US-008 — Add/Remove Build Plan Items (Priority: P0)

As a **Principal Engineer (PM)**, I want `gwrk plan add` and `gwrk plan remove` to create and delete features/phases in the build plan graph, so that the plan can evolve without editing SQLite directly.

**Implements:** FR-010

**Acceptance Scenarios:**
1. **Given** no F018 in the plan, **When** `gwrk plan add feature F018 "Build Plan Orchestrator" --sp 25`, **Then:**
   - `plan_features` row created with id=F018, name="Build Plan Orchestrator", sp_total=25
   - `gwrk plan status | grep F018` exits 0
2. **Given** F018 exists, **When** `gwrk plan add phase F018-P1 "Data Model + Seed" --sp 5 --feature F018`, **Then:**
   - `plan_phases` row created, CONTAINS edge added from F018 to F018-P1
3. **Given** F018-P1 exists, **When** `gwrk plan remove F018-P1`, **Then:**
   - Phase deleted, all edges involving F018-P1 deleted
   - Dependent phases warned: `Warning: F018-P2 depends on F018-P1. Remove dependency? [y/N]`

---

### US-009 — Manage Dependencies (Priority: P0)

As a **Principal Engineer (PM)**, I want `gwrk plan dep add/remove` to manage DEPENDS_ON edges between plan items, so that the dependency graph reflects reality.

**Implements:** FR-011

**Acceptance Scenarios:**
1. **Given** F005-P1 and F014-R-P5 exist, **When** `gwrk plan dep add F005-P1 --on F014-R-P5`, **Then:**
   - DEPENDS_ON edge created from F005-P1 to F014-R-P5
   - Cycle check runs. If cycle detected: `Error: Adding this dependency would create a cycle: F005-P1 → F014-R-P5 → ... → F005-P1`
2. **Given** dependency exists, **When** `gwrk plan dep remove F005-P1 --on F014-R-P5`, **Then:**
   - Edge deleted. Graph re-solved.

---

### US-010 — Set Phase Status Manually (Priority: P0)

As a **Principal Engineer (PM)**, I want `gwrk plan set` to manually set status, SP, or health on plan items, because only the PM can mark items DONE and some corrections require manual override.

**Implements:** FR-012

**Acceptance Scenarios:**
1. **Given** F014-P4 status = SHIPPED, **When** `gwrk plan set F014-P4 --status DONE`, **Then:**
   - Status → DONE. Only PM-tier action.
2. **Given** F014-P4 sp_estimate = 3, **When** `gwrk plan set F014-P4 --sp-estimate 8`, **Then:**
   - SP updated, CPM recomputed, critical path recalculated
3. **Given** a phase in DONE status, **When** `gwrk plan set F014-P6 --status REWORK`, **Then:**
   - Status → REWORK. All dependents' health → BLOCKED. Re-solve triggered.

---

### US-011 — Seed Build Plan from Existing Markdown (Priority: P0)

As a **Principal Engineer**, I want `gwrk plan seed` to initialize the SQLite graph from the current `specs/000-build-plan.md`, so that migration from passive to active is a single command.

**Implements:** FR-013

**Acceptance Scenarios:**
1. **Given** `000-build-plan.md` exists with ~17 features and ~50 phases, **When** `gwrk plan seed`, **Then:**
   - All features, phases, and dependency edges populated in SQLite
   - `gwrk plan status` matches the markdown's content
   - Existing ✅/⚠️/🔴 markers mapped to FSM states
2. **Given** `--dry-run`, **When** `gwrk plan seed --dry-run`, **Then:**
   - Lists what would be created without writing to SQLite

---

### US-012 — View Interactive Graph Visualization (Priority: P2)

As a **Principal Engineer**, I want `gwrk plan viz` to open a sigma.js interactive graph visualization in my browser, so that I can see the dependency structure, critical path, and status visually.

**Implements:** FR-014

**Acceptance Scenarios:**
1. **Given** a seeded build plan, **When** `gwrk plan viz` is run, **Then:**
   - Build server starts (or uses existing F002 instance) and opens a browser tab
   - sigma.js renders the DAG with: node colors by status, edge thickness by type, critical path highlighted
   - Hovering a node shows: name, status, health, SP, slack
   - Graph is read-only (no editing via viz — use CLI)
2. **Given** Slack integration active, **When** someone requests plan status in a project channel, **Then:**
   - gwrk-ops posts a link to the visualization endpoint

---

### US-013 — Heartbeat Health Monitoring (Priority: P2)

As the **gwrk-ops agent**, I want a periodic heartbeat to check the build plan for stale items (no activity in N days), drifted items, and blocked items, and report findings to the Slack project channel.

**Implements:** FR-015

**Acceptance Scenarios:**
1. **Given** F006 has had no status changes in 14+ days, **When** the heartbeat runs, **Then:**
   - F006 health → STALE
   - Slack message posted: "🟡 F006 (Pulse Scanner) — No activity in 14 days. Status: PLANNED."
2. **Given** heartbeat finds 3 DRIFTED items, **When** heartbeat completes, **Then:**
   - Slack summary: "Build plan health: 12 CLEAN, 3 DRIFTED, 2 STALE, 1 BLOCKED"

---

### US-014 — Review Agent Proposals (Priority: P1)

As a **Principal Engineer (PM)**, I want `gwrk plan review` to show pending proposals from agents (SP adjustments, rework flags, drift warnings) and approve/reject them, so that agents can observe and propose but never decide.

**Implements:** FR-016

**Acceptance Scenarios:**
1. **Given** ship failure created a proposal "F014-P4: consider SP adjustment from 3 to 8 (4 iterations)", **When** `gwrk plan review`, **Then:**
   - Proposal shown with evidence (iteration count, duration)
   - PM can approve (applies the change) or reject (dismisses)
2. **Given** no pending proposals, **When** `gwrk plan review`, **Then:**
   - stdout: `No pending proposals.`

---

### US-015 — Compute Topological Waves (Priority: P1)

As a **Principal Engineer**, I want `gwrk plan waves` to show the mathematically computed parallel execution waves, so that I don't hand-curate wave strategy.

**Implements:** FR-002

**Acceptance Scenarios:**
1. **Given** a seeded build plan, **When** `gwrk plan waves` is run, **Then:**
   - Output shows generations: Wave 1 (no deps), Wave 2 (depends on Wave 1), etc.
   - Items within a wave are parallelizable
   - `--format json` produces `[["F000","F001"], ["F013","F014-P1-P4"], ...]`

---

## 3. Functional Requirements

### Graph Data Model

- **FR-001**: System MUST store the build plan as a directed acyclic graph in SQLite with three tables: `plan_features` (id, name, status, sp_total), `plan_phases` (id, feature_id, name, status, health, sp_estimate, sp_actual, duration_ms, completed_at, evidence, seq), and `plan_edges` (from_id, to_id, edge_type). Edge types: `DEPENDS_ON`, `CONTAINS`, `SEQUENCE`, `INVALIDATES`. (Implements: US-001 through US-011)
- **FR-002**: System MUST load the SQLite graph into a `graphology` `DirectedGraph` in-memory and compute: (a) `topologicalSort` for valid execution order, (b) `topologicalGenerations` for parallel waves, (c) `hasCycle` / `willCreateCycle` for validation, (d) CPM forward/backward pass for critical path analysis. (Implements: US-001, US-002, US-015)
- **FR-003**: System MUST compute the ready queue using Kahn's algorithm: a phase is "ready" when all `DEPENDS_ON` predecessors have status = `DONE` and the phase itself is not `DONE` or `IN_PROGRESS`. Ready items MUST be sorted by slack ascending (critical first), then by Most Successors First (highest downstream impact). (Implements: US-001)

### Solver & CPM

- **FR-004**: System MUST implement Critical Path Method with forward pass (ES/EF computation) and backward pass (LS/LF computation). Slack = LS - ES. Critical path = all nodes where slack = 0. Project duration = max EF of all terminal nodes. SP used as duration unit. (Implements: US-002)

### Status & Querying

- **FR-005**: System MUST provide `gwrk plan status` that reads from SQLite and displays per-feature, per-phase status with health flags. Supports `--format json`. (Implements: US-003)

### Drift Detection

- **FR-006**: System MUST provide `gwrk plan verify` that checks claimed status against code reality. Verification rules: (a) SHIPPED/VERIFIED/DONE phases are checked for gate script pass/fail, (b) phases claiming DONE are checked for known code-level issues (`.agents/` refs for F014 phases). Results are warnings only (not blockers). `--fix` flag updates health flags in SQLite. (Implements: US-004)

### Event Hooks

- **FR-007**: `ShipOrchestrator.run()` MUST emit a `plan:ship:complete` event on successful exit that updates the phase's status to SHIPPED, records sp_actual (from execution manifest), duration_ms, and evidence link. On failure, a proposal MUST be created with iteration count and suggested SP adjustment. (Implements: US-005)
- **FR-008**: `gwrk define spec|plan|tasks` commands MUST emit `plan:define:complete` events that update the phase's status to SPECIFIED (after spec) or DEFINED (after tasks). (Implements: US-006)

### Rendering

- **FR-009**: System MUST provide `gwrk plan render` that generates `specs/000-build-plan.md` from solved graph state. Output includes: mermaid dependency graph, per-feature sections with per-phase status, computed wave strategy, critical path annotations, effort table. `--stdout` prints to stdout without overwriting file. (Implements: US-007)

### Graph Mutation (PM Commands)

- **FR-010**: System MUST provide `gwrk plan add feature|phase` and `gwrk plan remove <id>` for creating and deleting nodes. Remove MUST cascade-delete edges and warn about dependent nodes. (Implements: US-008)
- **FR-011**: System MUST provide `gwrk plan dep add|remove` for managing DEPENDS_ON edges. Adding edges MUST run `willCreateCycle()` and reject cycles with error. (Implements: US-009)
- **FR-012**: System MUST provide `gwrk plan set <id> --status|--sp-estimate|--sp-actual|--health` for manual overrides. Only DONE status requires this command (automated status stops at SHIPPED/VERIFIED). Setting status to REWORK MUST propagate BLOCKED health to all dependents. (Implements: US-010)

### Migration

- **FR-013**: System MUST provide `gwrk plan seed` that parses `specs/000-build-plan.md` and imports features, phases, dependency edges, and status markers into SQLite. Status mapping: ✅ → DONE, ⚠️ → SHIPPED, 🔴 → PLANNED, ⚫ → RETIRED. `--dry-run` lists without writing. (Implements: US-011)

### Visualization

- **FR-014**: System MUST provide `gwrk plan viz` that serves a sigma.js interactive graph via the build server (F002). Graph coloring by status, edge rendering by type, critical path highlighting, hover tooltips. Read-only (no editing in the UI). (Implements: US-012)

### Heartbeat

- **FR-015**: System MUST provide a heartbeat mechanism (build server cron job, configurable interval, default 4h) that: (a) detects stale items (no status change in configurable N days, default 14), (b) counts DRIFTED items, (c) posts health summary to Slack project channel via F003 webhook. (Implements: US-013)

### Governance

- **FR-016**: System MUST provide `gwrk plan review` to display, approve, and reject pending proposals. Proposals are stored in a `plan_proposals` SQLite table with: id, target_phase_id, proposal_type (SP_ADJUSTMENT, REWORK_FLAG, DRIFT_WARNING), detail, source (ship:fail, verify:drift, etc.), created_at, status (PENDING, APPROVED, REJECTED). (Implements: US-014)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Cycle detected on edge add | `Error: Dependency cycle detected: A → B → ... → A` | 1 |
| Feature not found | `Feature 'F099' not found. Run 'gwrk plan status' to see features.` | 1 |
| Phase not found | `Phase 'F099-P1' not found.` | 1 |

#### FR-006 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No build plan seeded | `No build plan data. Run 'gwrk plan seed' first.` | 1 |
| Gate script not found | `Gate script not found for phase F014-P4. Skipping verification.` | 0 (warn) |

#### FR-013 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Build plan file not found | `specs/000-build-plan.md not found.` | 1 |
| Already seeded | `Build plan already seeded. Use --force to re-seed (destructive).` | 1 |
| Parse error | `Failed to parse build plan: <detail>. Manual intervention required.` | 1 |

---

## 4. Data Model Requirements

### DM-001: Plan Features

```typescript
interface PlanFeature {
  id: string;           // "F018"
  name: string;         // "Build Plan Orchestrator"
  status: FeatureStatus;// Derived: min(phase statuses)
  sp_total: number;     // Sum of phase estimates
  created_at: string;
  updated_at: string;
}
```

### DM-002: Plan Phases

```typescript
type PhaseStatus =
  | 'PLANNED'    // Exists in graph, no spec
  | 'SPECIFIED'  // spec.md exists
  | 'DEFINED'    // plan.md + tasks.json exist
  | 'IN_PROGRESS'// gwrk ship started
  | 'SHIPPED'    // gwrk ship completed
  | 'VERIFIED'   // Gates pass, code review GO
  | 'DONE'       // PM accepts (only PM can set)
  | 'REWORK'     // Re-opened after SHIPPED/VERIFIED
  | 'RETIRED';   // Cancelled/removed

type HealthFlag = 'CLEAN' | 'DRIFTED' | 'STALE' | 'BLOCKED';

interface PlanPhase {
  id: string;            // "F018-P1"
  feature_id: string;    // "F018"
  name: string;          // "Data Model + Seed"
  status: PhaseStatus;
  health: HealthFlag;
  sp_estimate: number;
  sp_actual?: number;
  duration_ms?: number;
  completed_at?: string;
  evidence?: string;     // Path to execution manifest
  seq: number;           // Ordering within feature
  created_at: string;
  updated_at: string;
}
```

### DM-003: Plan Edges

```typescript
type EdgeType = 'DEPENDS_ON' | 'CONTAINS' | 'SEQUENCE' | 'INVALIDATES';

interface PlanEdge {
  from_id: string;       // Source node
  to_id: string;         // Target node
  edge_type: EdgeType;
  created_at: string;
}
```

### DM-004: Plan Proposals

```typescript
type ProposalType = 'SP_ADJUSTMENT' | 'REWORK_FLAG' | 'DRIFT_WARNING';
type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface PlanProposal {
  id: string;
  target_phase_id: string;
  proposal_type: ProposalType;
  detail: string;         // Human-readable description
  evidence?: string;       // Link to source (manifest, verify output)
  source: string;          // "ship:fail", "verify:drift", "heartbeat:stale"
  created_at: string;
  status: ProposalStatus;
  resolved_at?: string;
}
```

### DM-005: CPM Results (in-memory, not persisted)

```typescript
interface CPMResult {
  node: string;
  es: number;      // Earliest start (SP units)
  ef: number;      // Earliest finish
  ls: number;      // Latest start
  lf: number;      // Latest finish
  slack: number;   // LS - ES
  critical: boolean; // slack === 0
}
```

---

## 5. Technical Constraints

- **TC-001**: graph is stored in SQLite (ADR-002 extension) — no external graph database
- **TC-002**: graph is loaded into `graphology` DirectedGraph in-memory for solving — ~50 nodes, <1ms
- **TC-003**: `graphology` + `graphology-dag` as dependencies — pure JS, zero native deps
- **TC-004**: No `.default()` in Zod schemas — fail fast on missing config
- **TC-005**: TypeScript only — no `.js` in `src/`
- **TC-006**: Event hooks are function calls inside existing orchestrators, not pub/sub infrastructure
- **TC-007**: sigma.js visualization is served via build server (F002), not a separate service
- **TC-008**: `gwrk plan seed` is a one-time migration — after that, SQLite is source of truth
- **TC-009**: Heartbeat uses build server cron — no external scheduler dependency
- **TC-010**: All PM-authority operations (`set --status DONE`, `review approve`) require interactive confirmation

---

## 6. Library Stack

| Library | Purpose | Size | Notes |
|---------|---------|------|-------|
| `graphology` | Graph data structure (DirectedGraph) | 43KB min | Pure JS |
| `graphology-dag` | topologicalSort, topologicalGenerations, hasCycle, willCreateCycle | ~5KB | Pure JS |
| `better-sqlite3` | Already in stack (ADR-002) | — | Existing dep |
| `sigma` | Graph visualization (P5 only) | ~200KB | Canvas-based, F002 serves |

---

## 7. Phase Plan

| Phase | Content | SP | Dependencies |
|-------|---------|-----|---|
| **P1: Data Model + Seed** | SQLite schema, migration, `gwrk plan seed` from 000-build-plan.md, `gwrk plan status` | 5 | None |
| **P2: Solver + CLI** | graphology integration, ready queue, CPM, `gwrk plan next`, `gwrk plan critical`, `gwrk plan waves` | 5 | P1 |
| **P3: Graph Mutation** | `gwrk plan add/remove`, `gwrk plan dep add/remove`, `gwrk plan set`, cycle detection | 5 | P1 |
| **P4: Event Hooks** | ship:complete, define:complete hooks, `gwrk plan verify`, `gwrk plan render` | 5 | P2, P3 |
| **P5: Viz + Heartbeat + Governance** | sigma.js viz, heartbeat cron, proposal flow, `gwrk plan review` | 5 | P4, F002, F003 |
| **Total** | | **25** | |

```
P1 → P2 → P4 → P5
P1 → P3 → P4
```

---

## 8. F001 Rework Impact

`gwrk plan` becomes a new CLI pillar command. This requires:
- New command file: `src/commands/plan.ts` with subcommands (next, critical, status, verify, render, add, remove, dep, set, seed, viz, review, waves)
- Registration in `src/commands/index.ts`
- Help text following F013 agent-native contract
- `--format json` on all query commands

---

## 9. Integration Map

```
┌─────────────┐     ship:complete      ┌──────────────────┐
│ Ship Loop   │ ──────────────────────→ │ Build Plan Graph │
│ (F004)      │     ship:fail           │ (F018)           │
│             │ ── proposal ──────────→ │                  │
└─────────────┘                         │  ┌─────────────┐ │
                                        │  │ SQLite      │ │
┌─────────────┐     define:complete     │  │ (storage)   │ │
│ Define      │ ──────────────────────→ │  └──────┬──────┘ │
│ Pipeline    │                         │         │        │
└─────────────┘                         │  ┌──────▼──────┐ │
                                        │  │ graphology  │ │
┌─────────────┐     harvest:done        │  │ (solver)    │ │
│ Harvest     │ ── verify trigger ────→ │  └──────┬──────┘ │
│ (F011)      │                         │         │        │
└─────────────┘                         │  ┌──────▼──────┐ │
                                        │  │ Render/Viz  │ │
┌─────────────┐     heartbeat           │  │ (output)    │ │
│ Build       │ ←─── cron ────────────→ │  └─────────────┘ │
│ Server      │                         └──────────────────┘
│ (F002)      │     sigma.js serve
│             │ ←──────────────────────
└─────────────┘

┌─────────────┐     health summary
│ Slack       │ ←──────────────────────
│ (F003)      │     viz links
└─────────────┘
```

---

## 10. Open Items (Post-PM-Decision)

| # | Item | Decision Needed |
|---|------|----------------|
| 1 | `gwrk plan seed` parser: regex-based extraction from markdown, or ask PM to provide structured YAML first? | Implementation decision (engineer) |
| 2 | Gantt editing UI: defer entirely to post-P5, or stub the interface contract in P3? | PM decision |
| 3 | Should `gwrk plan verify` check SP accuracy (actual vs estimate >2x variance → proposal)? | PM decision |
