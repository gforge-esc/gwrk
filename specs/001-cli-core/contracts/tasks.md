---
type: contract
feature: 001-cli-core
last_modified: "2026-02-27T00:04:35Z"
---

# Contract: Task Engine

**Feature**: 001-cli-core
**Scope**: Task state management, gate execution, history logging

---

## `loadTaskState(featureDir: string): TaskState`

**Source**: `src/utils/state.ts`
**Consumed by**: `src/commands/tasks.ts`

Reads and Zod-validates `specs/<feature>/.gwrk/tasks.json`. Returns parsed `TaskState`. Throws on invalid schema or missing file.

```typescript
function loadTaskState(featureDir: string): TaskState
```

| Parameter | Type | Description |
|---|---|---|
| `featureDir` | `string` | Absolute path to `specs/<feature>/` |

**Returns**: `TaskState` (Zod-validated)
**Throws**: If file missing or schema invalid → `process.exit(1)`

---

## `saveTaskState(featureDir: string, state: TaskState): void`

**Source**: `src/utils/state.ts`
**Consumed by**: `src/commands/tasks.ts`

Atomically writes `TaskState` to `.gwrk/tasks.json`. Validates with Zod before writing.

```typescript
function saveTaskState(featureDir: string, state: TaskState): void
```

---

## `markTaskComplete(state: TaskState, taskId: string): TaskState`

**Source**: `src/utils/state.ts`
**Consumed by**: `src/commands/tasks.ts`

Pure function. Returns new state with task status set to `completed` and `completedAt` set to current ISO 8601 timestamp. Throws if task not found or already completed.

```typescript
function markTaskComplete(state: TaskState, taskId: string): TaskState
```

**Returns**: New `TaskState` (immutable update)
**Throws**: `Task ${taskId} not found in tasks.json` or `Task ${taskId} already completed`

---

## `listTasks(state: TaskState): Task[]`

**Source**: `src/utils/state.ts`
**Consumed by**: `src/commands/tasks.ts`

Flattens all tasks from all phases into a single array.

---

## `nextTask(state: TaskState, phaseId: string): Task | null`

**Source**: `src/utils/state.ts`
**Consumed by**: `src/commands/tasks.ts`

Returns the first task with status `open` in the given phase. Returns `null` if all tasks in the phase are completed.

---

## `runGate(gateScript: string): { exitCode: number; stdout: string; stderr: string }`

**Source**: `src/utils/exec.ts`
**Consumed by**: `src/commands/tasks.ts`

Executes `gates/<taskId>-gate.sh` via `execFileSync`. Returns exit code, stdout, stderr. Does NOT throw on non-zero exit — caller decides what to do.

```typescript
function runGate(gateScript: string): { exitCode: number; stdout: string; stderr: string }
```

---

## `appendHistory(entry: HistoryEntry): void`

**Source**: `src/utils/history.ts`
**Consumed by**: `src/commands/tasks.ts`

Appends a single JSONL line to `.gwrk/history.jsonl`. Creates file if it doesn't exist.

```typescript
function appendHistory(entry: HistoryEntry): void
```

---

## `parsePlan(planPath: string): { phases: ParsedPhase[] }`

**Source**: `src/utils/parser.ts`
**Consumed by**: `src/commands/tasks.ts`

Parses a `plan.md` file and extracts phases + tasks from the markdown structure. Returns parsed phases with task titles and descriptions.

---

## `generateGates(featureDir: string, tasks: Task[]): void`

**Source**: `src/utils/gate-gen.ts`
**Consumed by**: `src/commands/tasks.ts`

For each task, generates a `gates/T0xx-gate.sh` script with executable permissions (`chmod +x`). Gate scripts contain shell assertions derived from Done When criteria.
