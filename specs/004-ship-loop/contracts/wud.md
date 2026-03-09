---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: WUD State Machine

**Feature**: 004-ship-loop
**Scope**: Autonomous lifecycle orchestrator — implement → review → PR → CI → done

---

## `ship done <feature> <phase>`

**Source**: `src/commands/ship.ts` (wrapper for `scripts/dev/work-until-done.sh`)
**Consumed by**: CLI

Orchestrates the full WUD state machine. Persists state after every stage transition for crash recovery.

### Options
| Option | Type | Description |
|---|---|---|
| `feature` | `string` | e.g. "004-ship-loop" |
| `phase` | `string` | e.g. "1" |
| `--max-iterations` | `number` | Max implement→review cycles (default: 3) |
| `--ci-timeout` | `number` | Minutes, default 30 |
| `--dry-run` | `boolean` | Print state machine plan without executing |

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
