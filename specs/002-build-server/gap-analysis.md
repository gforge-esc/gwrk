# Gap Analysis: 002 Build Server

**Feature**: 002-build-server
**Date**: 2026-02-27
**Status**: Audited

---

## Summary

All build server functionality is **greenfield** — the daemon, sandbox manager, dispatch queue, Git manager, and monitoring subsystems do not exist yet. Four files from 001-cli-core require modification to integrate the build server.

---

## Phase 1: Daemon Bootstrap

| File | Status | Gap | Detail |
|---|---|---|---|
| `src/server/index.ts` | greenfield | Full implementation | Fastify bootstrap, `/health`, graceful shutdown. Contract: `startServer()`, `stopServer()` |
| `src/server/pid.ts` | greenfield | Full implementation | PID file read/write/check/remove. Contract: `writePid()`, `readPid()`, `removePid()` |
| `src/commands/server.ts` | greenfield | Full implementation | `gwrk server start` and `gwrk server stop` subcommands via Commander |
| `src/cli.ts` | EXISTS | missing | Server command not registered. Need `program.addCommand(serverCommand)` and import |
| `src/utils/config.ts` | EXISTS | missing | `GwrkConfigSchema` lacks `server.port`, `server.host` fields. Need to extend Zod schema |
| `package.json` | EXISTS | missing | No `fastify` dependency. Need to add `fastify` |
| `tsconfig.json` | EXISTS | — | ESM output already configured. No changes needed |

---

## Phase 2: System Monitor & Status

| File | Status | Gap | Detail |
|---|---|---|---|
| `src/server/monitor.ts` | greenfield | Full implementation | `SystemMonitor` class: `sample()`, `isThrottled()`, `startPolling()`, `stopPolling()`, `getStatus()` |
| `src/server/routes/status.ts` | greenfield | Full implementation | `GET /api/status` route |
| `src/commands/status.ts` | greenfield | Full implementation | `gwrk status` command — HTTP GET to daemon or offline fallback |
| `src/cli.ts` | EXISTS | missing | Status command not registered |
| `src/utils/config.ts` | EXISTS | missing | `parallelism.local.*` and `parallelism.cloud.*` fields missing from schema |

---

## Phase 3: Git Manager & Context Compiler

| File | Status | Gap | Detail |
|---|---|---|---|
| `src/server/git-manager.ts` | greenfield | Full implementation | `createPhaseBranch()`, `mergePhaseBack()`, `isClean()`, `hasConflicts()` |
| `src/server/context.ts` | greenfield | Full implementation | `compileContext()`, `writeContextToSandbox()` |
| `src/server/types.ts` | greenfield | Full implementation | `DispatchRecord`, `DispatchAttempt`, `DispatchStatus`, `SystemStatus`, `SandboxInfo` |

---

## Phase 4: Docker Sandbox Manager

| File | Status | Gap | Detail |
|---|---|---|---|
| `src/server/sandbox.ts` | greenfield | Full implementation | `createSandbox()`, `destroySandbox()`, `destroyAllSandboxes()`, `listSandboxes()` |
| `Dockerfile.sandbox` | greenfield | Full implementation | `gwrk-sandbox:bookworm-slim` with node/git/gh |
| `package.json` | EXISTS | missing | No `dockerode` or `@types/dockerode` dependency |

---

## Phase 5: Dispatch Queue & Orchestrator

| File | Status | Gap | Detail |
|---|---|---|---|
| `src/server/dispatch.ts` | greenfield | Full implementation | `DispatchQueue` class: `enqueue()`, `processNext()`, `handleCompletion()`, `getQueue()`, `getDispatch()` |
| `src/server/routes/dispatch.ts` | greenfield | Full implementation | `POST /api/dispatch`, `GET /api/dispatch/:feature/:phase`, `GET /api/dispatch/queue` |
| `src/server/persistence.ts` | greenfield | Full implementation | JSONL append-only writer for `dispatches.jsonl` |
| `src/server/index.ts` | EXISTS (Phase 1) | missing | Dispatch routes not registered; Monitor → Queue throttle not wired |

---

## Classification Summary

| Classification | Count | Files |
|---|---|---|
| **greenfield** | 15 | All `src/server/*` files, `Dockerfile.sandbox`, test files |
| **missing** | 4 | `src/cli.ts` (commands), `src/utils/config.ts` (schema), `package.json` (deps), `src/server/index.ts` (route wiring) |
| **wrong** | 0 | — |

**No conflicts detected.** All gaps are additive — no existing behavior needs to be changed, only extended.
