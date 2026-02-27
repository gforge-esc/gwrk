# Requirements Checklist: 002 Build Server

**Purpose**: Track implementation coverage for the Build Server spec
**Created**: 2026-02-27
**Feature**: [spec.md](file:///Users/gonzo/Code/gwrk/specs/002-build-server/spec.md)

## User Stories
- [ ] US-001: Start Build Server (`gwrk server start`)
- [ ] US-002: Stop Build Server (`gwrk server stop`)
- [ ] US-003: System Status (`gwrk status`)
- [ ] US-004: Dispatch Phase to Sandbox
- [ ] US-005: Dispatch Queue with Retry
- [ ] US-006: Git Branch Lifecycle
- [ ] US-007: Daemon PID Management
- [ ] US-008: Sandbox Docker Image
- [ ] US-009: Context Compilation
- [ ] US-010: Resource Throttling

## Functional Requirements
- [ ] FR-001: `gwrk server start` — Fastify daemon on :18790
- [ ] FR-002: REST API endpoints (dispatch, status, queue)
- [ ] FR-003: `gwrk server stop` — graceful shutdown
- [ ] FR-004: `gwrk status` — server state + system resources
- [ ] FR-005: `POST /api/dispatch` — create sandbox + mount branch
- [ ] FR-006: Docker container lifecycle (create, label, destroy)
- [ ] FR-007: Agent context compilation into phase-context.md
- [ ] FR-008: Dispatch queue with parallelism limits
- [ ] FR-009: Retry logic (3×) + backend escalation
- [ ] FR-010: Git branch lifecycle (create, merge-back, conflict detection)
- [ ] FR-011: PID file management
- [ ] FR-012: Dockerfile.sandbox with node/git/gh
- [ ] FR-013: Context compilation from rules/persona/spec/plan/tasks
- [ ] FR-014: System resource monitoring + dispatch throttling

## Technical Constraints
- [ ] TC-001: UUID dispatch IDs, FIFO ordering
- [ ] TC-002: Air-gapped daemon — no external network calls
- [ ] TC-003: Fail-fast config — no `.default()` calls
- [ ] TC-004: Localhost only binding (no 0.0.0.0)
- [ ] TC-005: PID file discipline
- [ ] TC-006: Docker label convention (gwrk.feature, gwrk.phase)
- [ ] TC-007: Graceful shutdown (30s timeout)
- [ ] TC-008: No in-process agent execution

## Data Model
- [ ] DM-001: DispatchRecord schema (dispatches.jsonl)
- [ ] DM-002: GwrkServerConfig extension (.gwrkrc.json)
- [ ] DM-003: SystemStatus schema

## Tests
- [ ] TR-001: server command tests (start/stop, PID)
- [ ] TR-002: Fastify bootstrap tests (health, status, dispatch endpoints)
- [ ] TR-003: dispatch queue tests (FIFO, throttle, retry)
- [ ] TR-004: sandbox lifecycle tests (Docker mock)
- [ ] TR-005: git-manager tests (branch create, merge-back)
- [ ] TR-006: context compilation tests
- [ ] TR-007: resource monitor tests
- [ ] TR-008: Integration test (daemon subprocess + Docker)
- [ ] TR-009: Dockerfile.sandbox build test

## Verification
- [ ] VR-001: E2E lifecycle (start → dispatch → sandbox → dispatches.jsonl → stop)
- [ ] VR-002: Port conflict error test
- [ ] VR-003: No server running error test
- [ ] VR-004: Queue throttle test (maxClones + 1)
- [ ] VR-005: Retry escalation test (3× fail → fallback backend)
