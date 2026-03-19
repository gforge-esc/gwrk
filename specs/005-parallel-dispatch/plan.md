# Implementation Plan: 005 Parallel Dispatch

**Branch**: `005-parallel-dispatch` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)

## Summary

Implement parallel dispatch of tasks within a phase using Git worktree sandboxes. This replaces the Docker-based sandbox model with a faster, lower-overhead Git worktree approach (R001) and introduces a `DispatchOrchestrator` to manage concurrent task execution within a single phase while respecting per-backend capacity gates.

---

## Phases and File Structure

### Phase 1: Worktree Sandbox Manager

Refactor the sandbox management layer to use Git worktrees instead of Docker. This provides task-level isolation without the overhead of containerization.

**Files (4):**
- `src/server/sandbox.ts` (MODIFY: Replace Dockerode with `git worktree` logic. Implement `.runs/sandboxes/` lifecycle.)
- `src/server/sandbox.test.ts` (MODIFY: Update tests to verify worktree creation/removal instead of Docker containers.)
- `src/server/types.ts` (MODIFY: Update `SandboxInfo` to reflect worktree paths instead of container IDs. Add `TaskRecord`.)
- `src/server/dispatch.ts` (MODIFY: Update `DispatchQueue` to use the refactored `SandboxManager`.)

**Requirements Addressed:** FR-002, TC-004, TC-005, US-002

**Dependencies:** None

**Contract Mapping:**
- `specs/004-ship-loop/contracts/dispatch.md` → `dispatchToAgent` → `src/utils/agent.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-004-agent-native-output.md` | Exit codes and signals |
| `docs/reference/parallel-dispatch-architecture.md` | Worktree lifecycle and isolation |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit | `src/server/sandbox.test.ts` | `git worktree list` contains the new task path; directory exists and is isolated. |

#### Done When
- `pnpm vitest run src/server/sandbox.test.ts` exits 0

### Phase 2: Parallel Dispatch Orchestrator

Implement the orchestrator that manages multiple tasks within a phase, executing independent tasks concurrently up to the backend capacity limit.

**Files (4):**
- `src/server/dispatch-orchestrator.ts` (NEW: Implement `DispatchOrchestrator` for parallel task execution, concurrency management, and 429 backoff.)
- `src/server/dispatch-orchestrator.test.ts` (NEW: Verify parallel execution and capacity gating.)
- `src/server/dispatch.ts` (MODIFY: Integrate `DispatchOrchestrator` into the phase implementation loop.)
- `src/utils/config.ts` (MODIFY: Ensure `parallelism` settings are properly typed and loaded.)

**Requirements Addressed:** FR-001, FR-003, FR-004, FR-005, FR-006, US-001, US-004, US-005

**Dependencies:** Phase 1

**Contract Mapping:**
- `specs/004-ship-loop/contracts/dispatch.md` → `dispatchToAgent` → `src/utils/agent.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-006-plugin-agent-backends.md` | Backend dispatch interface |
| `docs/decisions/ADR-001-task-tracking.md` | Task state transitions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/server/dispatch-orchestrator.test.ts` | 5 tasks dispatched with concurrency 2 result in max 2 active sandboxes at any time. |
| TR-003 | Unit | `src/server/backends/invocation-strategy.test.ts` | Local CLI backends (gemini, claude) are invoked with correct shell commands in their respective workdirs. |

#### Done When
- `pnpm vitest run src/server/dispatch-orchestrator.test.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| TaskRecord | `src/server/types.ts` | `src/server/dispatch-orchestrator.ts`, `src/server/dispatch.ts` |
| SandboxOptions | `src/server/sandbox.ts` | `src/server/dispatch-orchestrator.ts`, `src/server/dispatch.ts` |
| TaskDispatch | `src/utils/agent.ts` | `src/server/dispatch-orchestrator.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| FR-006 (Cloud) | Cloud Agent Dispatch | Deferred to Tier 3 (F014 Phase 3+) | F014 |
| TC-005 (Docker) | Docker Sandbox | R001 decided on Git worktrees for local performance. | Backlog |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 2 | Planned |
| US-002 | 1 | Planned |
| US-004 | 2 | Planned |
| US-005 | 2 | Planned |
| FR-001 | 2 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 2 | Planned |
| FR-004 | 2 | Planned |
| FR-005 | 2 | Planned |
| FR-006 | 2 | Planned |
| DM-001 | 2 | Planned |
| DM-002 | 2 | Planned |
| TC-004 | 1 | Planned |
| TC-005 | 1 | Planned |
| TR-001 | 2 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 2 | Planned |
| SC-001 | 2 | Planned |
| SC-002 | 1 | Planned |
| SC-003 | 2 | Planned |
| VR-001 | 2 | Planned |
