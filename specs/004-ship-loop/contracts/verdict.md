---
type: contract
feature: 004-ship-loop
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: Verdict Checker

**Feature**: 004-ship-loop
**Scope**: Phase completion verdict via tasks.json

---

## `checkPhaseVerdict(featureDir: string, phaseNumber: number): VerdictResult`

**Source**: `src/utils/verdict.ts`
**Consumed by**: `src/commands/wud.ts`

Queries tasks.json for the given phase and returns GO/NO-GO based on task completion status.

```typescript
interface VerdictResult {
  verdict: "GO" | "NO-GO";
  totalTasks: number;
  completedTasks: number;
  openTasks: OpenTask[];
}

interface OpenTask {
  id: string;
  title: string;
  status: "open" | "in_progress";
}

function checkPhaseVerdict(featureDir: string, phaseNumber: number): VerdictResult
```

**Returns**: `GO` if all tasks in the phase are `completed`, `NO-GO` otherwise.

**Behavior**:
- Loads tasks.json via `loadTaskState()` from 001-cli-core.
- Filters to the specified phase (`phase-NN`).
- If all tasks have status `completed` → `GO`.
- If any task has status `open` or `in_progress` → `NO-GO` with the list of remaining tasks.

**Throws**: If phase not found in tasks.json → error with message.
