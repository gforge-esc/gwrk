---
type: specification
feature: 002-build-server
last_modified: "2026-05-05T16:30:00Z"
revision: 3
---

# Feature Specification: 002 Build Server

**Feature Branch**: `feat/002-build-server`
**Created**: 2026-02-27
**Revised**: 2026-05-05 (v3 — daily-driver respec, remove Docker sandboxes, add Slack event bridge)
**Status**: Revised
**Input**: Local persistent Fastify daemon that serves as the gwrk control plane — agent dispatch tracking, Slack event bridge, system resource monitoring, sleep/wake resilience, and SQLite execution ledger.

> **Revision Note (v3):** The original spec centered on Docker sandbox containers that were never implemented or needed. The ship loop runs agents locally via `child_process.spawn`. This revision removes the Docker abstraction, focuses on what the server *actually does* for a daily-driver workflow, and adds the missing Slack event bridge that connects the ship orchestrator to Slack notifications.

---

## 1. Architecture Summary

The build server is a **background daemon** that provides:
1. **Daemon lifecycle** — start/stop/status via CLI
2. **Dispatch tracking** — record every agent dispatch in the execution ledger
3. **Slack event bridge** — convert ShipOrchestrator events into actionable Slack messages
4. **System resilience** — sleep/wake detection, network awareness, graceful degradation
5. **Plan heartbeat** — periodic staleness/drift checks (implemented in 018)

The server does NOT execute agents directly. That's the ShipOrchestrator's job. The server is the **observability and notification layer**.

---

## 2. User Scenarios & Testing

### US-001 - Start/Stop Build Server (Priority: P0)
As a Principal Engineer, I want `gwrk server start` to launch a background daemon and `gwrk server stop` to shut it down, so that observability and Slack notifications are always running while I work.

**Implements**: FR-001, FR-002, FR-003

**Acceptance Scenarios**:
1. **Given** no daemon is running, **When** `gwrk server start`, **Then**:
   - `curl -s http://localhost:18790/health | jq -r '.status'` outputs `ok`
   - PID file exists at `.gwrk/server.pid`
2. **Given** daemon is running, **When** `gwrk server stop`, **Then**:
   - Port released, PID file removed
3. **Given** daemon is running, **When** `gwrk server start` again, **Then**:
   - Exits 1 with "Server already running"

### US-002 - System Status (Priority: P0)
As a Principal Engineer, I want `gwrk status` to show server health, active ships, and system resources, so I can check operational state from any terminal.

**Implements**: FR-004

**Acceptance Scenarios**:
1. **Given** daemon running, **When** `gwrk status --json`, **Then** JSON includes:
   - `server.status`, `server.lifecycle`, `server.pid`, `server.port`
   - `system.cpuPercent`, `system.memPercent`, `system.diskFreeGb`
   - `network.status`
   - `dispatch.queueDepth`, `dispatch.activeCount`

### US-003 - Slack Event Bridge (Priority: P0)
As a Principal Engineer, I want the server to listen for ShipOrchestrator events and convert them into Slack messages with clear "bless" actions, so that I can approve, retry, or review from my phone.

**Implements**: FR-005, FR-006

**Foxtrot Charlie Interaction Contract**:

| Event | Pillar | Slack Message | Primary CTA |
|-------|--------|---------------|-------------|
| `ship:complete` | P3 Shipping | "🚢 Shipped: {feature} phase {N} — PR #{M}" | `[✅ Merge]` |
| `ship:failed` | P3 Shipping | "⚠️ Ship Failed: {feature} — {reason}" | `[🔄 Retry]` |
| `ship:blocked` | P3 Shipping | "🛑 Blocked: {feature} — {N} failed attempts" | `[📋 Escalate]` |
| `define:spec:ready` | P2 Definition | "📐 Spec Ready: {feature}" | `[✅ Approve]` |
| `define:plan:ready` | P2 Definition | "📐 Plan Ready: {feature}" | `[✅ Approve]` |
| `plan:proposal` | P2 Definition | "📐 Proposal: {description}" | `[✅ Approve]` `[❌ Reject]` |
| `harvest:done` | P4 Delivery | "🏆 Done Done! {feature}" | `[📊 View Metrics]` |

**Acceptance Scenarios**:
1. **Given** server running with Slack configured, **When** ShipOrchestrator emits `ship:complete`, **Then**:
   - Block Kit message with `[✅ Merge]` button appears in project channel
   - Tapping Merge triggers `gh pr merge`
2. **Given** ship fails, **When** `ship:failed` event fires, **Then**:
   - Message with truncated error + `[🔄 Retry]` button
   - Tapping Retry re-dispatches the same feature/phase

### US-004 - Slack Bless Actions (Priority: P0)
As a Principal Engineer, I want button taps and emoji reactions in Slack to trigger real pipeline actions (merge PR, retry phase, approve spec), so that the pipeline advances from my phone.

**Implements**: FR-007

**Acceptance Scenarios**:
1. **Given** a `[✅ Merge]` button on a ship:complete message, **When** tapped, **Then**:
   - PR is merged via `gh pr merge`
   - Confirmation posted: "PR #{N} merged ✅"
   - Message updated to show merged state
2. **Given** a `[🔄 Retry]` button on a ship:failed message, **When** tapped, **Then**:
   - Ship re-dispatched for the same feature/phase
   - Confirmation posted: "Retrying {feature} phase {N}..."
3. **Given** a ship:complete message, **When** user reacts with ✅, **Then**:
   - Same merge flow as button tap

### US-005 - Sleep/Wake Resilience (Priority: P0)
As a Principal Engineer on a laptop, I want the daemon to survive macOS sleep/wake cycles without losing state, so that I can close my laptop and the server resumes cleanly.

**Implements**: FR-008, FR-009

**Acceptance Scenarios**:
1. **Given** daemon running, **When** system sleeps (heartbeat drift > 3× interval), **Then**:
   - `gwrk status --json | jq -r '.server.lifecycle'` → `sleeping`
2. **Given** system wakes, **When** network verified, **Then**:
   - lifecycle → `ready`, Slack reconnects

### US-006 - Network Awareness (Priority: P1)
As a Principal Engineer, I want the server to detect when I'm offline and pause gracefully, so that agent dispatches don't fail due to network issues.

**Implements**: FR-010

**Acceptance Scenarios**:
1. **Given** network goes down, **When** detected, **Then**:
   - `gwrk status --json | jq -r '.network.status'` → `offline`
2. **Given** network restored, **When** detected, **Then**:
   - status → `online`, operations resume

### US-007 - Execution Ledger (Priority: P0)
As a Principal Engineer, I want every agent dispatch recorded in SQLite with duration, exit code, and log path, so that I can query historical performance.

**Implements**: FR-011

**Acceptance Scenarios**:
1. **Given** a ship run completes, **When** querying `gwrk db query runs`, **Then**:
   - Row exists with feature_id, phase_id, agent_backend, duration, exit_code, log_file

---

## 3. Functional Requirements

### Server Lifecycle
- **FR-001**: `gwrk server start` MUST start a Fastify daemon on `localhost:18790` (configurable), write PID to `.gwrk/server.pid`, start Slack connection if configured.
- **FR-002**: `/health` endpoint MUST return `{ status, components: { server, slack, network } }`.
- **FR-003**: `gwrk server stop` MUST send SIGTERM, wait for graceful shutdown, remove PID file.

### Status
- **FR-004**: `/api/status` MUST return server state, system resources, network status, and dispatch stats.

### Slack Event Bridge
- **FR-005**: Server MUST listen for ShipOrchestrator events (`ship:complete`, `ship:failed`, `ship:blocked`) and convert them to Block Kit Slack messages per the Foxtrot Charlie interaction contract.
- **FR-006**: Every Slack message MUST have exactly one primary CTA that advances the Foxtrot Charlie progression. Messages without a bless action MUST NOT be sent.
- **FR-007**: Button taps (`merge_pr`, `retry_phase`, `request_changes`) MUST trigger the corresponding pipeline action and post confirmation.

### Resilience
- **FR-008**: Daemon MUST detect sleep via heartbeat drift (elapsed > 3× interval) and transition lifecycle to `sleeping`.
- **FR-009**: On wake, daemon MUST verify network + Slack before transitioning to `ready`.
- **FR-010**: Daemon MUST monitor network via `os.networkInterfaces()` polling and emit `network:down`/`network:up`.

### Execution Ledger
- **FR-011**: Every agent dispatch MUST be recorded in SQLite `runs` table with: feature_id, phase_id, agent_backend, started_at, finished_at, exit_code, log_file, duration_s.

---

## 4. What Was Removed (v3 Cuts)

The following were in v2 but are cut because they were never implemented and aren't needed for daily-driver:

- **Docker sandbox containers** (FR-005-old, FR-006-old, FR-012, FR-019, FR-022-026) — ship runs locally via child_process
- **Dockerfile.sandbox** — not needed
- **Container reaper** — not needed
- **Git branch lifecycle via server** (FR-010-old) — ship-orchestrator owns this
- **Context compilation** (FR-007-old, FR-013) — ship-orchestrator owns this
- **Dispatch queue** (FR-008-old) — ship-orchestrator runs one phase at a time
- **Resource throttling** (FR-014-old) — premature; no parallel dispatch

These may return in 005-parallel-dispatch if/when parallel agent execution is needed.

---

## 5. Technical Constraints

- **TC-001**: Localhost only — daemon binds to `127.0.0.1`
- **TC-002**: PID file at `.gwrk/server.pid`
- **TC-003**: No in-process agent execution — agents run via child_process
- **TC-004**: Sleep detection via pure JS heartbeat drift (no native addons)
- **TC-005**: Network detection via `os.networkInterfaces()` polling
- **TC-006**: Zod config validation — missing required fields = exit 1

---

## 6. Testing Requirements

- **TR-001**: `src/commands/server.test.ts` — start/stop, PID management
- **TR-002**: `src/server/routes/status.test.ts` — status endpoint shape
- **TR-003**: `src/server/routes/health.test.ts` — component health reporting
- **TR-004**: `src/server/lifecycle.test.ts` — heartbeat drift, sleep/wake protocol
- **TR-005**: `src/server/network.test.ts` — network state detection
- **TR-006**: `src/server/slack-notify.test.ts` — event bridge, message dispatch
- **TR-007**: `src/server/slack-actions.test.ts` — button handlers, bless actions

---

## 7. Success Criteria

- **SC-001**: `gwrk server start/stop` works reliably across sleep/wake cycles
- **SC-002**: Every ship event produces exactly one Slack message with one clear CTA
- **SC-003**: Every agent dispatch is recorded in the execution ledger
- **SC-004**: `gwrk status` reflects real operational state
