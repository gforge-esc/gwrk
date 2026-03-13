# Implementation Plan: 002 Build Server

**Branch**: `002-build-server` | **Date**: 2026-03-11 | **Spec**: [spec.md](./spec.md)

## Summary

Implement a local persistent Fastify daemon (localhost:18790) that serves as the gwrk control plane. The build server manages the dispatch queue, Docker sandbox lifecycle (including automated cleanup), Git branch management for phases, and system resource monitoring with sleep/wake resilience and network awareness. All execution data is persisted to the shared SQLite ledger.

---

## Phases and File Structure

### Phase 1: Foundation & PID Management

Bootstrap the Fastify server, implement PID file management to ensure single-instance execution, and register the `server start/stop/clean` CLI commands.

**Files (7):**
- `package.json` (MODIFY: Add `fastify`, `fastify-healthcheck`, `dockerode`, `uuid` dependencies)
- `src/utils/config.ts` (MODIFY: Extend `GwrkConfigSchema` with `server` and `parallelism` blocks)
- `src/server/pid.ts` (NEW: Implementation of `writePid`, `readPid`, `removePid`)
- `src/server/index.ts` (NEW: Implementation of `startServer`, `stopServer` bootstrap)
- `src/commands/server.ts` (NEW: Implementation of `gwrk server start/stop/clean` commands)
- `src/cli.ts` (MODIFY: Register `server` command group)
- `src/server/types.ts` (NEW: Shared domain types and Zod schemas)

**Requirements Addressed**: FR-001, FR-002, FR-003, FR-011, FR-024, TC-003, TC-004, TC-005

**Dependencies**: 001-cli-core (Phase 1)

**Contract Mapping**:
- `contracts/server.md` → `startServer` → `src/server/index.ts`
- `contracts/server.md` → `stopServer` → `src/server/index.ts`
- `contracts/server.md` → `writePid` → `src/server/pid.ts`
- `contracts/server.md` → `readPid` → `src/server/pid.ts`
- `contracts/server.md` → `removePid` → `src/server/pid.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | Config and environment management |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/server.test.ts` | `gwrk server start` writes PID, `stop` removes it |
| TR-002 | Unit | `src/server/index.test.ts` | Fastify starts on configured port |

#### Done When
- `gwrk server start && test -f .gwrk/server.pid && gwrk server stop && test ! -f .gwrk/server.pid` exits 0

---

### Phase 2: System Monitoring & Status

Implement the `SystemMonitor` for resource sampling (CPU, Mem, Disk) and the `status` command to report server health and resource usage.

**Files (3):**
- `src/server/monitor.ts` (NEW: Implementation of `SystemMonitor` class)
- `src/server/routes/status.ts` (NEW: `GET /api/status` route)
- `src/commands/status.ts` (NEW: `gwrk status` CLI command)

**Requirements Addressed**: FR-004, FR-014, US-003, US-010

**Dependencies**: Phase 1

**Contract Mapping**:
- `contracts/monitor.md` → `SystemMonitor.sample()` → `src/server/monitor.ts`
- `contracts/monitor.md` → `SystemMonitor.isThrottled()` → `src/server/monitor.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | System resource sampling |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-007 | Unit | `src/server/monitor.test.ts` | `sample()` returns correct resource usage metrics |

#### Done When
- `gwrk server start && gwrk status --json | jq -e '.system.cpuPercent'` exits 0

---

### Phase 3: Git & Context Management

Implement Git branch lifecycle management for phases and the context compiler that prepares the agent's work environment.

**Files (2):**
- `src/server/git-manager.ts` (NEW: Implementation of `createPhaseBranch`, `mergePhaseBack`)
- `src/server/context.ts` (NEW: Implementation of `compileContext`, `writeContextToSandbox`)

**Requirements Addressed**: FR-007, FR-010, FR-013, US-006, US-009

**Dependencies**: Phase 1

**Contract Mapping**:
- `contracts/git-manager.md` → `createPhaseBranch` → `src/server/git-manager.ts`
- `contracts/git-manager.md` → `mergePhaseBack` → `src/server/git-manager.ts`
- `contracts/context.md` → `compileContext` → `src/server/context.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | Git operations and branch management |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-005 | Unit | `src/server/git-manager.test.ts` | `createPhaseBranch` creates branch from feature-wip |
| TR-006 | Unit | `src/server/context.test.ts` | `compileContext` includes all required markdown sections |

#### Done When
- `vitest src/server/git-manager.test.ts src/server/context.test.ts` exits 0

---

### Phase 4: Docker Sandbox Lifecycle

Implement the `SandboxManager` to handle Docker container creation, destruction, labeling, and automated cleanup (reaper). Provide the `Dockerfile.sandbox` for the agent execution environment.

**Files (2):**
- `src/server/sandbox.ts` (NEW: Implementation of `createSandbox`, `destroySandbox`, `destroyAllSandboxes`, `reapStale`)
- `Dockerfile.sandbox` (NEW: Bookworm-slim image with Node, Git, gh)

**Requirements Addressed**: FR-006, FR-012, FR-019, FR-022, FR-023, FR-025, FR-026, US-008, TC-006, TC-008, GAP-002-A

**Dependencies**: Phase 1

**Contract Mapping**:
- `contracts/sandbox.md` → `createSandbox` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `destroySandbox` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `destroyAllSandboxes` → `src/server/sandbox.ts`
- `contracts/sandbox.md` → `reapStale` → `src/server/sandbox.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | Docker operations and image management |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-004 | Integration | `src/server/sandbox.test.ts` | `createSandbox` starts container with correct labels |
| TR-009 | Shell | `Dockerfile.sandbox` | Image builds and contains node, git, gh |

#### Done When
- `docker images | grep gwrk-sandbox` exits 0

---

### Phase 5: Dispatch Queue & API

Implement the FIFO dispatch queue with retry/escalation logic and expose the `/api/dispatch` endpoints. Persist dispatch events directly to the shared SQLite ledger.

**Files (2):**
- `src/server/dispatch.ts` (NEW: Implementation of `DispatchQueue` class)
- `src/server/routes/dispatch.ts` (NEW: POST/GET dispatch routes)

**Requirements Addressed**: FR-005, FR-008, FR-009, US-004, US-005, DM-001, DM-002, TC-001

**Dependencies**: Phase 2, Phase 3, Phase 4, 001-cli-core (SQLite utility)

**Contract Mapping**:
- `contracts/dispatch.md` → `DispatchQueue.enqueue` → `src/server/dispatch.ts`
- `contracts/dispatch.md` → `DispatchQueue.processNext` → `src/server/dispatch.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | API design and persistence |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-003 | Unit | `src/server/dispatch.test.ts` | `enqueue` adds to FIFO queue and records in SQLite |
| TR-008 | Integration | `src/server/dispatch.integration.test.ts` | POST /api/dispatch triggers sandbox creation |

#### Done When
- `curl -X POST http://localhost:18790/api/dispatch -d '{"featureId":"001-cli-core","phaseId":"phase-01","backend":"gemini"}'` returns 200

---

### Phase 6: Resilience & Connectivity

Implement macOS sleep/wake detection, network connectivity monitoring, and the rich health check endpoint.

**Files (3):**
- `src/server/lifecycle.ts` (NEW: Heartbeat drift detection, sleep/wake events)
- `src/server/network.ts` (NEW: Connectivity monitoring via `os.networkInterfaces()`)
- `src/server/routes/health.ts` (NEW: Rich `/health` endpoint with component status)

**Requirements Addressed**: FR-015, FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, US-011, US-012, US-013

**Dependencies**: Phase 1, Phase 5

**Contract Mapping**:
- `contracts/server.md` → `/health` → `src/server/routes/health.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| .agents/rules/workspace.md | Lifecycle and event management |
| compile-gate | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-010 | Unit | `src/server/lifecycle.test.ts` | Heartbeat drift > 3x interval triggers `server:sleep` |
| TR-011 | Unit | `src/server/network.test.ts` | `network:down` pauses the dispatch queue |
| TR-012 | Unit | `src/server/routes/health.test.ts` | `/health` returns status for server, docker, network |

#### Done When
- `curl -s http://localhost:18790/health | jq -e '.components.docker'` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `SystemStatus` | `src/server/types.ts` | `monitor.ts`, `routes/status.ts`, `commands/status.ts` |
| `SandboxInfo` | `src/server/types.ts` | `sandbox.ts`, `routes/status.ts` |
| `AgentBackend` | `src/server/types.ts` | `dispatch.ts`, `sandbox.ts`, `config.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| TC-009 | Sleep Detection (Native) | Out of scope for initial implementation (using heartbeat drift). | Future |
| TC-010 | Network Detection (Native) | Out of scope for initial implementation (using polling). | Future |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 1 | Planned |
| US-003 | 2 | Planned |
| US-004 | 5 | Planned |
| US-005 | 5 | Planned |
| US-006 | 3 | Planned |
| US-007 | 1 | Planned |
| US-008 | 4 | Planned |
| US-009 | 3 | Planned |
| US-010 | 2 | Planned |
| US-011 | 6 | Planned |
| US-012 | 6 | Planned |
| US-013 | 6 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 1 | Planned |
| FR-004 | 2 | Planned |
| FR-005 | 5 | Planned |
| FR-006 | 4 | Planned |
| FR-007 | 3 | Planned |
| FR-008 | 5 | Planned |
| FR-009 | 5 | Planned |
| FR-010 | 3 | Planned |
| FR-011 | 1 | Planned |
| FR-012 | 4 | Planned |
| FR-013 | 3 | Planned |
| FR-014 | 2 | Planned |
| FR-015 | 6 | Planned |
| FR-016 | 6 | Planned |
| FR-017 | 6 | Planned |
| FR-018 | 6 | Planned |
| FR-019 | 4, 6 | Planned |
| FR-020 | 6 | Planned |
| FR-021 | 6 | Planned |
| FR-022 | 4 | Planned |
| FR-023 | 4 | Planned |
| FR-024 | 1 | Planned |
| FR-025 | 4 | Planned |
| FR-026 | 4 | Planned |
| DM-001 | 5 | Planned |
| DM-002 | 1 | Planned |
| DM-003 | 1, 2 | Planned |
| TC-001 | 5 | Planned |
| TC-002 | - | N/A (CLI Mandate) |
| TC-003 | 1 | Planned |
| TC-004 | 1 | Planned |
| TC-005 | 1 | Planned |
| TC-006 | 4 | Planned |
| TC-007 | 1 | Planned |
| TC-008 | 4 | Planned |
| TC-009 | 6 | Planned |
| TC-010 | 6 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 1 | Planned |
| TR-003 | 5 | Planned |
| TR-004 | 4 | Planned |
| TR-005 | 3 | Planned |
| TR-006 | 3 | Planned |
| TR-007 | 2 | Planned |
| TR-008 | 5 | Planned |
| TR-009 | 4 | Planned |
| TR-010 | 6 | Planned |
| TR-011 | 6 | Planned |
| TR-012 | 6 | Planned |
| SC-001 | 1 | Planned |
| SC-002 | 1 | Planned |
| SC-003 | 4, 5 | Planned |
| SC-004 | 5 | Planned |
| SC-005 | 6 | Planned |
| SC-006 | 6 | Planned |
| VR-001 | 5 | Planned |
| VR-002 | 2, 5 | Planned |
| VR-003 | 5 | Planned |
| VR-004 | 6 | Planned |
