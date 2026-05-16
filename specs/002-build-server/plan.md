# Implementation Plan: 002 Build Server

**Branch**: `develop` | **Date**: 2026-05-16 | **Spec**: [spec.md](./spec.md)

## Summary

This plan defines the implementation of the `gwrk` local Fastify daemon that serves as the observability and notification layer. The build server manages daemon lifecycle (including macOS LaunchAgent persistence), records agent dispatches to an SQLite execution ledger, bridges ShipOrchestrator events to actionable Slack messages, and handles sleep/wake resilience and network awareness. Note: The legacy Docker sandbox concepts from v2 have been removed per the v4 spec.

---

## Phases and File Structure

### Phase 1: Daemon Lifecycle & Service Management

Implement the core Fastify daemon, start/stop commands, and macOS LaunchAgent service management.

**Files (8):**
- `src/commands/server.ts` (Modify: Implement `start` and `stop` actions with `[exit:N | Xs]`)
- `src/commands/server-install.ts` (New: Implement `install`, `uninstall`, and `logs` actions)
- `src/server/index.ts` (New: Fastify bootstrap and graceful shutdown)
- `src/server/pid.ts` (New: PID resolution prioritizing `launchctl` over `.gwrk/server.pid`)
- `src/server/routes/health.ts` (New: `/health` endpoint returning component status)
- `src/commands/server.test.ts` (New: Unit tests for daemon start/stop and PID logic)
- `src/commands/server-install.test.ts` (New: Unit tests for macOS LaunchAgent plist management)
- `src/server/routes/health.test.ts` (New: Unit tests for health route)

**Requirements Addressed:** US-001, US-008, FR-001, FR-002, FR-003, FR-012, FR-013, FR-014, FR-015, TC-001, TC-002

**Dependencies:** None

**Contract Mapping:**
- `contracts/health.md` → `GET /health` → `src/server/routes/health.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-004-agent-native-output.md` | All CLI commands must wrap output with `[exit:N \| Xs]` and support `--format json` / `--agent`. |
| `compile-gate` | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-001 | Unit | `src/commands/server.test.ts` | `expect(startServer).toHaveBeenCalled()` |
| TR-003 | Unit | `src/server/routes/health.test.ts` | `expect(res.json().status).toBe('ok')` |
| TR-008 | Unit | `src/commands/server-install.test.ts` | `expect(plist).toContain('KeepAlive')` |

#### Done When
- `pnpm vitest run src/commands/server.test.ts` exits 0
- `pnpm vitest run src/server/routes/health.test.ts` exits 0

---

### Phase 2: Resilience & System Status

Implement sleep/wake detection via JS heartbeat drift, network awareness, and the `/api/status` endpoint.

**Files (6):**
- `src/server/lifecycle.ts` (New: Heartbeat drift monitor for sleep/wake detection)
- `src/server/network.ts` (New: `os.networkInterfaces()` polling and status caching)
- `src/server/routes/status.ts` (New: `/api/status` endpoint for server state, resources, and network)
- `src/server/lifecycle.test.ts` (New: Mock JS timers to test heartbeat drift)
- `src/server/network.test.ts` (New: Mock `os.networkInterfaces`)
- `src/server/routes/status.test.ts` (New: Verify returned JSON shape)

**Requirements Addressed:** US-002, US-005, US-006, FR-004, FR-008, FR-009, FR-010, TC-004, TC-005, TC-006

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/status.md` → `GET /api/status` → `src/server/routes/status.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-004-agent-native-output.md` | Status command output formatting. |
| `compile-gate` | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-002 | Unit | `src/server/routes/status.test.ts` | `expect(res.json().server.status).toBeDefined()` |
| TR-004 | Unit | `src/server/lifecycle.test.ts` | `expect(lifecycle.state).toBe('sleeping')` |
| TR-005 | Unit | `src/server/network.test.ts` | `expect(network.status).toBe('online')` |

#### Done When
- `pnpm vitest run src/server/lifecycle.test.ts` exits 0
- `pnpm vitest run src/server/routes/status.test.ts` exits 0

---

### Phase 3: Slack Event Bridge & Bless Actions

Implement the Slack Socket Mode connection to convert ShipOrchestrator events into actionable messages, and handle button/emoji responses to drive the pipeline.

**Files (4):**
- `src/server/slack-notify.ts` (New: Event listener mapped to Foxtrot Charlie message blocks)
- `src/server/slack-actions.ts` (New: Block Kit interactive handlers for Merge, Retry, Escalate)
- `src/server/slack-notify.test.ts` (New: Test event-to-message mapping)
- `src/server/slack-actions.test.ts` (New: Test button tap -> CLI command dispatch)

**Requirements Addressed:** US-003, US-004, FR-005, FR-006, FR-007

**Dependencies:** Phase 1

**Contract Mapping:**
- `contracts/slack-events.md` → `handleEvent` → `src/server/slack-notify.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-004-agent-native-output.md` | Agent-safe CLI invocation from Slack buttons. |
| `compile-gate` | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| TR-006 | Unit | `src/server/slack-notify.test.ts` | `expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({ blocks }))` |
| TR-007 | Unit | `src/server/slack-actions.test.ts` | `expect(exec).toHaveBeenCalledWith('gh pr merge')` |

#### Done When
- `pnpm vitest run src/server/slack-notify.test.ts` exits 0
- `pnpm vitest run src/server/slack-actions.test.ts` exits 0

---

### Phase 4: Execution Ledger

Record all agent dispatches in the SQLite `runs` table to enable querying historical performance.

**Files (2):**
- `src/db/migrations/0001_runs.sql` (New: Table schema for `runs`)
- `src/db/index.ts` (Modify: Add query and insert wrappers for `runs`)

**Requirements Addressed:** US-007, FR-011, TC-001

**Dependencies:** None

**Contract Mapping:**
- `contracts/ledger.md` → `insertRun` → `src/db/index.ts`

#### Governance & Skills Contract
| Rule / Skill | Applicability |
|---|---|
| `docs/decisions/ADR-002-sqlite-execution-ledger.md` | Schema design and SQLite integration requirements. |
| `compile-gate` | Always |

#### Test Strategy
| TR-### | Test type | Target | Assertion |
|---|---|---|---|
| None | Unit | `src/db/index.test.ts` | `expect(db.query).resolves.toBeDefined()` |

#### Done When
- `sqlite3 ~/.gwrk/gwrk.db "SELECT count(*) FROM runs" > /dev/null` exits 0

---

## Type Dependency Graph

| Shared Type | Defined In | Consumed By |
|---|---|---|
| `ServerStatus` | `src/server/routes/status.ts` | `src/commands/server.ts` |
| `SystemResources` | `src/server/routes/status.ts` | `src/commands/server.ts` |
| `RunRecord` | `src/db/index.ts` | `src/server/dispatch.ts` |

---

## Mockup-to-Selector Mapping

_No mockups exist for this feature._

---

## Deferred Items

| Spec Item | Title | Reason | Target |
|---|---|---|---|
| Legacy Contracts | AMBER: Outdated Contract Schemas | Existing v2 schemas in `contracts/` (e.g. `sandbox.md`, `monitor.md`) are incompatible with v4 spec cuts. This plan targets v4 requirements directly. | N/A |
| TC-003 | No in-process agent execution | Managed by ShipOrchestrator, outside Server scope | `004-ship-loop` |

---

## Coverage Matrix

| Spec Item | Phase | Status |
|---|---|---|
| US-001 | 1 | Planned |
| US-002 | 2 | Planned |
| US-003 | 3 | Planned |
| US-004 | 3 | Planned |
| US-005 | 2 | Planned |
| US-006 | 2 | Planned |
| US-007 | 4 | Planned |
| US-008 | 1 | Planned |
| FR-001 | 1 | Planned |
| FR-002 | 1 | Planned |
| FR-003 | 1 | Planned |
| FR-004 | 2 | Planned |
| FR-005 | 3 | Planned |
| FR-006 | 3 | Planned |
| FR-007 | 3 | Planned |
| FR-008 | 2 | Planned |
| FR-009 | 2 | Planned |
| FR-010 | 2 | Planned |
| FR-011 | 4 | Planned |
| FR-012 | 1 | Planned |
| FR-013 | 1 | Planned |
| FR-014 | 1 | Planned |
| FR-015 | 1 | Planned |
| TC-001 | 1, 4 | Planned |
| TC-002 | 1 | Planned |
| TC-003 | Deferred | Out of scope for daemon |
| TC-004 | 2 | Planned |
| TC-005 | 2 | Planned |
| TC-006 | 2 | Planned |
| TR-001 | 1 | Planned |
| TR-002 | 2 | Planned |
| TR-003 | 1 | Planned |
| TR-004 | 2 | Planned |
| TR-005 | 2 | Planned |
| TR-006 | 3 | Planned |
| TR-007 | 3 | Planned |
| TR-008 | 1 | Planned |
