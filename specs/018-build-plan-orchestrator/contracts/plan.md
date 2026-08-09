# Contract: Build Plan Orchestrator

## Interface: `PlanStore`

Methods for interacting with the SQLite build plan graph.

### Bootstrap

- `seedPlan(features: PlanFeature[], phases: PlanPhase[], edges: PlanEdge[]): void`
  - FR-013: Parse 000-build-plan.md → populate SQLite
- `initFromSpecs(specsDir: string): { added: string[], skipped: string[], readiness: Record<string, ReadinessLevel> }`
  - FR-017: Scan `specs/*/` directories, create nodes at correct readiness level. MUST NOT clobber existing nodes.

### Query

- `getPlanStatus(): { features: PlanFeature[], phases: PlanPhase[] }`
  - FR-005: Per-feature, per-phase status report
- `getReadyQueue(): PlanPhase[]`
  - FR-003: Kahn's algorithm — phases with all deps DONE, sorted by critical path priority
  - Dependency-ready is NOT parallel-safe. It models declared edges only, never
    shared migrations, overlapping deliverables, or single-instance test
    resources. Callers presenting it as a concurrent work set must say so.
- `getCriticalPath(): { path: PlanPhase[], warnings: string[] }`
  - FR-004: CPM forward/backward pass. Warnings include SP-missing nodes (FR-018).
- `getRemainingWaves(): PlanPhase[][]`
  - Topological waves over phases that are NOT terminal — the operational view
    behind `gwrk plan waves`. A terminal predecessor is satisfied, so it leaves
    the subgraph rather than counting as a blocker; wave 1 therefore matches
    `getReadyQueue()` membership.
  - Throws on a dependency cycle among pending phases. Kahn's algorithm emits
    nothing for a cycle, and returning the partial set would silently drop work.
- `getTopologicalWaves(): PlanPhase[][]`
  - FR-002: `graphology-dag` topologicalGenerations, over the ENTIRE plan
    including shipped phases — the plan of record, used by the build-plan
    renderer's Wave Strategy table. Use `getRemainingWaves()` for current work.

### Status Consistency

The three readers above MUST agree on which statuses satisfy a dependency:
`DONE`, `SHIPPED`, `VERIFIED`, `CLOSED` (one `TERMINAL_STATUSES` set). They
previously disagreed — the ready queue filtered them, wave computation did not,
so `plan waves` opened on work shipped months earlier.

A feature-level edge binds the prerequisite feature's LAST phase to EVERY phase
of the dependent feature, not only its first. Binding only the first left phases
2..N with no cross-feature constraint as soon as phase 1 read `SHIPPED`. The
intra-feature `SEQUENCE` chain implies the constraint transitively for an honest
graph, but `plan init` promotes `PLANNED → SHIPPED` from ship-run existence
rather than from a passing gate, so the chain is precisely what cannot be
trusted. The added edges are transitively redundant: wave indices and the
critical path are unchanged, and only readiness tightens.
- `isEmpty(): boolean`
  - FR-019: Guard check for empty graph — all subcommands call this first

### Mutation

- `addFeature(feature: PlanFeature): void`
- `removeFeature(featureId: string): void`
  - Cascade: removes all phases and edges referencing this feature
- `addPhase(phase: PlanPhase): void`
- `removePhase(phaseId: string): void`
  - Cascade: removes edges referencing this phase
- `addEdge(edge: PlanEdge): void`
  - MUST call `hasCycle()` before inserting — reject with error if cycle detected (FR-011)
- `removeEdge(fromId: string, toId: string, edgeType: string): void`
- `updatePhaseStatus(phaseId: string, status: PlanPhaseStatus, metadata?: Partial<PlanPhase>): void`
  - FR-012: Manual PM override. Only PM can set DONE.

### Verification

- `verifyPlan(): PlanVerifyResult[]`
  - FR-006: Drift detection against code state and gate results
  - MUST report features in `specs/` missing from graph and vice versa

## Interface: `ReadinessScanner`

- `scanReadiness(specsDir: string): ReadinessResult[]`
  - FR-018: Scan each `specs/*/` directory and assign L0–L3:
    - L0: directory only → PLANNED
    - L1: has spec.md → SPECIFIED
    - L2: has spec.md + plan.md → DEFINED (partial)
    - L3: has spec.md + plan.md + .gwrk/tasks.json → DEFINED

```typescript
interface ReadinessResult {
  featureId: string;
  level: 0 | 1 | 2 | 3;
  status: PlanPhaseStatus;
  hasSpec: boolean;
  hasPlan: boolean;
  hasTasks: boolean;
  spTotal: number | null;  // extracted from tasks.json if L3
}
```

## Event Hooks

The following events MUST be emitted by orchestrators to update the build plan.

### `plan:ship:complete`
- **Source**: `ShipOrchestrator.run()` on success (exit 0)
- **Payload**: `{ phaseId: string, sp_actual: number, duration_ms: number, evidence: string }`
- **Action**: Update phase status to `SHIPPED`, record actuals and evidence.

### `plan:define:complete`
- **Source**: `DefineOrchestrator.run()` or `gwrk define` commands
- **Payload**: `{ featureId: string, phaseId?: string, status: PlanPhaseStatus }`
- **Action**: Update feature or phase status to `SPECIFIED` or `DEFINED`.

## Error Contract

All `gwrk plan` subcommands MUST call `isEmpty()` first. If true:
- stderr: `No build plan data. Run 'gwrk plan seed' or 'gwrk plan init'.`
- exit code: 1

See spec.md §11 Error Catalogue for full error/warning matrix.
