# Implementation Plan: 005 Parallel Dispatch

**Branch**: `develop` | **Date**: 2026-03-10 | **Spec**: [spec.md](./spec.md)

## Summary

This plan implements parallel dispatch for gwrk, enabling multiple tasks within a phase to be executed concurrently in isolated sandboxes. Key features include:
- **Isolated Workspaces**: Using `git worktree` to provide each agent with a private clone of the repository, preventing file collisions.
- **Merge Serialization**: A file-locked `MergeQueue` that ensures atomic and clean merges back to the feature branch.
- **Capacity Gating**: Per-backend concurrency limits and basic 429 rate-limiting support.
- **Conflict Resolution**: Automated detection and agent-led resolution of git merge conflicts.
- **Task-Level Concurrency**: Orchestrating independent tasks within a phase simultaneously.

---

## Phases and File Structure

### Phase 1: Isolated Workspaces (Git Worktrees)

Provision truly isolated workspaces for each dispatched task using `git worktree`. This ensures that concurrent agents do not interfere with each other's files.

**Files (4):**
- `src/server/git-manager.ts` (MODIFY: Add `createWorktree(branch, path)` and `removeWorktree(path)`)
- `src/server/sandbox.ts` (MODIFY: Update `createSandbox` to mount a specific `workDir` instead of project root)
- `src/server/dispatch.ts` (MODIFY: Integrate worktree lifecycle into `runDispatch`)
- `src/server/types.ts` (MODIFY: Add `workDir` to `DispatchRecord` and `SandboxInfo`)

**Requirements Addressed**: FR-002, US-002

**Dependencies**: 002-build-server (Baseline)

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| api-architecture.md | Proper isolation between server components |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Integration | `src/server/sandbox-manager.test.ts` | Verify worktree creation creates isolated directory with no leak to host |

#### Done When
- `npm test src/server/sandbox-manager.test.ts` exits 0
- `gwrk status` shows `workDir` for active sandboxes

---

### Phase 2: Serialized Merge Queue

Implement a mechanism to serialize merges from multiple sandboxes back to the main feature branch, ensuring atomicity and preventing corruption.

**Files (3):**
- `src/server/merge-queue.ts` (NEW: Manage a queue of pending merges with file-based locking)
- `src/server/git-manager.ts` (MODIFY: Add `atomicMerge(source, target, workDir)` using a file lock)
- `src/server/dispatch.ts` (MODIFY: Use `MergeQueue` to handle task completion)

**Requirements Addressed**: FR-004, US-003, TC-005

**Dependencies**: Phase 1

**Contract Mapping**:
- `contracts/merge-queue.md` → `enqueueMerge` → `src/server/merge-queue.ts`
- `contracts/git-manager.md` → `atomicMerge` → `src/server/git-manager.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| api-architecture.md | Lock management and serialization |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/merge-queue.test.ts` | Verify 3 concurrent merges are ordered sequentially and branch remains clean |

#### Done When
- `npm test src/server/merge-queue.test.ts` exits 0

---

### Phase 3: Task-Level Concurrency & Orchestration

Upgrade the dispatch loop to handle individual tasks within a phase concurrently, respecting task dependencies.

**Files (5):**
- `src/utils/state.ts` (MODIFY: Add `dependencies: string[]` to `TaskSchema`)
- `src/server/dispatch-orchestrator.ts` (NEW: Calculate independent tasks and manage phase-level concurrency)
- `src/server/dispatch.ts` (MODIFY: Support task-level dispatch records)
- `src/server/routes/dispatch.ts` (MODIFY: Add `/api/dispatch/task` endpoint)
- `src/server/types.ts` (MODIFY: Add `taskId` to `DispatchRecord`)

**Requirements Addressed**: FR-001, FR-003, US-001

**Dependencies**: Phase 2

**Contract Mapping**:
- `contracts/dispatch-orchestrator.md` → `orchestratePhase` → `src/server/dispatch-orchestrator.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| api-architecture.md | Dependency graph resolution |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Integration | `src/server/dispatch-orchestrator.test.ts` | Verify concurrency limit and task dependencies are respected |

#### Done When
- `npm test src/server/dispatch-orchestrator.test.ts` exits 0
- Dispatching a phase with 3 independent tasks results in 3 concurrent sandboxes

---

### Phase 4: Per-Backend Capacity Gating

Enforce per-backend concurrency limits and implement basic rate-limiting resilience.

**Files (3):**
- `src/server/dispatch.ts` (MODIFY: Track active count per backend and enforce `maxConcurrent`)
- `src/utils/config.ts` (MODIFY: Ensure per-backend limits are loaded correctly)
- `src/server/backends/invocation-strategy.ts` (NEW: Abstract local CLI vs Cloud dispatch logic)

**Requirements Addressed**: FR-005, FR-006, FR-008, US-004, US-006

**Dependencies**: Phase 3

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| observability-governance.md | Logging of capacity hits and rate limits |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/backends/invocation-strategy.test.ts` | Verify local vs cloud dispatch strategies and concurrency gates |

#### Done When
- `npm test src/server/backends/invocation-strategy.test.ts` exits 0
- Log shows `Queued task [ID] - [Backend] capacity full` when limits reached

---

### Phase 5: Conflict Resolution Workflow

Handle git merge conflicts by dispatching specialized resolution tasks to the agent.

**Files (2):**
- `src/server/git-manager.ts` (MODIFY: Detect conflict and pause merge, return conflict state)
- `src/server/dispatch.ts` (MODIFY: Handle merge conflict by creating resolution task for the sandbox)

**Requirements Addressed**: FR-007, US-005

**Dependencies**: Phase 4

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| api-architecture.md | Error state recovery and retry logic |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Integration | `src/server/dispatch-orchestrator.test.ts` | Mock merge failure, assert a resolution task is queued for the sandbox |

#### Done When
- Forced merge conflict results in a "resolve conflict" prompt being logged/dispatched
- Conflict resolution retry loop passes after manual intervention or mock resolution

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `DispatchRecord` | `src/server/types.ts` | `DispatchQueue`, `DispatchOrchestrator`, API Routes |
| `SandboxInfo` | `src/server/types.ts` | `SandboxManager`, `statusRoutes` |
| `Task` | `src/utils/state.ts` | `DispatchOrchestrator`, `DispatchQueue` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

None — full coverage.

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 3 | Planned |
| US-002 | 1 | Planned |
| US-003 | 2 | Planned |
| US-004 | 4 | Planned |
| US-005 | 5 | Planned |
| US-006 | 4 | Planned |
| FR-001 | 3 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 3 | Planned |
| FR-004 | 2 | Planned |
| FR-005 | 4 | Planned |
| FR-006 | 4 | Planned |
| FR-007 | 5 | Planned |
| FR-008 | 4 | Planned |
| DM-001 | 3 | Planned (In-memory/disk queue) |
| TC-001 | All | Planned (SHA256 stability) |
| TC-002 | All | Planned (Air-gapped) |
| TC-003 | 4 | Planned (Zod validation) |
| TC-004 | 1 | Planned (No host mutation) |
| TC-005 | 2 | Planned (Merge atomicity) |
| TR-001 | 3 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 2 | Planned |
| TR-004 | 5 | Planned |
| TR-005 | 4 | Planned |
| VR-001 | 3 | Planned |
| VR-002 | 5 | Planned |
| SC-001 | 3 | Planned |
| SC-002 | 1 | Planned |
| SC-003 | 4 | Planned |
