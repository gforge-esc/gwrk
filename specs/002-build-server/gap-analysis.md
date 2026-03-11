---
type: gap_analysis
feature: 002-build-server
last_modified: "2026-03-05T21:36:07Z"
---

# Gap Analysis: 002 Build Server

**Feature**: 002-build-server
**Date**: 2026-03-05

## Audit Summary

The Build Server feature is currently in a `greenfield` state. While the specification (`spec.md`), implementation plan (`plan.md`), and method contracts (`contracts/*.md`) are well-defined, no implementation code exists in the `src/` directory. A draft `tasks.json` and some "weak" verification gates exist, but they need to be refined to match the strictness required by the workspace governance.

## File-by-File Status

| Phase | File | Status | Notes |
|---|---|---|---|
| 1 | `src/server/index.ts` | `greenfield` | Fastify bootstrap, route registration, and lifecycle management missing. |
| 1 | `src/server/pid.ts` | `greenfield` | PID file management (read/write/check) missing. |
| 1 | `src/commands/server.ts` | `greenfield` | `gwrk server start/stop` CLI commands missing. |
| 1 | `src/cli.ts` | `missing` | Needs registration of the `server` command group. |
| 1 | `src/utils/config.ts` | `missing` | `GwrkConfigSchema` needs extension for `server` and `parallelism`. |
| 1 | `package.json` | `missing` | `fastify` dependency missing. |
| 1 | `tsconfig.json` | `missing` | Needs verification for ESM compatibility with Fastify. |
| 2 | `src/server/monitor.ts` | `greenfield` | `SystemMonitor` class for resource sampling missing. |
| 2 | `src/server/routes/status.ts` | `greenfield` | `GET /api/status` route implementation missing. |
| 2 | `src/commands/status.ts` | `greenfield` | `gwrk status` CLI command missing. |
| 3 | `src/server/git-manager.ts` | `greenfield` | Git branch lifecycle (create/merge/conflict) missing. |
| 3 | `src/server/context.ts` | `greenfield` | Agent context compiler and sandbox injector missing. |
| 3 | `src/server/types.ts` | `greenfield` | Shared domain types (DispatchRecord, etc.) missing. |
| 4 | `src/server/sandbox.ts` | `greenfield` | Docker container lifecycle manager via `dockerode` missing. |
| 4 | `Dockerfile.sandbox` | `greenfield` | Sandbox image definition missing. |
| 5 | `src/server/dispatch.ts` | `greenfield` | `DispatchQueue` engine with retry/escalation missing. |
| 5 | `src/server/routes/dispatch.ts` | `greenfield` | Dispatch API routes (POST/GET) missing. |
| 5 | `src/server/persistence.ts` | `greenfield` | Append-only `dispatches.jsonl` writer missing. |

## Contract Verification

| Contract | Method | Implemented? | Notes |
|---|---|---|---|
| `server.md` | `startServer(config)` | No | Source: `src/server/index.ts` |
| `server.md` | `stopServer(instance)` | No | Source: `src/server/index.ts` |
| `server.md` | `writePid(pidPath)` | No | Source: `src/server/pid.ts` |
| `server.md` | `readPid(pidPath)` | No | Source: `src/server/pid.ts` |
| `monitor.md` | `SystemMonitor.sample()` | No | Source: `src/server/monitor.ts` |
| `monitor.md` | `SystemMonitor.isThrottled()` | No | Source: `src/server/monitor.ts` |
| `git-manager.md` | `createPhaseBranch(f, p)` | No | Source: `src/server/git-manager.ts` |
| `git-manager.md` | `mergePhaseBack(f, p)` | No | Source: `src/server/git-manager.ts` |
| `context.md` | `compileContext(dir, id)` | No | Source: `src/server/context.ts` |
| `sandbox.md` | `createSandbox(opts)` | No | Source: `src/server/sandbox.ts` |
| `dispatch.md` | `Queue.enqueue(request)` | No | Source: `src/server/dispatch.ts` |
| `dispatch.md` | `Queue.processNext()` | No | Source: `src/server/dispatch.ts` |

## Findings & Recommendations

1.  **Strict Gate Generation**: Existing gates in `gates/` are "weak" (only file/grep checks). They must be regenerated to assert exact type signatures and contract adherence (e.g., using `grep` for full function signatures).
2.  **Dependencies**: `package.json` update must be the first task in Phase 1 to unblock server development.
3.  **Config First**: Extending `src/utils/config.ts` is a high-priority task as multiple components depend on the new schema.
4.  **PID Management**: The PID manager should ensure `.gwrk/` exists, which is a common point of failure.
5.  **Integration Testing**: Phase 5 requires a running Docker daemon. Verification gates for Phase 4/5 should check for Docker availability.

---

## GAP-002-A: Container Lifecycle Management (2026-03-11)

> **Discovered during**: 003-slack integration testing
> **Severity**: Architectural debt — resource leak
> **Evidence**: 13 zombie Docker containers (`gwrk.feature=feat-1`, `gwrk.feature=feat-int`) found running/created from integration tests spanning 32+ hours, consuming resources with no expiry or cleanup mechanism.

### Root Cause

`SandboxManager` has `createSandbox()` and `destroySandbox()` but nothing enforces lifecycle:

| Gap | Detail |
|---|---|
| **No container TTL** | `gwrk.startedAt` label is written but never read. No reaper checks age. |
| **No test cleanup** | Integration tests call `createSandbox()` with no `afterEach`/`afterAll` teardown. Every test run leaks containers. |
| **No shutdown cleanup** | `startServer.shutdown()` stops Slack, monitors, and Fastify but never calls `sandbox.destroyAll()` or equivalent. |
| **No manual cleanup command** | No `gwrk server clean` or `gwrk doctor` to audit and reclaim leaked resources. |
| **No max container limit** | `createSandbox()` never checks how many gwrk containers already exist. Unbounded growth. |

### Required Changes

1. **`SandboxManager.reapStale(maxAgeMs)`** — Destroy containers older than TTL based on `gwrk.startedAt` label.
2. **`SandboxManager.destroyAll()`** — Remove all gwrk-labeled containers. Called on server shutdown.
3. **Reaper interval in server** — `setInterval(() => sandbox.reapStale(TTL), 60_000)` inside `startServer()`.
4. **Shutdown hook** — Add `await sandbox.destroyAll()` to `startServer.shutdown()`.
5. **Test cleanup** — `afterAll(() => sandbox.destroyAll())` in all integration test suites that create containers.
6. **`gwrk server clean` command** — Repeatable CLI command wrapping `destroyAll()` with count reporting.
7. **Max concurrency guard** — `createSandbox()` checks active count against `config.server.parallelism.maxConcurrentSandboxes` before spawning.

## Conclusion

The project is ready for task decomposition. The existing `tasks.json` structure is a good baseline but will be refined to ensure "Halving Rule" compliance and "Zero Interpretation" task descriptions.
