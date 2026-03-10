---
type: implementation_plan
feature: 002-build-server
last_modified: "2026-03-08T18:40:00Z"
---

# Implementation Plan: 002 Build Server

**Branch**: `002-build-server` | **Date**: 2026-02-27 | **Spec**: [spec.md](./spec.md)

## Summary

Build the gwrk Build Server — a persistent Fastify daemon on `localhost:18790` that serves as the control plane for multi-agent dispatch. The plan is structured in 6 phases:

1. **Daemon Bootstrap** — Fastify server, health endpoint, PID management, `gwrk server start/stop` commands.
2. **System Monitor & Status** — Resource monitoring (CPU/MEM/disk), `gwrk status` command, throttle logic.
3. **Git Manager & Context Compiler** — Branch lifecycle, context compilation from rules/spec/plan/tasks.
4. **Docker Sandbox Manager** — Container lifecycle, `Dockerfile.sandbox`, workspace mounting, label conventions.
5. **Dispatch Queue & Orchestrator** — Queue engine, `POST /api/dispatch`, retry + escalation, dispatches.jsonl persistence.
6. **Resilience & Connectivity** — macOS sleep/wake detection, network state monitoring, dispatch pause/resume, sandbox freeze/thaw, component-level health endpoint.

**Dependency**: Phase 1 of this plan (CLI commands) depends on 001-cli-core's Commander infrastructure, config loader (`loadConfig`), and agent dispatch contract (`dispatchAgent`).

**Cross-reference notes**:
- **004-ship-loop**: Complementary — WUD uses `feat/<feature>` branches locally; Build Server uses `phase/<feature>-<phase>` inside Docker sandboxes. No conflict.
- **001-cli-core**: Build Server extends `.gwrkrc.json` (DM-002) with `server.*` and `parallelism.*` sections.

---

## Phases and File Structure

### Phase 1: Daemon Bootstrap

Stand up the Fastify server with health endpoint, PID file management, and `gwrk server start/stop` CLI commands.

**Files (7):**
- `src/server/index.ts` (NEW: Fastify bootstrap, route registration, `/health` endpoint, graceful shutdown handler)
- `src/server/pid.ts` (NEW: PID file read/write/check/remove at `.gwrk/server.pid`)
- `src/commands/server.ts` (NEW: `gwrk server start` and `gwrk server stop` subcommands)
- `src/cli.ts` (MODIFY: Register `server` command group)
- `src/utils/config.ts` (MODIFY: Extend `GwrkConfigSchema` with `server.port`, `server.host`)
- `package.json` (MODIFY: Add `fastify` dependency)
- `tsconfig.json` (MODIFY: Ensure ESM output works with Fastify)

**Requirements Addressed:** FR-001, FR-002, FR-003, FR-011, US-001, US-002, US-007, TC-003, TC-004, TC-005, TC-007

**Dependencies:** 001-cli-core (Commander routing, config loader)

**Contract Mapping:**
- `contracts/server.md` → `startServer(config)` → `src/server/index.ts`
- `contracts/server.md` → `stopServer()` → `src/server/index.ts`
- `contracts/server.md` → `writePid() / readPid() / removePid()` → `src/server/pid.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Config validation — no `.default()` calls |
| `coding-style.md` | TypeScript only, ESM modules |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/server.test.ts` | `gwrk server start` creates PID, binds port; `server stop` releases |
| TR-002 | Unit | `src/server/index.test.ts` | `/health` returns 200; `/api/status` returns server info |

#### Done When
- `pnpm vitest run src/commands/server.test.ts` exits 0
- `pnpm vitest run src/server/index.test.ts` exits 0
- `test -f src/server/index.ts && test -f src/server/pid.ts && test -f src/commands/server.ts` exits 0
- `grep -q '"fastify"' package.json` exits 0

---

### Phase 2: System Monitor & Status

Add system resource monitoring (CPU, memory, disk) and the `gwrk status` command that queries the daemon.

**Files (5):**
- `src/server/monitor.ts` (NEW: System resource sampler using `os` module — CPU%, MEM%, disk free GB — on configurable interval)
- `src/server/routes/status.ts` (NEW: `GET /api/status` route returning `SystemStatus` JSON)
- `src/commands/status.ts` (NEW: `gwrk status` command — queries daemon `/api/status` or returns `{server:{status:"stopped"}}`)
- `src/cli.ts` (MODIFY: Register `status` command)
- `src/utils/config.ts` (MODIFY: Extend schema with `parallelism.local.maxCpu`, `maxMem`, `minDiskGb`, `maxClones`, `parallelism.cloud.maxConcurrent`)

**Requirements Addressed:** FR-004, FR-014, US-003, US-010, TC-003

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/monitor.md` → `SystemMonitor.sample()` → `src/server/monitor.ts`
- `contracts/monitor.md` → `SystemMonitor.isThrottled()` → `src/server/monitor.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Config validation — all parallelism fields required |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Unit | `src/server/monitor.test.ts` | CPU/MEM/disk sampling; throttle when limits exceeded |
| TR-002 | Unit | `src/server/routes/status.test.ts` | `/api/status` returns full `SystemStatus` shape |

#### Done When
- `pnpm vitest run src/server/monitor.test.ts` exits 0
- `pnpm vitest run src/server/routes/status.test.ts` exits 0
- `test -f src/server/monitor.ts && test -f src/server/routes/status.ts && test -f src/commands/status.ts` exits 0

---

### Phase 3: Git Manager & Context Compiler

Implement Git branch lifecycle (create phase branch, merge-back, conflict detection) and agent context compilation.

**Files (5):**
- `src/server/git-manager.ts` (NEW: `createPhaseBranch()`, `mergePhaseBack()`, `hasConflicts()`, `isClean()`)
- `src/server/context.ts` (NEW: `compileContext()` — reads rules, persona, spec, plan, tasks → single Markdown)
- `src/server/git-manager.test.ts` (NEW: Branch creation, merge-back, conflict detection tests)
- `src/server/context.test.ts` (NEW: Context compilation tests)
- `src/server/types.ts` (NEW: Shared types — `DispatchRecord`, `DispatchAttempt`, `DispatchStatus`, `SystemStatus`, `SandboxInfo`)

**Requirements Addressed:** FR-007, FR-010, FR-013, US-006, US-009, TC-006

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/git-manager.md` → `createPhaseBranch(feature, phase)` → `src/server/git-manager.ts`
- `contracts/git-manager.md` → `mergePhaseBack(feature, phase)` → `src/server/git-manager.ts`
- `contracts/context.md` → `compileContext(featureDir, phaseId)` → `src/server/context.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Git conventions, branch naming |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/git-manager.test.ts` | Branch create from feature, merge-back, conflict detection |
| TR-006 | Unit | `src/server/context.test.ts` | Context file contains rules, spec, plan, tasks sections |

#### Done When
- `pnpm vitest run src/server/git-manager.test.ts` exits 0
- `pnpm vitest run src/server/context.test.ts` exits 0
- `test -f src/server/git-manager.ts && test -f src/server/context.ts && test -f src/server/types.ts` exits 0

---

### Phase 4: Docker Sandbox Manager

Implement Docker container lifecycle and the sandbox Dockerfile.

**Files (5):**
- `src/server/sandbox.ts` (NEW: `createSandbox()`, `destroySandbox()`, `listSandboxes()` — Docker container create/label/mount/destroy via `dockerode`)
- `Dockerfile.sandbox` (NEW: `gwrk-sandbox:bookworm-slim` with Node.js LTS, Git, `gh` CLI)
- `src/server/sandbox.test.ts` (NEW: Container lifecycle tests with mocked `dockerode`)
- `package.json` (MODIFY: Add `dockerode` + `@types/dockerode` dependencies)
- `.dockerignore` (MODIFY: Ensure sandbox image builds cleanly)

**Requirements Addressed:** FR-005, FR-006, FR-012, US-004, US-008, TC-006, TC-008

**Dependencies:** Phase 3 (needs `compileContext()` to inject into sandbox)

**Contract Mapping:**
- `contracts/sandbox.md` → `createSandbox(opts)` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `destroySandbox(containerId)` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `listSandboxes()` → `src/server/sandbox.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Docker label conventions |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Unit | `src/server/sandbox.test.ts` | Create with labels, mount at `/workspace`, destroy on completion |
| TR-009 | Shell | `Dockerfile.sandbox` | Build image, verify `node`, `git`, `gh` available |

#### Done When
- `pnpm vitest run src/server/sandbox.test.ts` exits 0
- `test -f Dockerfile.sandbox` exits 0
- `test -f src/server/sandbox.ts` exits 0

---

### Phase 5: Dispatch Queue & Orchestrator

Wire up the dispatch queue engine, `POST /api/dispatch` endpoint, retry + escalation logic, and `dispatches.jsonl` persistence.

**Files (7):**
- `src/server/dispatch.ts` (NEW: `DispatchQueue` class — FIFO queue, `enqueue()`, `dequeue()`, `processNext()`, retry logic, backend escalation)
- `src/server/routes/dispatch.ts` (NEW: `POST /api/dispatch`, `GET /api/dispatch/:feature/:phase`, `GET /api/dispatch/queue`)
- `src/server/persistence.ts` (NEW: Append-only `.gwrk/dispatches.jsonl` writer)
- `src/server/dispatch.test.ts` (NEW: Queue FIFO, throttle, retry × 3, escalation tests)
- `src/server/routes/dispatch.test.ts` (NEW: HTTP endpoint tests)
- `src/server/index.ts` (MODIFY: Register dispatch routes, wire Monitor → Queue throttle)
- `src/server/integration.test.ts` (NEW: E2E — start daemon subprocess, POST dispatch, verify container)

**Requirements Addressed:** FR-005, FR-008, FR-009, US-004, US-005, TC-001

**Dependencies:** Phase 2 (monitor for throttle), Phase 3 (git-manager, context), Phase 4 (sandbox)

**Contract Mapping:**
- `contracts/dispatch.md` → `DispatchQueue.enqueue(request)` → `src/server/dispatch.ts` ✅ implemented
- `contracts/dispatch.md` → `DispatchQueue.processNext()` → `src/server/dispatch.ts` ✅ implemented
- `contracts/dispatch.md` → `DispatchQueue.handleCompletion(dispatchId, exitCode, stderr)` → `src/server/dispatch.ts` ❌ **NOT IMPLEMENTED** — must call `finishRun()`, handle retry ×3, escalate backend
- `contracts/dispatch.md` → `DispatchQueue.getQueue()` → `src/server/dispatch.ts` ❌ **NOT IMPLEMENTED** — rename existing `getStatus()` to `getQueue()`, add `throttled: boolean` field
- `contracts/dispatch.md` → `DispatchQueue.getDispatch(featureId, phaseId)` → `src/server/dispatch.ts` ❌ **NOT IMPLEMENTED** — search active + queued + history
- `contracts/dispatch.md` → `persistDispatch(record)` → `src/server/persistence.ts` ✅ implemented

**Remediation Notes (Issue #4):**
- T027: Add `handleCompletion()`, rename `getStatus()` → `getQueue()`, add `getDispatch()`. Add `runId?: number` to `DispatchAttempt` in `src/server/types.ts`. The existing `setTimeout` stub in `runDispatch` is acceptable — mark with `// TODO: Phase 06 — real agent execution`.
- T030: Add 5 test cases for new methods (handleCompletion success/retry/escalation, getQueue, getDispatch). Existing 3 tests must continue passing.
- T032: No code changes expected — just verify `pnpm build` passes after T027 changes.
- T034: Fix integration.test.ts assertion if dispatch POST returns 200 instead of 201. Run all 3 test suites + `pnpm build`.

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | No magic values, config from `.gwrkrc.json` |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/dispatch.test.ts` | FIFO ordering, maxClones throttle, 3× retry + escalation, handleCompletion, getQueue, getDispatch |
| TR-008 | Integration | `src/server/integration.test.ts` | Daemon subprocess, POST dispatch, container created |

#### Done When
- `pnpm vitest run src/server/dispatch.test.ts` exits 0
- `pnpm vitest run src/server/routes/dispatch.test.ts` exits 0
- `pnpm vitest run src/server/integration.test.ts` exits 0
- `pnpm build` exits 0
- `test -f src/server/dispatch.ts && test -f src/server/routes/dispatch.ts && test -f src/server/persistence.ts` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `GwrkConfig` (extended) | `src/utils/config.ts` | `src/server/index.ts`, `src/server/dispatch.ts`, `src/server/monitor.ts` |
| `DispatchRecord` | `src/server/types.ts` | `src/server/dispatch.ts`, `src/server/persistence.ts`, `src/server/routes/dispatch.ts` |
| `DispatchAttempt` | `src/server/types.ts` | `src/server/dispatch.ts` |
| `DispatchStatus` | `src/server/types.ts` | `src/server/dispatch.ts`, `src/server/routes/dispatch.ts` |
| `SystemStatus` | `src/server/types.ts` | `src/server/monitor.ts`, `src/server/routes/status.ts`, `src/commands/status.ts` |
| `SandboxInfo` | `src/server/types.ts` | `src/server/sandbox.ts`, `src/server/routes/status.ts` |
| `AgentBackend` | `src/utils/agent.ts` (from 001) | `src/server/dispatch.ts`, `src/server/types.ts` |
| `dispatchAgent()` | `src/utils/agent.ts` (from 001) | `src/server/dispatch.ts` |
| `loadConfig()` | `src/utils/config.ts` (from 001) | `src/server/index.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| US-010 (partial) | Resource throttle: disk-free check on clone | Requires sandbox clone detection (Phase 5 parallel dispatch, spec 005) | 005-parallel-dispatch |

All other spec items are fully covered in Phases 1–6.

---

### Phase 6: Resilience & Connectivity

Add macOS sleep/wake detection, network state monitoring, dispatch queue pause/resume on connectivity loss, sandbox freeze/thaw, and enhanced component-level health endpoint.

**Files (8):**
- `src/server/lifecycle.ts` (NEW: Heartbeat-drift sleep/wake detector. Emits `server:sleep`, `server:wake` events. Drives Graceful Reconnect Protocol.)
- `src/server/network.ts` (NEW: Network interface watcher via `os.networkInterfaces()` polling. `isOnline()`. Emits `network:down`, `network:up` events.)
- `src/server/routes/health.ts` (NEW: Enhanced `/health` endpoint returning component-level readiness JSON for server, Docker, network.)
- `src/server/index.ts` (MODIFY: Wire lifecycle + network events → dispatch queue `pause()`/`resume()`, sandbox `pauseAll()`/`unpauseAll()`. Expose `server.lifecycle` on `/api/status`.)
- `src/server/sandbox.ts` (MODIFY: Add `pauseAll()` and `unpauseAll()` methods using `docker pause`/`docker unpause`.)
- `src/server/dispatch.ts` (MODIFY: Add `pause()` and `resume()` methods alongside existing `isThrottled()`.)
- `src/utils/config.ts` (MODIFY: Extend schema with `server.heartbeatIntervalMs`, `server.networkCheckIntervalMs`.)
- `src/server/types.ts` (MODIFY: Add `ServerLifecycle` type, `HealthResponse` type, `NetworkStatus` type.)

**Requirements Addressed:** FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, US-011, US-012, US-013, TC-009, TC-010

**Dependencies:** Phase 2 (monitor), Phase 4 (sandbox — needs `pauseAll`), Phase 5 (dispatch — needs `pause`)

**Contract Mapping:**
- `contracts/lifecycle.md` → `LifecycleMonitor.start()`, `LifecycleMonitor.onSleep()`, `LifecycleMonitor.onWake()` → `src/server/lifecycle.ts`
- `contracts/network.md` → `NetworkMonitor.start()`, `NetworkMonitor.isOnline()` → `src/server/network.ts`
- `contracts/health.md` → `getComponentHealth()` → `src/server/routes/health.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `workspace.md` | Config validation — `heartbeatIntervalMs`, `networkCheckIntervalMs` required, no defaults |
| `workspace.md` | No native addons (TC-009) |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-010 | Unit | `src/server/lifecycle.test.ts` | Heartbeat drift → `server:sleep` event; reconnect protocol → `server:ready` only when all checks pass |
| TR-011 | Unit | `src/server/network.test.ts` | Interface removal → `network:down`; interface restoration → `network:up`; `isOnline()` reflects state |
| TR-012 | Unit | `src/server/routes/health.test.ts` | Component-level JSON shape; degraded states; Docker unavailable → `components.docker: unavailable` |

#### Done When
- `pnpm vitest run src/server/lifecycle.test.ts` exits 0
- `pnpm vitest run src/server/network.test.ts` exits 0
- `pnpm vitest run src/server/routes/health.test.ts` exits 0
- `test -f src/server/lifecycle.ts && test -f src/server/network.ts && test -f src/server/routes/health.ts` exits 0

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | Phase 1 | Planned |
| US-002 | Phase 1 | Planned |
| US-003 | Phase 2 | Planned |
| US-004 | Phase 4, 5 | Planned |
| US-005 | Phase 5 | Planned |
| US-006 | Phase 3 | Planned |
| US-007 | Phase 1 | Planned |
| US-008 | Phase 4 | Planned |
| US-009 | Phase 3 | Planned |
| US-010 | Phase 2 | Planned (disk-free clone deferred) |
| US-011 | Phase 6 | Planned |
| US-012 | Phase 6 | Planned |
| US-013 | Phase 6 | Planned |
| FR-001 | Phase 1 | Planned |
| FR-002 | Phase 1 | Planned |
| FR-003 | Phase 1 | Planned |
| FR-004 | Phase 2 | Planned |
| FR-005 | Phase 4, 5 | Planned |
| FR-006 | Phase 4 | Planned |
| FR-007 | Phase 3 | Planned |
| FR-008 | Phase 5 | Planned |
| FR-009 | Phase 5 | Planned |
| FR-010 | Phase 3 | Planned |
| FR-011 | Phase 1 | Planned |
| FR-012 | Phase 4 | Planned |
| FR-013 | Phase 3 | Planned |
| FR-014 | Phase 2 | Planned |
| FR-015 | Phase 6 | Planned |
| FR-016 | Phase 6 | Planned |
| FR-017 | Phase 6 | Planned |
| FR-018 | Phase 6 | Planned |
| FR-019 | Phase 6 | Planned |
| FR-020 | Phase 6 | Planned |
| FR-021 | Phase 6 | Planned |
| DM-001 | Phase 3 (types), Phase 5 (persist) | Planned |
| DM-002 | Phase 1, 2 (config) | Planned |
| DM-003 | Phase 2 (status) | Planned |
| TC-001 | Phase 5 | Planned |
| TC-002 | Phase 1 | Planned |
| TC-003 | Phase 1, 2 | Planned |
| TC-004 | Phase 1 | Planned |
| TC-005 | Phase 1 | Planned |
| TC-006 | Phase 4 | Planned |
| TC-007 | Phase 1 | Planned |
| TC-008 | Phase 4 | Planned |
| TC-009 | Phase 6 | Planned |
| TC-010 | Phase 6 | Planned |
| TR-001 | Phase 1 | Planned |
| TR-002 | Phase 1, 2 | Planned |
| TR-003 | Phase 5 | Planned |
| TR-004 | Phase 4 | Planned |
| TR-005 | Phase 3 | Planned |
| TR-006 | Phase 3 | Planned |
| TR-007 | Phase 2 | Planned |
| TR-008 | Phase 5 | Planned |
| TR-009 | Phase 4 | Planned |
| TR-010 | Phase 6 | Planned |
| TR-011 | Phase 6 | Planned |
| TR-012 | Phase 6 | Planned |
| SC-001 | Phase 1 | Planned |
| SC-002 | Phase 1 | Planned |
| SC-003 | Phase 5 | Planned |
| SC-004 | Phase 5 | Planned |
| SC-005 | Phase 6 | Planned |
| SC-006 | Phase 6 | Planned |
| VR-001 | Phase 5 | Planned |
| VR-002 | Phase 1 | Planned |
| VR-003 | Phase 1 | Planned |
| VR-004 | Phase 6 | Planned |
| VR-005 | Phase 5 | Planned |
