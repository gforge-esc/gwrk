# Contract: WUD State Machine

**Feature**: 004-wud-loop
**Scope**: Autonomous lifecycle orchestrator — implement → review → PR → CI → done

---

## `runWudLoop(opts: WudOptions): Promise<WudResult>`

**Source**: `src/commands/wud.ts`
**Consumed by**: CLI

Orchestrates the full WUD state machine. Persists state after every stage transition for crash recovery.

```typescript
interface WudOptions {
  featureDir: string;        // e.g. "specs/004-wud-loop"
  phaseNumber: number;       // e.g. 1
  config: GwrkConfig;        // From loadConfig()
  maxIterations?: number;    // Default from config or 3
  ciTimeout?: number;        // Minutes, default 30
  dryRun?: boolean;          // Print state machine plan without executing
  trackingIssue?: string;    // Optional GitHub issue number for PR body
}

interface WudResult {
  stage: WudStage;
  iteration: number;
  prNumber?: number;
  durationMs: number;
}

type WudStage =
  | "BRANCH_SETUP"
  | "IMPLEMENTING"
  | "CODE_REVIEW"
  | "UAT_REVIEW"
  | "PR_CI"
  | "CI_WAIT"
  | "DONE"
  | "FAILED"
  | "CIRCUIT_BREAK";

function runWudLoop(opts: WudOptions): Promise<WudResult>
```

**Returns**: Final state with stage, iteration count, PR number, and duration.
**Exit code**: 0 on DONE, 1 on FAILED or CIRCUIT_BREAK.

---

## `saveWudState(stateFile: string, state: WudState): void`

**Source**: `src/utils/wud-state.ts`
**Consumed by**: `src/commands/wud.ts`

Atomically writes state JSON to `.runs/<feature>_p<phase>.state`.

```typescript
interface WudState {
  stage: WudStage;
  iteration: number;
  feature: string;
  phase: string;
  trackingIssue?: string;
  prNumber?: number;
  updatedAt: string;         // ISO 8601
}

function saveWudState(stateFile: string, state: WudState): void
```

---

## `loadWudState(stateFile: string): WudState | null`

**Source**: `src/utils/wud-state.ts`
**Consumed by**: `src/commands/wud.ts`

Reads saved state. Returns null if file doesn't exist. Resets terminal states (DONE, FAILED, CIRCUIT_BREAK) to BRANCH_SETUP.

```typescript
function loadWudState(stateFile: string): WudState | null
```

---

## State Machine Transitions

```
BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE
                    ↑               |              |          |
                    └───────────────┘──────────────┘──────────┘
                         (on NO-GO: loop back, increment iteration)
                         (on CIRCUIT_BREAK: exit with code 1)
```
