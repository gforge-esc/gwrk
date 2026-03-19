# Contract: DispatchOrchestrator

## Purpose

The `DispatchOrchestrator` manages the parallel execution of tasks within a phase. It determines which tasks are independent, creates sandboxes for them, and executes the ship loop concurrently up to the defined concurrency limit.

## Class Definition

### `DispatchOrchestrator`

#### `executePhase(record: DispatchRecord): Promise<void>`
Executes all tasks in a phase in parallel where possible.

- **Parameters:** `record: DispatchRecord`
- **Side Effects:**
  - Creates git worktree sandboxes.
  - Dispatches tasks to agents.
  - Updates `TaskRecord` statuses.
  - Merges completed tasks back via PRs (managed by F004 Ship Loop per-task).

#### `calculateConcurrencyLimit(backend: AgentBackend): number`
Determines the current allowed concurrency for the specified backend.

- **Returns:** `number` (e.g., `local.maxClones` or `cloud.maxConcurrent`)

#### `throttle(backend: AgentBackend): Promise<void>`
Applies exponential backoff with jitter on 429 errors.

- **Parameters:** `backend: AgentBackend`

## Invariants

1. **Independent Tasks**: Only tasks with no open dependencies can run in parallel.
2. **Resource Gating**: Total active sandboxes across all phases MUST NOT exceed `maxClones` (local) or `maxConcurrent` (cloud).
3. **No Working Tree Mutation**: All agent modifications MUST happen within the sandbox `workDir`, never in the host repository's working tree.
4. **Worktree Lifecycle**: Every task-level worktree MUST be pruned after PR creation or on failure, except when debugging overrides are active.
