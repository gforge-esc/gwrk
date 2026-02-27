# Contract: Implement Command

**Feature**: 004-wud-loop
**Scope**: Single-phase task execution with gate enforcement

---

## `executePhase(opts: ExecutePhaseOptions): Promise<ExecutePhaseResult>`

**Source**: `src/commands/implement.ts`
**Consumed by**: `src/commands/wud.ts`, CLI

Executes all tasks in a single phase sequentially: pre-flight gate → agent dispatch → post-flight gate → commit.

```typescript
interface ExecutePhaseOptions {
  featureDir: string;       // e.g. "specs/004-wud-loop"
  phaseNumber: number;      // e.g. 1
  config: GwrkConfig;       // From loadConfig()
  dryRun?: boolean;         // Print plan without executing
}

interface ExecutePhaseResult {
  tasksCompleted: number;
  tasksSkipped: number;     // Pre-flight already passing
  totalTasks: number;
  branch: string;           // e.g. "feat/004-wud-loop"
}

function executePhase(opts: ExecutePhaseOptions): Promise<ExecutePhaseResult>
```

**Returns**: Summary of phase execution
**Throws**: On missing tasks.json, missing phase, missing gate script → `process.exit(1)`

---

## `runPreFlight(gateScript: string): PreFlightResult`

**Source**: `src/commands/implement.ts`
**Consumed by**: Internal to executePhase

Runs the gate script expecting it to FAIL (exit != 0). If it PASSES (exit 0), the task is skipped.

```typescript
interface PreFlightResult {
  shouldImplement: boolean;  // true if gate FAILS (expected)
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runPreFlight(gateScript: string): PreFlightResult
```

---

## Error States

| Condition | stderr contains | Exit code |
|---|---|---|
| tasks.json not found | `tasks.json not found for feature` | 1 |
| Phase not found | `Phase phase-NN not found in tasks.json` | 1 |
| Gate script missing | `Gate script gates/T0xx-gate.sh not found` | 1 |
| Agent dispatch fails | `Agent failed with exit code N` | 1 |
| Post-flight gate fails | `Post-flight gate failed for T0xx` | 1 |
