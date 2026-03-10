# Feature Specification: 005 Parallel Dispatch

**Feature Branch**: `005-parallel-dispatch`
**Created**: 2026-03-10
**Status**: Settled
**Input**: Parallel dispatch, concurrent sandboxes, merge ordering, per-backend capacity gate.

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

### US-003 - Sequential Merge Ordering (Priority: P0)
As the orchestration engine, I want completed sandboxes to merge their changes back to the feature branch one-by-one, maintaining a lock, so that merge conflicts are handled deterministically.

**Implements**: FR-004

**Independent Test**: Simulate 2 concurrent tasks completing simultaneously. Verify their merges are serialized.

**Acceptance Scenarios**:
1. **Given** two sandboxes attempting to merge at exactly the same time, **When** the merge resolves, **Then**:
   - `grep -c "Acquired merge lock" .runs/*_dispatch.log` outputs `2`

### US-004 - Capacity Gating and Rate Limiting (Priority: P1)
As a considerate API citizen, I want the dispatcher to respect a per-backend rate limit (e.g., max 3 concurrent requests to Codex) and handle 429 Too Many Requests with exponential backoff and jitter.

**Implements**: FR-005, FR-006

**Independent Test**: Configure a backend with max concurrency 1. Submit 3 tasks. Verify 1 runs while 2 wait in queue.

**Acceptance Scenarios**:
1. **Given** `maxConcurrent: 1` and 3 pending tasks, **When** dispatching, **Then**:
   - `grep -c "Queued task.*capacity full" .runs/*_dispatch.log` outputs `>= 2`

### US-005 - Conflict Resolution Fallback (Priority: P1)
As the orchestration engine, if a sandbox merge fails due to a git conflict, I want the sandbox to pull the latest feature branch, prompt the agent to resolve the conflict, and retry the merge.

**Implements**: FR-007

**Independent Test**: Force a merge conflict. Verify the system instructs the agent to resolve it rather than failing the entire run.

**Acceptance Scenarios**:
1. **Given** a git merge conflict from a sandbox, **When** merge fails, **Then**:
   - `grep -q "Conflict detected.*dispatching resolution" .runs/*_dispatch.log` exits 0

### US-006 - Cross-Backend Dispatch Compatibility (Priority: P0)
As the orchestrator, I want to dispatch tasks seamlessly to any registered backend (local CLIs like `gemini`, `claude`, `codex` OR remote cloud backends via `@codex` PR tagging) without changing the core dispatch loop, proving that the system is backend-agnostic before 008 introduces intelligent routing.

**Implements**: FR-008

**Independent Test**: Mock a local CLI backend and a cloud backend. Verify the orchestrator invokes a local shell command for the CLI backend and a PR tagging command for the cloud backend, while respecting concurrency gates for both.

**Acceptance Scenarios**:
1. **Given** a phase with tasks routed to local `gemini` and remote `codex-cloud`, **When** dispatch runs, **Then**:
   - `grep -q "Executing local CLI.*gemini" .runs/*_dispatch.log` exits 0
   - `grep -q "Pushing branch and tagging.*@codex" .runs/*_dispatch.log` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `DispatchOrchestrator` that orchestrates multiple tasks within a phase concurrently. It MUST calculate independent tasks based on explicit task dependencies, or default to all tasks in a phase if no dependencies exist. (Implements: US-001)
- **FR-002**: System MUST clone the host repository into an ephemeral `workDir` for each dispatched task (a sandbox). The sandbox MUST use `--reference` or git worktrees to optimize cloning speed and disk usage. (Implements: US-001, US-002)
- **FR-003**: System MUST invoke the `ShipExecutor.shipPhase()` (from 004) or a task-equivalent inner loop for each sandbox, passing the explicit `workDir` and `backend`. (Implements: US-001)
- **FR-004**: System MUST serialize merges from sandboxes back to the active feature branch using a file-based lock. Commits MUST be rebased or merged cleanly. (Implements: US-003)
- **FR-005**: System MUST enforce a per-backend `maxConcurrent` capacity gate. Tasks exceeding the gate MUST wait in a queue. (Implements: US-004)
- **FR-006**: System MUST catch HTTP 429 logic globally or instruct the single-task loop to apply exponential backoff + jitter, returning the sandbox to a suspended state if needed. (Implements: US-004)
- **FR-007**: System MUST detect merge conflicts (`git merge` failure). On conflict, it MUST pause the merge, check out the conflict state in the sandbox, and dispatch a targeted "resolve conflict" prompt to the agent, followed by a retry. (Implements: US-005)
- **FR-008**: System MUST support diverse dispatch strategies. Local CLI agents MUST execute via sub-processes in sandboxes; Cloud agents (e.g. Codex Cloud) MUST execute by pushing sandbox commits to remote and creating/tagging draft PRs, awaiting remote completion. (Implements: US-006)

#### FR-007 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Conflict resolution fails 3 times | `Conflict resolution failed after 3 attempts` | 1 |
| Sandbox clone fails | `Failed to provision sandbox` | 1 |

#### FR-005 Error States
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

---

## 6. Technical Constraints

- **TC-001**: Determinism — SHA256 input/output stability for all engine functions.
- **TC-002**: Air-Gapped — No external network calls at runtime. All assets vendored/bundled.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing var → `process.exit(1)`.
- **TC-004**: No Host Mutation — Tasks MUST NOT modify the host repository's working tree. All execution happens in the sandbox `workDir`.
- **TC-005**: Merge Atomicity — Merges MUST be atomic. A failed merge MUST NOT leave the host feature branch in a conflicted `MERGING` state.

---

## 7. Testing Requirements

- **TR-001**: `src/server/dispatch-orchestrator.test.ts` — Verify concurrency limit is respected. Mock `shipPhase()`, dispatch 5 tasks with concurrency 2, assert at most 2 are "running" simultaneously. Vitest. (FR-001, FR-005)
- **TR-002**: `src/server/sandbox-manager.test.ts` — Verify git worktree/clone creation creates an isolated directory that does not leak state to host. Vitest+Shell. (FR-002)
- **TR-003**: `src/server/merge-queue.test.ts` — Verify file-lock serialization. Attempt 3 concurrent merges, assert they are ordered sequentially and host branch remains clean. Vitest. (FR-004)
- **TR-004**: `src/server/dispatch-orchestrator.test.ts` — Verify conflict resolution flow. Mock a merge failure, assert a new resolution task is queued for the sandbox. Vitest. (FR-007)
- **TR-005**: `src/server/backends/invocation-strategy.test.ts` — Verify cross-backend compatibility. Mock a local CLI config and a Cloud config. Assert `invoke()` executes shell commands for local and git push/PR logic for Cloud, maintaining the same Promise interface. Vitest. (FR-008)

---

## 8. Success Criteria

- **SC-001**: Feature shipping duration decreases roughly linearly with available concurrency (discounting merge overhead).
- **SC-002**: The host repository working tree is never corrupted or left in a conflicted state by parallel agents.
- **SC-003**: Backend rate limits are strictly honored; no 429 errors bubble up to crash the run.

---

## 9. Verification Requirements

- **VR-001**: Execute `gwrk ship 005-parallel-dispatch` against a dummy feature with 5 synthetic slow tasks. Observe `.runs/sandboxes/` creating 3 concurrent directories.
- **VR-002**: Force a merge conflict by pushing a conflicting change to the dummy feature branch while an agent is running. Verify the conflicting agent enters the resolution workflow and successfully resolves it.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002, FR-003 | FR-001 | US-001 | TR-001 |
| US-002 | FR-002 | FR-002 | US-001, US-002 | TR-002 |
| US-003 | FR-004 | FR-003 | US-001 | TR-001 |
| US-004 | FR-005, FR-006 | FR-004 | US-003 | TR-003 |
| US-005 | FR-007 | FR-005 | US-004 | TR-001 |
| | | FR-006 | US-004 | TR-001 |
| | | FR-007 | US-005 | TR-004 |
| US-006 | FR-008 | FR-008 | US-006 | TR-005 |
