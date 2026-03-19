# Feature Specification: 005 Parallel Dispatch

**Feature Branch**: `005-parallel-dispatch`
**Created**: 2026-03-10
**Updated**: 2026-03-19 (R001 integration)
**Status**: Settled
**Input**: Parallel dispatch, concurrent worktree sandboxes, merge via PR, per-backend capacity gate. See [parallel-dispatch-architecture.md](file:///Users/gonzo/Code/gwrk/docs/reference/parallel-dispatch-architecture.md).

---

## 2. User Scenarios & Testing

### US-001 - Dispatch Independent Tasks Concurrently (Priority: P0)
As a Principal Engineer, I want the system to dispatch multiple independent tasks within a phase to separate agent sandboxes concurrently, so that shipping throughput is maximized.

**Implements**: FR-001, FR-002, FR-003

**Independent Test**: Mock `tasks.json` with 3 open tasks. Run dispatch with concurrency 3. Verify 3 sandboxes are created and tasks are executed simultaneously.

**Acceptance Scenarios**:
1. **Given** a phase with 3 open tasks and `--concurrency 3`, **When** dispatch runs, **Then**:
   - `ls .runs/sandboxes/ | wc -l` outputs `3` (or greater if counting historically, assert on active sandboxes)

### US-002 - Isolated Sandboxes (Priority: P0)
As the orchestration engine, I want each dispatched agent to operate its own ephemeral clone of the repository (a "sandbox") so that concurrent file modifications do not collide in the working tree.

**Implements**: FR-002

**Independent Test**: Mock 2 tasks modifying the same module safely. Verify each executes in a different `workDir`.

**Acceptance Scenarios**:
1. **Given** concurrent agent execution, **When** examining the agent's working directory, **Then**:
   - `grep -q "workDir.*sandboxes" .runs/*_dispatch.log` exits 0

### US-004 - Capacity Gating and Rate Limiting (Priority: P1)
As a considerate API citizen, I want the dispatcher to respect a per-backend rate limit (e.g., max 2 concurrent local clones) and handle resource exhaustion gracefully.

**Implements**: FR-005, FR-006

**Independent Test**: Configure a backend with max concurrency 1. Submit 3 tasks. Verify 1 runs while 2 wait in queue.

**Acceptance Scenarios**:
1. **Given** `maxClones: 1` and 3 pending tasks, **When** dispatching, **Then**:
   - `grep -c "Queued task.*capacity full" .runs/*_dispatch.log` outputs `>= 2`

### US-005 - Cross-Backend Dispatch Compatibility (Priority: P1)
As the orchestrator, I want to dispatch tasks to any registered `local-cli` AgentBackend adapter without changing the core dispatch loop, proving the system is backend-agnostic. Cloud agents (`github-integration`) are deferred to Tier 3 (separate feature, F014 Phase 3+).

**Implements**: FR-007

**Independent Test**: Mock two local CLI backends (gemini, claude). Verify the orchestrator invokes the correct shell command for each while respecting concurrency gates.

**Acceptance Scenarios**:
1. **Given** a phase with tasks routed to local `gemini` and local `claude`, **When** dispatch runs, **Then**:
   - `grep -q "Executing local CLI.*gemini" .runs/*_dispatch.log` exits 0
   - `grep -q "Executing local CLI.*claude" .runs/*_dispatch.log` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `DispatchOrchestrator` that orchestrates multiple tasks within a phase concurrently. It MUST calculate independent tasks based on explicit task dependencies, or default to all tasks in a phase if no dependencies exist. (Implements: US-001)
- **FR-002**: System MUST create an ephemeral git worktree for each dispatched task (a sandbox). Worktrees are created in `.runs/sandboxes/<feature>-<task>-<uuid>/`. Worktrees are auto-cleaned on `gwrk server start` via `git worktree prune`. Each sandbox pushes a branch and creates a PR against the feature branch via `gh pr create`. F005's lifecycle **ends** when the PR is created and the worktree is cleaned up. (Implements: US-001, US-002)
- **FR-003**: System MUST invoke the native `DispatchOrchestrator` task-level inner loop (from F004) for each sandbox. The orchestrator MUST catch and execute JSON Intents emitted by the `WorkflowRuntime` strictly within the explicitly provided `workDir`, ensuring parallel modifications do not collide. (Implements: US-001)
- **FR-004**: System MUST enforce a per-backend `maxConcurrent` capacity gate. Tasks exceeding the gate MUST wait in a queue. Default: `local.maxClones: 2`, `cloud.maxConcurrent: 3`. (Implements: US-004)
- **FR-005**: System MUST catch HTTP 429 logic globally or instruct the single-task loop to apply exponential backoff + jitter, returning the sandbox to a suspended state if needed. (Implements: US-004)
- **FR-006**: System MUST support dispatch to any registered `AgentBackend` adapter with `dispatchMode: local-cli`. Local CLI agents execute via sub-processes in worktree sandboxes. Cloud agents (`github-integration`) are deferred to Tier 3 and MUST NOT be implemented in F005 Phase 1 (see F014 FR-L1-007). (Implements: US-005)

#### FR-004 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Queue timeout (e.g., > 1 hour) | `Agent capacity queue timeout` | 1 |

---

## 5. Data Model Requirements

### DM-001: Dispatch State
The orchestrator MUST maintain an in-memory/disk-persisted state of the queue.

```json
{
  "activeSandboxes": [
    { "taskId": "T001", "pid": 4531, "backend": "gpt-5.3-codex", "status": "running" }
  ],
  "queued": ["T002", "T003"],
  "completed": []
}
```

### DM-002: TaskDispatch / TaskResult (ADR-006)

```typescript
// Input to AgentBackend.dispatch()
interface TaskDispatch {
  prompt: string;
  agent: string;              // AgentBackend name
  workDir: string;            // Worktree sandbox path
  stdin: string;              // Context delivery (required)
  env?: Record<string, string>;
}

// Output from AgentBackend.parseResult()
interface TaskResult {
  exitCode: 0 | 1 | 2 | 127;
  errorType?: string;         // e.g., 'turn_limit', 'usage_error'
  stdout: string;
  stderr: string;
  durationS: number;
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — SHA256 input/output stability for all engine functions.
- **TC-002**: Air-Gapped — No external network calls at runtime. All assets vendored/bundled.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-004**: No Host Mutation — Tasks MUST NOT modify the host repository's working tree. All execution happens in the worktree sandbox `workDir`.
- **TC-005**: Worktree Lifecycle — Worktrees are ephemeral. Created per-task, removed after PR creation or on server restart (`git worktree prune`). Docker is deferred to backlog (R001 decision).
- **TC-006**: Scope Boundary — F005 owns dispatch + PR creation only. Merge, conflict resolution, and code review are owned by F004 (Ship Loop). Harvest (F011) is triggered post-merge, not by F005.

---

## 7. Testing Requirements

- **TR-001**: `src/server/dispatch-orchestrator.test.ts` — Verify concurrency limit is respected. Mock `shipPhase()`, dispatch 5 tasks with concurrency 2, assert at most 2 are "running" simultaneously. Vitest. (FR-001, FR-004)
- **TR-002**: `src/server/sandbox-manager.test.ts` — Verify git worktree creation creates an isolated directory that does not leak state to host. Verify PR creation via `gh pr create`. Verify worktree cleanup post-PR. Vitest+Shell. (FR-002)
- **TR-003**: `src/server/backends/invocation-strategy.test.ts` — Verify local CLI dispatch. Mock two `local-cli` backends. Assert `invoke()` executes correct shell commands for each. Vitest. (FR-006)

---

## 8. Success Criteria

- **SC-001**: Feature shipping duration decreases roughly linearly with available concurrency (discounting merge overhead).
- **SC-002**: The host repository working tree is never corrupted or left in a conflicted state by parallel agents.
- **SC-003**: Backend rate limits are strictly honored; no 429 errors bubble up to crash the run.

---

## 9. Verification Requirements

- **VR-001**: Execute `gwrk ship 005-parallel-dispatch` against a dummy feature with 5 synthetic slow tasks. Observe `.runs/sandboxes/` creating 2 concurrent worktrees (respecting `maxClones: 2`). Verify each sandbox creates a separate PR against the feature branch.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001 |
| US-002 | FR-002 | FR-002 | US-001, US-002 | TR-002 |
| US-004 | FR-004, FR-005 | FR-003 | US-001 | TR-001 |
| | | FR-004 | US-004 | TR-001 |
| | | FR-005 | US-004 | TR-001 |
| US-005 | FR-006 | FR-006 | US-005 | TR-003 |
