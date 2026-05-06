# R005 — Active Build Planning: The Graph Model

> **Status:** Draft — Awaiting Review
> **Initiative:** [R005 brief](file:///Users/gonzo/Code/gwrk/docs/research/R005-better-build-plan/brief.md)
> **Consumer:** F018 (Build Plan Orchestrator) spec, architecture.md §12, 000-build-plan.md v14

---

## Executive Summary

The build plan is not a document. It's a **directed acyclic graph (DAG) to solve.** Every question gwrk needs to answer — "what should I work on next?", "what's blocking?", "what's the fastest path to shareability?", "if this rework lands, what moves?" — is a graph query, not a document scan.

Today, `000-build-plan.md` is a 727-line markdown scratchpad. Its dependency graph (the mermaid diagram on line 25) is decorative — nobody queries it. Status markers drift because nothing writes them. Effort estimates go stale because nothing measures them. The PM re-reads the whole file and re-derives the critical path by hand every time priorities shift. Claude Opus 4.6 drowns in 42KB of context trying to do the same.

The fix: **store the build plan as a graph in SQLite, solve it with `graphology` + CPM, render it as markdown.** Three layers:

1. **Storage Layer:** SQLite adjacency list tables (`features`, `phases`, `edges`) — the graph persists, survives agent sessions, supports recursive CTE traversal.
2. **Solver Layer:** `graphology` + `graphology-dag` in-memory graph loaded from SQLite. Topological sort → ready queue → CPM → critical path. Answers "what next?" computationally, not narratively.
3. **Render Layer:** `gwrk plan render` regenerates the markdown from solved state. The markdown *becomes* an output, not an input.

---

## Q1: The Graph Data Model

### Node Types

The build plan graph has two node types at different granularities:

```
Feature Node (F014)
  ├── Phase Node (F014-P1)
  ├── Phase Node (F014-P2)
  ├── Phase Node (F014-P3)
  └── Phase Node (F014-P4)
```

Features are containers. Phases are the schedulable units — they're what `gwrk ship` executes.

### Edge Types

| Edge Type | Meaning | Example |
|-----------|---------|---------|
| `DEPENDS_ON` | Hard prerequisite — cannot start until predecessor is DONE | F005 → F014-R (can't do parallel dispatch without plugin system) |
| `CONTAINS` | Feature-phase containment | F014 → F014-P1 |
| `SEQUENCE` | Phase ordering within a feature | F014-P1 → F014-P2 → F014-P3 |
| `BLOCKS` | Inverse of DEPENDS_ON (computed, not stored) | F014-R blocks F005 |
| `INVALIDATES` | Rework edge — research finding invalidates completed work | R004 → F014-P6 (claimed done, actually drifted) |

### Node State

Each phase node carries:

```typescript
interface PhaseNode {
  id: string;              // "F014-P5"
  featureId: string;       // "F014"
  name: string;            // "CLI Rewiring"
  status: PhaseStatus;     // FSM state
  spEstimate: number;      // Story points planned
  spActual?: number;       // Story points measured (from ship runs)
  health: HealthFlag;      // CLEAN | DRIFTED | STALE | BLOCKED
  duration?: number;       // Actual execution time (from ship manifests)
  completedAt?: string;    // ISO timestamp
  evidence?: string;       // Link to execution manifest or PR
}

type PhaseStatus =
  | 'PLANNED'       // Exists in graph, no spec
  | 'SPECIFIED'     // spec.md exists
  | 'DEFINED'       // plan.md + tasks.json exist
  | 'IN_PROGRESS'   // gwrk ship started
  | 'SHIPPED'       // gwrk ship completed (all tasks done)
  | 'VERIFIED'      // Gates pass, code review GO
  | 'DONE'          // PM accepts (only PM can set)
  | 'REWORK';       // Re-opened after SHIPPED/VERIFIED

type HealthFlag = 'CLEAN' | 'DRIFTED' | 'STALE' | 'BLOCKED';
```

### SQLite Schema

```sql
-- Storage layer: adjacency list
CREATE TABLE plan_features (
  id          TEXT PRIMARY KEY,    -- "F014"
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PLANNED',
  sp_total    INTEGER DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_phases (
  id          TEXT PRIMARY KEY,    -- "F014-P5"
  feature_id  TEXT NOT NULL REFERENCES plan_features(id),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'PLANNED',
  health      TEXT NOT NULL DEFAULT 'CLEAN',
  sp_estimate INTEGER DEFAULT 0,
  sp_actual   INTEGER,
  duration_ms INTEGER,
  completed_at TEXT,
  evidence    TEXT,               -- path to execution manifest
  seq         INTEGER NOT NULL,   -- ordering within feature
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE plan_edges (
  from_id     TEXT NOT NULL,       -- source node (feature or phase ID)
  to_id       TEXT NOT NULL,       -- target node
  edge_type   TEXT NOT NULL,       -- DEPENDS_ON, CONTAINS, SEQUENCE, INVALIDATES
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id, edge_type)
);

CREATE INDEX idx_edges_from ON plan_edges(from_id);
CREATE INDEX idx_edges_to ON plan_edges(to_id);
CREATE INDEX idx_phases_feature ON plan_phases(feature_id);
CREATE INDEX idx_phases_status ON plan_phases(status);
```

### Graph Traversal via Recursive CTE

```sql
-- "What does F005 depend on, transitively?"
WITH RECURSIVE deps(id, depth) AS (
  SELECT to_id, 0 FROM plan_edges
    WHERE from_id = 'F005' AND edge_type = 'DEPENDS_ON'
  UNION
  SELECT e.to_id, d.depth + 1 FROM plan_edges e
    JOIN deps d ON e.from_id = d.id
    WHERE e.edge_type = 'DEPENDS_ON'
)
SELECT p.id, p.name, p.status, d.depth
FROM deps d JOIN plan_phases p ON d.id = p.id
ORDER BY d.depth DESC;
```

---

## Q2: The Solver — "What Should I Work On Next?"

This is the core innovation. Today, answering "what next?" requires reading a 727-line file, mentally computing dependencies, and cross-referencing code state. The graph model makes it a **function call**.

### Kahn's Algorithm: The Ready Queue

**Source:** Standard algorithm for topological sorting (Kahn 1962). Used by Nx, Turborepo, and Bazel.

```typescript
import { DirectedGraph } from 'graphology';
import { topologicalGenerations, hasCycle } from 'graphology-dag';

function computeReadyQueue(graph: DirectedGraph): string[] {
  // Precondition: graph is a DAG
  if (hasCycle(graph)) throw new Error('Dependency cycle detected');

  const ready: string[] = [];
  graph.forEachNode((node) => {
    // Node is ready if:
    // 1. All predecessors are DONE
    // 2. Node status is not already DONE or IN_PROGRESS
    const status = graph.getNodeAttribute(node, 'status');
    if (status === 'DONE' || status === 'IN_PROGRESS') return;

    const allPredsDone = graph.inboundNeighbors(node)
      .every(pred => graph.getNodeAttribute(pred, 'status') === 'DONE');

    if (allPredsDone) ready.push(node);
  });

  return ready;
}
```

This directly answers `gwrk plan next`:

```bash
$ gwrk plan next
Ready to work on (all dependencies satisfied):
  1. F014-R-P5  CLI Rewiring         (3-5 SP, critical path)
  2. F011-P1    Harvest Foundation    (3 SP, off critical path)
  3. F006-P1    Pulse Scanner         (5 SP, independent)
```

### Critical Path Method: What Matters Most

CPM forward/backward pass identifies which items have zero slack — delay them and the whole project slips.

```typescript
interface CPMResult {
  node: string;
  es: number;  // earliest start
  ef: number;  // earliest finish
  ls: number;  // latest start
  lf: number;  // latest finish
  slack: number;
  critical: boolean;  // slack === 0
}

function computeCPM(graph: DirectedGraph): CPMResult[] {
  const sorted = topologicalSort(graph);
  const results = new Map<string, CPMResult>();

  // Forward pass: compute ES/EF
  for (const node of sorted) {
    const duration = graph.getNodeAttribute(node, 'sp_estimate') || 0;
    const predEFs = graph.inboundNeighbors(node)
      .map(p => results.get(p)!.ef);
    const es = predEFs.length > 0 ? Math.max(...predEFs) : 0;
    results.set(node, { node, es, ef: es + duration, ls: 0, lf: 0, slack: 0, critical: false });
  }

  const projectEnd = Math.max(...Array.from(results.values()).map(r => r.ef));

  // Backward pass: compute LS/LF
  for (const node of sorted.reverse()) {
    const r = results.get(node)!;
    const succLSs = graph.outboundNeighbors(node)
      .map(s => results.get(s)!.ls);
    r.lf = succLSs.length > 0 ? Math.min(...succLSs) : projectEnd;
    r.ls = r.lf - (graph.getNodeAttribute(node, 'sp_estimate') || 0);
    r.slack = r.ls - r.es;
    r.critical = r.slack === 0;
  }

  return Array.from(results.values());
}
```

This answers:

```bash
$ gwrk plan critical
Critical path (0 slack, delays project if slipped):
  F014-R-P5 → F004-R → F005-P1 → F005-P2
  Total: 16-21 SP

Float items (can be deferred without impact):
  F006 (5 SP, 8 SP slack)
  F007 (8 SP, 8 SP slack)
  F012 (13 SP, 13 SP slack)
```

### Topological Generations: Waves Computed, Not Guessed

The current build plan has hand-curated "Wave Strategy" (line 646). The graph computes this:

```typescript
const waves = topologicalGenerations(graph);
// waves[0] = ["F000", "F001"]           // no dependencies
// waves[1] = ["F013", "F014-P1-P4"]     // depend on F001
// waves[2] = ["F004", "TDD"]            // depend on F013
// waves[3] = ["F014-R-P5", "F011"]      // depend on F004/F014
// waves[4] = ["F005", "F004-R"]         // depend on F014-R
```

These are the waves. They're **mathematically correct**, not hand-curated. When dependencies change (research discovers new rework), the waves recompute automatically.

### Priority Heuristics for the Ready Queue

When multiple items are ready, RCPSP heuristics determine priority:

| Heuristic | Logic | When to Use |
|-----------|-------|-------------|
| **Critical Path First** | Ready items with `slack === 0` go first | Default — keeps the project on track |
| **Most Successors First** | Ready items with the most downstream dependents go first | When unlocking others matters most |
| **Shortest Job First** | Ready items with lowest SP go first | When you want quick wins / throughput signal |
| **PM Override** | PM sets explicit priority on a node | Always — PM authority supersedes algorithms |

---

## Q3: Dynamic Replanning — When the Graph Changes

The hardest problem. Research discovers rework. Features get rescoped. Phases get split. The graph must **absorb changes without losing completed work.**

### Event Types That Mutate the Graph

| Event | Source | Graph Mutation |
|-------|--------|---------------|
| **ship:complete** | ShipOrchestrator exit | Node status → SHIPPED, record sp_actual and duration |
| **define:complete** | `gwrk define tasks` | Node status → DEFINED, update sp_estimate |
| **verify:drift** | `gwrk plan verify` | Node health → DRIFTED (claimed done but code doesn't match) |
| **research:cascade** | R-initiative approval | Add INVALIDATES edges, mark nodes as REWORK |
| **pm:reorder** | Manual PM edit | Add/remove DEPENDS_ON edges, re-solve |
| **rework:discovered** | Ship failure (code review NO-GO) | Increment rework counter, adjust sp_estimate |

### Invalidation Propagation

When an R-initiative invalidates a completed node:

```
R004 discovers: F014-P6 (init overhaul) claimed DONE but init.ts still has .agents/ refs

Graph mutation:
1. Add edge: R004 --INVALIDATES--> F014-P6
2. F014-P6 status: DONE → REWORK
3. Any node depending on F014-P6: health → BLOCKED
4. Re-solve: recompute ready queue, CPM, generations
```

This is the "cascade" the user described — it happens computationally, not as a manual propagation exercise.

### JIT Replanning vs. Full Replan

| Approach | When | Cost |
|----------|------|------|
| **Incremental** | Single node status change (ship complete, define done) | O(affected subgraph) |
| **Full replan** | Structural change (new dependency, node added/removed) | O(graph) — but graph is tiny (~50 nodes) |

For gwrk's scale (~17 features, ~50 phases, ~80 edges), full replan runs in <1ms. Incremental optimization is premature.

---

## Q4: Architecture — Three Layers

```
┌──────────────────────────────────────────────────────────┐
│                     CLI Commands                          │
│  gwrk plan next | status | critical | verify | render    │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│                  Solver Layer                             │
│  graphology DirectedGraph (in-memory)                    │
│  ├── topologicalGenerations() → waves                    │
│  ├── computeReadyQueue() → "what next?"                  │
│  ├── computeCPM() → critical path + slack                │
│  └── hasCycle() → dependency validation                  │
│                                                          │
│  Loaded from SQLite on demand. Cached per session.       │
│  ~50 nodes, <1ms to solve.                               │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│                  Storage Layer                            │
│  SQLite (gwrk.db) — ADR-002 extension                    │
│  ├── plan_features (17 rows)                             │
│  ├── plan_phases (~50 rows)                              │
│  └── plan_edges (~80 rows)                               │
│                                                          │
│  Event hooks write here:                                 │
│  ship:complete, define:complete, verify:drift             │
└────────────────────┬─────────────────────────────────────┘
                     │
┌────────────────────▼─────────────────────────────────────┐
│                  Render Layer                             │
│  gwrk plan render → specs/000-build-plan.md              │
│  ├── Mermaid dependency graph (from edges)                │
│  ├── Gantt chart (from CPM results)                      │
│  ├── Feature sections (from solved state)                │
│  └── Wave strategy (from topologicalGenerations)         │
│                                                          │
│  Output only. PM can still hand-edit + gwrk plan sync.   │
└──────────────────────────────────────────────────────────┘
```

### Library Stack

| Library | Purpose | Size |
|---------|---------|------|
| `graphology` | Graph data structure (DirectedGraph) | 43KB minified |
| `graphology-dag` | topologicalSort, topologicalGenerations, hasCycle, willCreateCycle | ~5KB |
| `better-sqlite3` | Already in stack (ADR-002) | — |

No new heavy dependencies. `graphology` is pure JS, zero native deps, used by sigma.js for graph visualization.

---

## Q5: Agent Governance — Observe/Propose/Decide

### Three-Tier Model

```
Tier 1: OBSERVE (automated, no approval)
  ├── ship:complete → phase status = SHIPPED
  ├── define:complete → phase status = DEFINED
  ├── gate:pass → record evidence
  └── No structural changes. Facts only.

Tier 2: PROPOSE (agent suggests, PM approves)
  ├── verify:drift → "F014-P6 claimed DONE but init.ts has .agents/ refs"
  ├── rework:discovered → "P4 took 4 iterations, SP estimate should be 8 not 3"
  └── Stored as pending_proposals table. PM reviews via `gwrk plan review`.

Tier 3: DECIDE (PM only)
  ├── Add/remove dependencies
  ├── Reorder priorities
  ├── Set SP estimates
  ├── Accept DONE status (only PM can say "Done, Done!")
  └── Approve/reject proposals from Tier 2
```

---

## Q6: Integration Hooks

| Hook | Trigger | Action | Tier |
|------|---------|--------|------|
| `ship:complete` | `ShipOrchestrator.run()` returns 0 | Update phase status, record sp_actual | OBSERVE |
| `define:complete` | `gwrk define tasks` exit | Update phase status to DEFINED | OBSERVE |
| `harvest:done` | PR merge webhook | Run `gwrk plan verify` on phase | OBSERVE |
| `ship:fail` | `ShipOrchestrator.run()` returns non-0 | Increment rework counter, propose SP adjustment | PROPOSE |
| `research:cascade` | R-initiative PM approval | Add INVALIDATES edges, re-solve | DECIDE |
| `plan:heartbeat` | Build server cron (every 4h or configurable) | Detect stale nodes, report to Slack | OBSERVE |

---

## Q7: Foxtrot Charlie Alignment

The graph model *is* FC's commitment spine made computable:

| FC Invariant | Graph Implementation |
|---|---|
| "Every initiative has a single accountable owner" | Each node has an `owner` attribute. PM is the graph owner. |
| "Reality is expressed as state, not narrative" | Node status FSM replaces markdown ✅/⚠️/🔴 |
| "All commitments exist as written artifacts" | SQLite tables are the artifact. Markdown is the rendering. |
| "Shipping happens frequently enough to surface truth" | `ship:complete` hook writes truth directly into the graph |
| "Value is measured in adoption or outcome, not effort" | sp_actual vs sp_estimate tracked per node |

FC Failure Mode Diagnostics, now computable:

| Diagnostic | Graph Query |
|---|---|
| "Truth is missing" | Nodes with health = DRIFTED or STALE |
| "Clarity is broken" | Nodes in PLANNED status with downstream DEPENDS_ON edges |
| "Throughput is stalled" | No status transitions in N days across all IN_PROGRESS nodes |

---

## Feature Scope Recommendation

### F018: Build Plan Orchestrator (25 SP)

| Phase | Content | SP | Dependencies |
|-------|---------|-----|---|
| **P1: Data Model + Seed** | SQLite schema, migration, seed from current 000-build-plan.md, `gwrk plan status` | 5 | None |
| **P2: Solver** | graphology integration, ready queue, CPM, `gwrk plan next`, `gwrk plan critical` | 5 | P1 |
| **P3: Event Hooks** | ship:complete, define:complete hooks into ShipOrchestrator and define commands | 5 | P1, F004 |
| **P4: Verify + Render** | `gwrk plan verify` drift detection, `gwrk plan render` markdown generation | 5 | P2 |
| **P5: Heartbeat + Governance** | Proposal flow, `gwrk plan review`, build server cron, Slack reporting | 5 | P3, P4 |

### Dependencies

```
F018-P1 → F018-P2 → F018-P4
F018-P1 → F018-P3
F018-P3 + F018-P4 → F018-P5
```

### What Ships First (Incremental Value)

**P1 alone is valuable.** Just having `gwrk plan status` that reads from structured data and shows per-phase status eliminates the "re-read 727 lines" problem. P2 adds "what next?" — the killer query. P3 adds automation. P4 adds verification. P5 adds proactive monitoring.

---

## Spec Alignment Notes

### Architecture.md Amendments
- Add §12: Build Plan Graph (data model, solver layer, render layer)
- Amend §6.1: Ship Loop post-completion event hook
- Amend §11: Add `plan_features`, `plan_phases`, `plan_edges` to SQLite schema

### Dependencies
- **F018-P3 depends on F004:** Needs `ShipOrchestrator` event emission
- **F018-P5 depends on F002:** Needs build server cron infrastructure
- **F018 does NOT depend on F014-R:** Can ship independently. In fact, F018-P1 + P2 should ship *before* F014-R to enable graph-guided prioritization of the remaining F014-R work.

### 000-build-plan.md
- v14: Becomes a rendered output of `gwrk plan render`, not hand-maintained
- Transition: Seed SQLite from current markdown, then markdown becomes read-only output

---

## Open Items

| # | Item | Requires |
|---|------|----------|
| 1 | Feature number: F018 or other? | PM decision |
| 2 | `gwrk plan` as new CLI pillar or subcommand? FC has 4 pillars; this spans all of them. | PM decision |
| 3 | Drift detection: warn (`gwrk plan verify` prints warnings) or block (`gwrk ship` refuses if drift detected)? | PM decision |
| 4 | Priority: Should F018-P1+P2 ship before F014-R-P5 to guide that work? | PM decision — recommended yes |
| 5 | Graph visualization: mermaid rendering sufficient or add sigma.js web dashboard later? | PM decision (mermaid first) |
| 6 | `gwrk plan sync`: Should PM hand-edits to markdown propagate back to SQLite, or is SQLite authoritative with `gwrk plan edit` commands? | PM decision |
