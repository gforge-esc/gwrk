# Data Model: 005 Parallel Dispatch

## Domain Entities

### DispatchRecord (Updated)
The `DispatchRecord` is extended to include an array of `TaskRecord` items for task-level parallelization.

```typescript
export interface DispatchRecord {
  id: string;                // UUID
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
  status: DispatchStatus;
  branchName: string;
  attempts: DispatchAttempt[];
  tasks: TaskRecord[];       // NEW: Parallel tasks within this phase
  createdAt: string;
  completedAt?: string;
  prUrl?: string;
  prNumber?: number;
}
```

### TaskRecord (New)
Represents a single task being executed within a phase sandbox.

```typescript
export interface TaskRecord {
  id: string;                // e.g., "T001"
  status: "pending" | "running" | "completed" | "failed";
  sandboxDir: string;        // Path to git worktree: .runs/sandboxes/<feature>-<task>-<uuid>
  backend: AgentBackend;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string;            // Capture stderr or error messages
}
```

## Persistence Strategy

### Tier 0: Run State Homing (Git)
Ship lifecycle artifacts (`specs/<feature>/.gwrk/runs/*.json`) are created by `gwrk ship` for each dispatch. These files are **auto-committed** by `wud-branch.sh` between phases to prevent dirty-tree guards from blocking multi-phase shipping. They travel with the feature branch as part of the execution record.

### Tier 1: Task State (JSON)
Task state is persisted in the feature's `tasks.json` (managed by `gwrk tasks done`). The `DispatchRecord` and its `TaskRecord` items are persisted machine-locally in `.gwrk/dispatches.jsonl` (handled by `persistDispatch`).

### Tier 2: Analytical (SQLite)
Each task execution is recorded as a separate entry in the `runs` table in `~/.gwrk/gwrk.db`.

| Field | Value |
|---|---|
| `feature_id` | `005-parallel-dispatch` |
| `phase_id` | `phase-01` |
| `command` | `gwrk ship task T001` |
| `agent_backend` | `gemini` |
| `exit_code` | `0` |
| `duration_s` | `45` |
