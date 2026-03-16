# Contract: wud-verdict.sh — Tasks.json Verdict Checker

**Source**: `scripts/dev/wud-verdict.sh`
**FRs**: FR-005

## Interface

```
./scripts/dev/wud-verdict.sh <spec_dir> <phase>
```

**Exit codes**:
| Code | Meaning |
|---|---|
| 0 | GO — all tasks in the phase have `status: "completed"` |
| 1 | NO-GO — at least one task is not `completed` |

## Behavior

Reads `<spec_dir>/.gwrk/tasks.json`, finds the phase matching `phase-<NN>`, and checks each task's status. If all tasks are `completed` → GO (exit 0). Otherwise → NO-GO (exit 1).

## Relationship to FR-014 (Phase Skip)

`wud-verdict.sh` checks verdict DURING execution (after review). `isPhaseComplete()` in `ship.ts` checks BEFORE execution (to skip already-done phases). These are two different concerns:
- **Verdict** (FR-005): "Did the reviews pass?" → used by WUD state machine
- **Phase skip** (FR-014): "Are all tasks already done?" → used by `ship.ts` before dispatching WUD
