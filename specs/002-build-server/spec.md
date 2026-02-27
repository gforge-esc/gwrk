# Feature Specification: 002 Build Server

**Feature Branch**: `002-build-server`
**Created**: 2026-02-27
**Status**: Draft
**Input**: Local persistent Fastify daemon that serves as the control plane — dispatch queue, Docker sandbox manager, Git branch lifecycle, system resource monitoring, and `gwrk server start/stop/status` commands.

---

## 2. User Scenarios & Testing

### US-001 - Start Build Server (Priority: P0)
As a Principal Engineer, I want to run `gwrk server start` so that a persistent Fastify daemon starts on `localhost:18790` and is ready to accept dispatch requests and manage Docker sandboxes.

**Implements**: FR-001, FR-002

**Independent Test**: Run `gwrk server start` and verify the daemon responds to HTTP.

**Acceptance Scenarios**:
1. **Given** no daemon is running, **When** the user runs `gwrk server start`, **Then**:
   - `curl -s -o /dev/null -w '%{http_code}' http://localhost:18790/health` exits 0 and outputs `200`
   - `gwrk server start 2>&1 | grep -q 'gwrk server listening on'` exits 0
2. **Given** the daemon is already running, **When** the user runs `gwrk server start`, **Then**:
   - Command exits with code 1
   - `gwrk server start 2>&1 | grep -q 'Server already running'` exits 0

### US-002 - Stop Build Server (Priority: P0)
As a Principal Engineer, I want to run `gwrk server stop` so that the daemon shuts down gracefully, terminating any active sandboxes and releasing the port.

**Implements**: FR-003

**Independent Test**: Start the server, then stop it, verify the port is released.

**Acceptance Scenarios**:
1. **Given** the daemon is running, **When** the user runs `gwrk server stop`, **Then**:
   - Command exits with code 0
   - `curl -s http://localhost:18790/health 2>&1 | grep -qE 'Connection refused|Failed to connect'` exits 0
2. **Given** no daemon is running, **When** the user runs `gwrk server stop`, **Then**:
   - Command exits with code 1
   - `gwrk server stop 2>&1 | grep -q 'No server running'` exits 0

### US-003 - System Status (Priority: P0)
As a Principal Engineer, I want to run `gwrk status` so that I see active agents, active sandboxes, dispatch queue depth, and system resource usage (CPU, memory, disk).

**Implements**: FR-004

**Independent Test**: Start the server, run `gwrk status`, verify JSON output includes resource metrics.

**Acceptance Scenarios**:
1. **Given** the daemon is running, **When** the user runs `gwrk status --json`, **Then**:
   - `gwrk status --json | jq -r '.server.status'` outputs `running`
   - `gwrk status --json | jq -e '.system.cpuPercent'` exits 0
   - `gwrk status --json | jq -e '.system.memPercent'` exits 0
   - `gwrk status --json | jq -e '.system.diskFreeGb'` exits 0
   - `gwrk status --json | jq -e '.dispatch.queueDepth'` exits 0
   - `gwrk status --json | jq -e '.sandboxes'` exits 0
2. **Given** no daemon is running, **When** the user runs `gwrk status`, **Then**:
   - `gwrk status --json | jq -r '.server.status'` outputs `stopped`

### US-004 - Dispatch Phase to Sandbox (Priority: P0)
As Agent-ZFG, I want the build server to accept a phase dispatch request so that a Docker sandbox is created, the phase branch is mounted, the agent context is injected, and the WUD loop executes inside the container.

**Implements**: FR-005, FR-006, FR-007

**Independent Test**: POST a dispatch request and verify a Docker container is created with the correct branch mounted.

**Acceptance Scenarios**:
1. **Given** the daemon is running and Docker is available, **When** a dispatch request is sent via `curl -X POST http://localhost:18790/api/dispatch -H 'Content-Type: application/json' -d '{"featureId":"001-cli-core","phaseId":"phase-01","backend":"gemini"}'`, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/001-cli-core/phase-01 | jq -r '.status'` outputs one of `queued`, `running`, `completed`, `failed`
   - `docker ps --filter label=gwrk.feature=001-cli-core --filter label=gwrk.phase=phase-01 --format '{{.ID}}' | wc -l | grep -q '^1$'` exits 0 (while running)

### US-005 - Dispatch Queue with Retry (Priority: P0)
As the build server orchestrator, I want a dispatch queue that manages phase assignments, respects system resource limits, and retries failed dispatches up to 3 times with backend escalation.

**Implements**: FR-008, FR-009

**Independent Test**: Submit multiple dispatches exceeding resource limits and verify queuing behavior.

**Acceptance Scenarios**:
1. **Given** the daemon is running with `parallelism.local.maxClones` set to 2, **When** 3 dispatch requests are submitted, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.active | length'` outputs at most `2`
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.queued | length'` outputs at least `1`
2. **Given** a dispatch fails 3 times on the primary backend, **When** `fallbackOrder` is configured, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/001-cli-core/phase-01 | jq -r '.attempts[-1].backend'` differs from `.attempts[0].backend`

### US-006 - Git Branch Lifecycle (Priority: P0)
As Agent-ZFG, I want the build server to manage Git branches for each dispatched phase — creating the phase branch from the feature branch, and supporting merge-back with conflict detection.

**Implements**: FR-010

**Independent Test**: Dispatch a phase and verify the correct branch is created from the feature branch.

**Acceptance Scenarios**:
1. **Given** a feature `001-cli-core` with a feature branch `feature/001-cli-core-wip`, **When** phase-01 is dispatched, **Then**:
   - `git branch --list 'phase/001-cli-core-phase-01' | grep -q 'phase/001-cli-core-phase-01'` exits 0
2. **Given** phase-01 is completed, **When** a merge-back is triggered, **Then**:
   - `git log feature/001-cli-core-wip --oneline -1 | grep -q 'Merge phase/001-cli-core-phase-01'` exits 0

### US-007 - Daemon PID Management (Priority: P0)
As the CLI, I want the daemon to write a PID file on start and remove it on stop, so that `gwrk server start/stop` can detect whether the daemon is already running.

**Implements**: FR-011

**Independent Test**: Start the server, verify PID file exists, stop the server, verify PID file is removed.

**Acceptance Scenarios**:
1. **Given** no daemon is running, **When** `gwrk server start` is executed, **Then**:
   - `test -f .gwrk/server.pid` exits 0
   - `kill -0 $(cat .gwrk/server.pid) 2>/dev/null` exits 0
2. **Given** the daemon is running, **When** `gwrk server stop` is executed, **Then**:
   - `test -f .gwrk/server.pid` exits 1

### US-008 - Sandbox Docker Image (Priority: P1)
As a Platform Engineer, I want the build server to use a standard `gwrk-sandbox:bookworm-slim` Docker image with Node.js, Git, and `gh` pre-installed, so that agent sandboxes have a consistent execution environment.

**Implements**: FR-012

**Independent Test**: Build the sandbox image and verify required tools are available inside the container.

**Acceptance Scenarios**:
1. **Given** the sandbox Dockerfile exists, **When** `docker build -t gwrk-sandbox:bookworm-slim -f Dockerfile.sandbox .` runs, **Then**:
   - `docker run --rm gwrk-sandbox:bookworm-slim node --version` exits 0
   - `docker run --rm gwrk-sandbox:bookworm-slim git --version` exits 0
   - `docker run --rm gwrk-sandbox:bookworm-slim gh --version` exits 0

### US-009 - Context Compilation (Priority: P0)
As the dispatch engine, I want the build server to compile agent context from `.agent/rules/`, persona files, spec, plan, and tasks into a single context payload injected into the sandbox at `/workspace/.gwrk/phase-context.md`.

**Implements**: FR-013

**Independent Test**: Dispatch a phase and verify the context file exists and contains expected sections.

**Acceptance Scenarios**:
1. **Given** a dispatch for feature `001-cli-core` phase-01, **When** the sandbox is created, **Then**:
   - `docker exec <container_id> test -f /workspace/.gwrk/phase-context.md` exits 0
   - `docker exec <container_id> grep -q 'Governance Rules' /workspace/.gwrk/phase-context.md` exits 0
   - `docker exec <container_id> grep -q 'spec.md' /workspace/.gwrk/phase-context.md` exits 0

### US-010 - Resource Throttling (Priority: P1)
As the build server, I want to monitor CPU, memory, and disk usage and pause queued dispatches when limits are exceeded, so that the developer's machine stays responsive.

**Implements**: FR-014

**Independent Test**: Simulate high CPU usage and verify dispatch queue pauses.

**Acceptance Scenarios**:
1. **Given** `parallelism.local.maxCpu` is set to 80 and current CPU usage exceeds 80%, **When** a new dispatch request arrives, **Then**:
   - `curl -s http://localhost:18790/api/dispatch/queue | jq '.throttled'` outputs `true`
2. **Given** `parallelism.local.minDiskGb` is set to 10 and free disk is below 10 GB, **When** a clone is requested, **Then**:
   - `curl -s http://localhost:18790/api/dispatch -X POST -d '{}' 2>&1 | grep -q 'Insufficient disk space'` exits 0

---

## 3. Roles, Scopes & Permissions

_Leverages shared RBAC. No feature-specific roles. See RP-000._

---

## 4. Functional Requirements

- **FR-001**: System MUST provide a `gwrk server start` command that starts a Fastify daemon on `localhost:18790`, writes a PID file to `.gwrk/server.pid`, and responds to `/health` with HTTP 200. (Implements: US-001)
- **FR-002**: The Fastify daemon MUST bind to `localhost:18790` (port configurable via `server.port` in `.gwrkrc.json`) and expose REST endpoints for dispatch, status, and queue management. (Implements: US-001)
- **FR-003**: System MUST provide a `gwrk server stop` command that sends SIGTERM to the daemon process (via PID file), waits for graceful shutdown (active sandboxes terminated), removes the PID file, and confirms the port is released. (Implements: US-002)
- **FR-004**: System MUST provide a `gwrk status` command that queries the daemon's `/api/status` endpoint and returns server state, active agents, sandbox count, dispatch queue depth, and system resources (CPU%, MEM%, disk free GB). When no daemon is running, it MUST return `{"server":{"status":"stopped"}}`. (Implements: US-003)
- **FR-005**: The daemon MUST expose `POST /api/dispatch` accepting `{featureId, phaseId, backend}` to create a sandbox, mount the phase branch, inject context, and start the agent's WUD loop. (Implements: US-004)
- **FR-006**: The daemon MUST manage Docker container lifecycle for each dispatched phase: create container from `gwrk-sandbox:bookworm-slim`, mount phase branch at `/workspace`, label with `gwrk.feature` and `gwrk.phase`, destroy on completion or failure. (Implements: US-004)
- **FR-007**: The dispatch engine MUST compile agent context into `/workspace/.gwrk/phase-context.md` containing: governance rules (`.agent/rules/*.md`), persona definition, feature spec, plan, current tasks, and phase-specific gate scripts. (Implements: US-009)
- **FR-008**: The daemon MUST implement a dispatch queue that respects `parallelism.local.maxClones` and `parallelism.cloud.maxConcurrent` from `.gwrkrc.json`. Dispatches exceeding limits MUST be queued and processed FIFO as slots become available. (Implements: US-005)
- **FR-009**: The dispatch engine MUST retry failed dispatches up to 3 times on the same backend, then escalate to the next backend in `agents.fallbackOrder`. All retry attempts MUST be recorded with timestamps, backend, exit code, and stderr. (Implements: US-005)
- **FR-010**: The daemon MUST manage Git branch lifecycle: create `phase/<feature>-<phase>` branches from `feature/<feature>-wip`, and support merge-back to the feature branch with conflict detection. On conflict, the merge MUST fail and the dispatch MUST be flagged for human intervention. (Implements: US-006)
- **FR-011**: The daemon MUST write its process ID to `.gwrk/server.pid` on startup and remove the file on clean shutdown. `gwrk server start` MUST check for an existing PID file and verify the process is alive before declaring a conflict. (Implements: US-007)
- **FR-012**: The project MUST include a `Dockerfile.sandbox` that builds `gwrk-sandbox:bookworm-slim` with Node.js (LTS), Git, `gh` CLI, and the configured agent CLIs (gemini, claude, codex) pre-installed. (Implements: US-008)
- **FR-013**: The dispatch engine MUST compile agent context by reading `.agent/rules/*.md`, the persona file for the dispatch target, `specs/<feature>/spec.md`, `specs/<feature>/plan.md`, and `specs/<feature>/.gwrk/tasks.json`, concatenating them into a single Markdown document at `/workspace/.gwrk/phase-context.md`. (Implements: US-009)
- **FR-014**: The daemon MUST monitor system resources (CPU, memory, disk) at a configurable interval (default 10 seconds) and throttle queued dispatches when `parallelism.local.maxCpu`, `parallelism.local.maxMem`, or `parallelism.local.minDiskGb` thresholds are exceeded. (Implements: US-010)

#### FR-001 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Port already in use | `Port 18790 already in use` | 1 |
| Server already running (stale PID) | `Server already running (pid: <PID>)` | 1 |
| Docker not available | `Docker daemon not reachable` | 1 |

#### FR-003 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| No server running | `No server running` | 1 |
| PID file exists but process dead | Clean start allowed (stale PID removed) | 0 |

#### FR-005 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Invalid backend | `Unknown agent backend: <backend>` | 400 |
| Feature not found | `Feature <featureId> not found in specs/` | 404 |
| Docker not available | `Docker daemon not reachable` | 503 |
| Resource limits exceeded | `Dispatch queued: resource limits exceeded` | 202 |

#### FR-010 Error States
| Condition | stderr contains | Exit code |
|---|---|---|
| Feature branch not found | `Branch feature/<feature>-wip not found` | 1 |
| Merge conflict | `Merge conflict in phase/<feature>-<phase>: <files>` | 1 |
| Dirty working tree | `Working tree has uncommitted changes` | 1 |

---

## 5. Data Model Requirements

### DM-001: Dispatch Record

Per-dispatch state recorded in the daemon's in-memory store and persisted to `.gwrk/dispatches.jsonl`:

```typescript
interface DispatchRecord {
  id: string;                    // UUID
  featureId: string;             // e.g. "001-cli-core"
  phaseId: string;               // e.g. "phase-01"
  backend: AgentBackend;         // "gemini" | "claude" | "codex" | "codex-cloud"
  status: DispatchStatus;        // "queued" | "running" | "completed" | "failed" | "retrying"
  containerId?: string;          // Docker container ID
  branchName: string;            // e.g. "phase/001-cli-core-phase-01"
  attempts: DispatchAttempt[];
  createdAt: string;             // ISO 8601
  completedAt?: string;          // ISO 8601
}

interface DispatchAttempt {
  attemptNumber: number;
  backend: AgentBackend;
  startedAt: string;             // ISO 8601
  completedAt?: string;          // ISO 8601
  exitCode?: number;
  stderr?: string;
}

type DispatchStatus = "queued" | "running" | "completed" | "failed" | "retrying";
```

### DM-002: Server Config Extension (`.gwrkrc.json`)

Extends the GwrkConfig defined in 001-cli-core DM-003:

```typescript
interface GwrkServerConfig {
  server: {
    port: number;                // Default: MUST be explicit, no default()
    host: string;                // Default: MUST be explicit, no default()
  };
  parallelism: {
    local: {
      maxClones: number;         // Max concurrent local repo clones
      maxCpu: number;            // CPU % threshold
      maxMem: number;            // Memory % threshold
      minDiskGb: number;         // Minimum free disk in GB
    };
    cloud: {
      maxConcurrent: number;     // Max concurrent cloud dispatches
    };
  };
}
```

### DM-003: System Status

```typescript
interface SystemStatus {
  server: {
    status: "running" | "stopped";
    pid?: number;
    uptime?: number;             // Seconds since start
    port?: number;
  };
  system: {
    cpuPercent: number;
    memPercent: number;
    diskFreeGb: number;
  };
  dispatch: {
    queueDepth: number;
    activeCount: number;
    completedCount: number;
    failedCount: number;
  };
  sandboxes: SandboxInfo[];
}

interface SandboxInfo {
  containerId: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
  status: "creating" | "running" | "stopping" | "destroyed";
  startedAt: string;
  cpuPercent?: number;
  memMb?: number;
}
```

---

## 6. Technical Constraints

- **TC-001**: Determinism — Dispatch IDs are UUIDs (crypto.randomUUID). Dispatch ordering is FIFO.
- **TC-002**: Air-Gapped — The daemon itself makes no external network calls. Agent backends inside sandboxes MAY access the network (for `gh` CLI, npm install, etc.) but the daemon does not.
- **TC-003**: Fail-Fast Config — Zod validation with no `.default()` calls. Missing `server.port` → `process.exit(1)`.
- **TC-004**: Localhost Only — The daemon MUST bind to `127.0.0.1` or `localhost`. No `0.0.0.0` binding. Remote access is handled by the Tunnel layer (Phase 11).
- **TC-005**: PID File Discipline — PID file at `.gwrk/server.pid`. Start checks for stale PIDs. Stop removes PID file after graceful shutdown.
- **TC-006**: Docker Label Convention — All gwrk sandboxes MUST be labeled with `gwrk.feature=<featureId>` and `gwrk.phase=<phaseId>` for lifecycle management.
- **TC-007**: Graceful Shutdown — On SIGTERM/SIGINT, the daemon MUST: stop accepting new dispatches, wait for running sandboxes to complete (with 30s timeout), destroy remaining containers, remove PID file, and exit.
- **TC-008**: No In-Process Agent Execution — Agents are ALWAYS invoked via Docker sandbox (`docker exec`) or `child_process.execFile`. Never import agent CLIs as libraries.

---

## 7. Testing Requirements

- **TR-001**: `src/commands/server.test.ts` — Verify `server start` creates PID file, binds to port, responds to `/health`. Verify `server stop` removes PID, releases port. Vitest. (FR-001, FR-003, FR-011)
- **TR-002**: `src/server/index.test.ts` — Verify Fastify bootstrap: `/health` returns 200, `/api/status` returns server info with system resources, `/api/dispatch` accepts POST. Vitest. (FR-002, FR-004)
- **TR-003**: `src/server/dispatch.test.ts` — Verify dispatch queue: FIFO ordering, `maxClones` throttling, retry logic (3× same backend then escalate), attempt recording. Mock Docker/Git operations. Vitest. (FR-008, FR-009)
- **TR-004**: `src/server/sandbox.test.ts` — Verify Docker container lifecycle: create with correct labels, mount phase branch at `/workspace`, destroy on completion. Mock `dockerode`. Vitest. (FR-006)
- **TR-005**: `src/server/git-manager.test.ts` — Verify branch creation from feature branch, merge-back with conflict detection, refuse on dirty working tree. Mock `child_process`. Vitest. (FR-010)
- **TR-006**: `src/server/context.test.ts` — Verify context compilation: reads rules, persona, spec, plan, tasks. Produces single Markdown file. Vitest. (FR-007, FR-013)
- **TR-007**: `src/server/monitor.test.ts` — Verify system resource monitoring: CPU, memory, disk. Verify throttle behavior when limits exceeded. Mock `os` module. Vitest. (FR-014)
- **TR-008**: Integration test — Start daemon in subprocess, POST dispatch, verify container created (requires Docker). Vitest integration suite. (FR-001, FR-005, FR-006)
- **TR-009**: `Dockerfile.sandbox` — Build sandbox image, verify `node`, `git`, `gh` are available. Shell test. (FR-012)

---

## 8. Success Criteria

- **SC-001**: `gwrk server start` launches a Fastify daemon that responds to `/health` within 2 seconds.
- **SC-002**: `gwrk server stop` gracefully shuts down the daemon, destroying all active sandboxes within 30 seconds.
- **SC-003**: A dispatch request creates a Docker sandbox with the correct branch mounted and agent context compiled.
- **SC-004**: The dispatch queue respects `parallelism.local.maxClones` — excess dispatches are queued, not rejected.
- **SC-005**: Failed dispatches are retried 3× then escalated to the next backend in `fallbackOrder`.

---

## 9. Verification Requirements

- **VR-001**: E2E lifecycle test: `gwrk server start` → `POST /api/dispatch` → verify Docker container running → verify phase branch created → verify context file in sandbox → container exits → verify dispatch record in `.gwrk/dispatches.jsonl` → `gwrk server stop` → verify port released.
- **VR-002**: Negative test: `gwrk server start` when port is already in use → verify error message and exit code 1.
- **VR-003**: Negative test: `gwrk server stop` when no server is running → verify error message and exit code 1.
- **VR-004**: Queue throttle test: Submit `maxClones + 1` dispatches → verify Nth+1 dispatch is queued → when one sandbox completes, verify queued dispatch starts.
- **VR-005**: Retry escalation test: Mock agent to fail 3× → verify dispatch attempt count is 4 → verify 4th attempt uses different backend from `.gwrkrc.json` `fallbackOrder`.

---

## 10. Coverage Matrix

| US-### | Backed by FR | FR-### | Fulfills US | Tested by TR |
|--------|-------------|--------|-------------|-------------|
| US-001 | FR-001, FR-002 | FR-001 | US-001 | TR-001, TR-002 |
| US-001 | FR-001, FR-002 | FR-002 | US-001 | TR-002 |
| US-002 | FR-003 | FR-003 | US-002 | TR-001 |
| US-003 | FR-004 | FR-004 | US-003 | TR-002 |
| US-004 | FR-005, FR-006, FR-007 | FR-005 | US-004 | TR-002, TR-008 |
| US-004 | FR-005, FR-006, FR-007 | FR-006 | US-004 | TR-004, TR-008 |
| US-004 | FR-005, FR-006, FR-007 | FR-007 | US-009 | TR-006 |
| US-005 | FR-008, FR-009 | FR-008 | US-005 | TR-003 |
| US-005 | FR-008, FR-009 | FR-009 | US-005 | TR-003 |
| US-006 | FR-010 | FR-010 | US-006 | TR-005 |
| US-007 | FR-011 | FR-011 | US-007 | TR-001 |
| US-008 | FR-012 | FR-012 | US-008 | TR-009 |
| US-009 | FR-013 | FR-013 | US-009 | TR-006 |
| US-010 | FR-014 | FR-014 | US-010 | TR-007 |
