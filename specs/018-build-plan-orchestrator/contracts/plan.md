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
- `getCriticalPath(): { path: PlanPhase[], warnings: string[] }`
  - FR-004: CPM forward/backward pass. Warnings include SP-missing nodes (FR-018).
- `getTopologicalWaves(): PlanPhase[][]`
  - FR-002: `graphology-dag` topologicalGenerations
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
