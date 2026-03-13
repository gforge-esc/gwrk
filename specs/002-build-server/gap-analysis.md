# Gap Analysis: 002 Build Server

## Overview
This document audits the current implementation of the `002-build-server` feature against its [Feature Specification](./spec.md).

## 1. Requirement Status

| ID | Requirement | Status | Gap Notes |
|---|---|---|---|
| FR-001 | `server start` | **Implemented** | Starts daemon, writes PID, responds to health. |
| FR-002 | Fastify Daemon | **Implemented** | REST endpoints for dispatch, status, queue. |
| FR-003 | `server stop` | **Implemented** | SIGTERM, graceful shutdown, PID removal. |
| FR-004 | `gwrk status` | **Implemented** | Reports server, system, network, and queue status. |
| FR-005 | `POST /api/dispatch`| **Implemented** | Phase dispatch to sandbox. |
| FR-006 | Docker Lifecycle | **Implemented** | Container creation, labeling, and destruction. |
| FR-007 | Context Compilation| **Partial** | Context file created at `.gwrk/phase-context.md`, but content completeness needs audit. |
| FR-008 | Dispatch Queue | **Implemented** | Respects concurrency limits. |
| FR-009 | Retry & Escalation | **Implemented** | 3 attempts + fallback backend escalation. |
| FR-010 | Git Branching | **Implemented** | Phase branch creation and merge-back. |
| FR-011 | PID Management | **Implemented** | PID file in `.gwrk/server.pid`. |
| FR-012 | Sandbox Dockerfile | **Implemented** | `Dockerfile.sandbox` exists. |
| FR-014 | Resource Throttling | **Implemented** | Throttles queue based on CPU/Mem/Disk limits. |
| FR-015 | Sleep Detection | **Implemented** | Heartbeat drift detection in `LifecycleMonitor`. |
| FR-016 | Wake Protocol | **Implemented** | Graceful reconnect with health checks. |
| FR-017 | Network Monitoring | **Implemented** | Polling-based connectivity detection. |
| FR-018 | Network Pause/Resume| **Implemented** | Queue pauses on network loss. |
| FR-019 | Docker Pause/Unpause| **Implemented** | Containers paused on sleep, unpaused on ready. |
| FR-020 | Rich Health Check | **Partial** | `/health` returns status, but component-level detail completeness needs audit. |
| FR-022 | Container Reaper | **Missing** | TTL-based container destruction not implemented. |
| FR-024 | `server clean` | **Missing** | Command to destroy all gwrk containers not implemented. |

## 2. Identified Gaps

### GAP-001: Missing `gwrk server clean` (Medium Priority)
The spec requires a command to remove all gwrk-labeled containers without requiring a running daemon (FR-024).
- **Required**: Implement `clean` subcommand in `src/commands/server.ts`.

### GAP-002: Missing Container Reaper (Low Priority)
FR-022 requires a 60-second interval reaper to destroy containers older than their TTL.
- **Required**: Implement background reaper in `SandboxManager` or `startServer`.

### GAP-003: Rich Health Check Audit (Low Priority)
FR-020/FR-021 require specific fields for component readiness and lifecycle status.
- **Required**: Audit `src/server/routes/health.ts` and ensure it meets the schema: `{ status, components: { server, docker, network } }`.

## 3. Remediations

1. **Implement `gwrk server clean`**: Add command to `src/commands/server.ts` that uses Dockerode to filter and remove containers.
2. **Implement Reaper**: Add a `startReaper` method to `SandboxManager` called during server bootstrap.
3. **Enhance Health Check**: Update `healthRoutes` to return the full component status object.
