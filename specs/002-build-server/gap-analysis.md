---
type: gap_analysis
feature: 002-build-server
last_modified: "2026-03-12T23:45:00Z"
---

# Gap Analysis: 002 Build Server (Test Coverage Audit)

**Date**: 2026-03-12
**Status**: ⚠️ Partial Coverage Gaps Identified

---

## Functional Requirements Coverage

| FR-### | Requirement | Status | Test File | Gap / Notes |
|---|---|---|---|---|
| FR-001 | `server start` | ✅ tested | `src/commands/server.test.ts` | Covers daemonization, PID file creation, and port binding. |
| FR-002 | Daemon REST endpoints | ✅ tested | `src/server/index.test.ts` | Verified Fastify bootstrap and basic routing. |
| FR-003 | `server stop` | ✅ tested | `src/commands/server.test.ts` | Covers SIGTERM handling and PID removal. |
| FR-004 | `gwrk status` | ✅ tested | `src/server/routes/status.test.ts` | Comprehensive validation of the SystemStatus response. |
| FR-005 | `POST /api/dispatch` | ✅ tested | `src/server/dispatch.test.ts` | Covers request enqueuing and initial status. |
| FR-006 | Sandbox lifecycle | ✅ tested | `src/server/sandbox.test.ts` | Covers container create, start, stop, and destroy. |
| FR-007 | Context compilation | ✅ tested | `src/server/context.test.ts` | Verified correct aggregation of rules, personas, specs, and plans. |
| FR-008 | Dispatch queue | ✅ tested | `src/server/dispatch.test.ts` | Verified FIFO ordering and parallelism limits. |
| FR-009 | Retry & Escalation | ✅ tested | `src/server/dispatch.test.ts` | Verified 3x retry logic and fallback backend assignment. |
| FR-010 | Git branch lifecycle | ✅ tested | `src/server/git-manager.test.ts`| Verified branch creation from WIP and merge conflict detection. |
| FR-011 | PID file discipline | ✅ tested | `src/server/index.test.ts` | Verified `writePid` and `removePid` during lifecycle. |
| FR-012 | `Dockerfile.sandbox` | ⚠️ weak | — | **Major Gap**: No automated test (e.g., `src/server/sandbox.e2e.test.ts`) verifies that the built image contains `node`, `git`, and `gh`. |
| FR-013 | Context file reads | ✅ tested | `src/server/context.test.ts` | Verified that all required spec/plan files are read from the filesystem. |
| FR-014 | Resource monitoring | ✅ tested | `src/server/monitor.test.ts` | Covers CPU, Memory, and Disk throttling logic. |
| FR-015 | Sleep/Wake detection | ✅ tested | `src/server/lifecycle.test.ts` | Verified wall-clock heartbeat drift detection. |
| FR-016 | Wake reconnect | ⚠️ weak | `src/server/lifecycle.test.ts` | **Assertion missing**: Test only verifies the event emission. No test confirms that `SandboxManager.unpauseAll()` is actually triggered on wake. |
| FR-017 | Network monitoring | ✅ tested | `src/server/network.test.ts` | Verified `isOnline()` polling and event emission. |
| FR-018 | Network pause | ⚠️ weak | `src/server/network.test.ts` | **Assertion missing**: Test only verifies the event emission. No test confirms that `DispatchQueue.pause()` is called when network goes down. |
| FR-019 | Sandbox pause | ⚠️ weak | — | **Major Gap**: No test (unit or integration) verifies that `docker pause` is actually called on gwrk containers during sleep. |
| FR-020 | Health response | ✅ tested | `src/server/routes/health.test.ts`| Verified component-level status (Ok/Degraded). |
| FR-021 | Lifecycle status | ✅ tested | `src/server/lifecycle.test.ts` | Covers all lifecycle states: starting, ready, sleeping, degraded. |
| FR-024 | `server clean` | ❌ missing | — | **Major Gap**: Command and implementation are missing from the codebase. |

---

## Action Plan: Testing Gaps

### 1. Implement `src/server/lifecycle.integration.test.ts` (FR-016, FR-018, FR-019)
- **Target**: Server-level event handlers.
- **Assertions**:
  - `server:sleep` → `DispatchQueue.pause()` + `SandboxManager.pauseAll()`.
  - `server:wake` → `Graceful Reconnect Protocol` runs.
  - `network:down` → `DispatchQueue.pause()`.

### 2. Implement Sandbox E2E Verification (FR-012)
- **Target**: `Dockerfile.sandbox`.
- **Assertions**:
  - Build `gwrk-sandbox:latest`.
  - Run container and assert `node --version`, `git --version`, `gh --version`.

### 3. Implement `gwrk server clean` (FR-024)
- **Target**: Command implementation and test coverage.
- **Assertions**:
  - Destroy all containers labeled `gwrk.feature=*`.
  - Count destroyed containers and report to CLI.
