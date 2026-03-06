---
type: contract
feature: 002-build-server
last_modified: "2026-03-05T11:12:20Z"
---

# Contract: Docker Sandbox

**Feature**: 002-build-server
**Scope**: Docker container lifecycle for agent execution

---

## `createSandbox(opts: SandboxOptions): Promise<SandboxInfo>`

**Source**: `src/server/sandbox.ts`
**Consumed by**: `src/server/dispatch.ts`

Creates a Docker container from `gwrk-sandbox:bookworm-slim`, mounts the phase branch at `/workspace`, labels with gwrk metadata, and starts the container.

```typescript
interface SandboxOptions {
  featureId: string;
  phaseId: string;
  branchName: string;        // e.g. "phase/001-cli-core-phase-01"
  repoPath: string;          // Host path to the repo clone
  backend: AgentBackend;     // Agent to run inside the sandbox
  contextPath: string;       // Path to compiled context file
}

async function createSandbox(opts: SandboxOptions): Promise<SandboxInfo>
```

**Container configuration**:
- Image: `gwrk-sandbox:bookworm-slim`
- Bind mount: `opts.repoPath:/workspace:rw`
- Labels: `gwrk.feature=<featureId>`, `gwrk.phase=<phaseId>`, `gwrk.backend=<backend>`
- Network: bridge (for `gh` CLI access)
- Working dir: `/workspace`

**Returns**: `SandboxInfo` (see spec DM-003)

**Error states**:
| Condition | Throws |
|---|---|
| Docker not available | `SandboxError('Docker daemon not reachable')` |
| Image not found | `SandboxError('Image gwrk-sandbox:bookworm-slim not found — run docker build')` |

---

## `destroySandbox(containerId: string): Promise<void>`

**Source**: `src/server/sandbox.ts`
**Consumed by**: `src/server/dispatch.ts`, `src/server/index.ts` (shutdown)

Stops and removes the container. No-op if container already stopped.

```typescript
async function destroySandbox(containerId: string): Promise<void>
```

---

## `destroyAllSandboxes(): Promise<number>`

**Source**: `src/server/sandbox.ts`
**Consumed by**: `src/server/index.ts` (graceful shutdown)

Lists all containers with `gwrk.*` labels and destroys them. Returns the count of destroyed containers.

```typescript
async function destroyAllSandboxes(): Promise<number>
```

---

## `listSandboxes(): Promise<SandboxInfo[]>`

**Source**: `src/server/sandbox.ts`
**Consumed by**: `src/server/routes/status.ts`

Lists all active gwrk sandbox containers with their metadata.

```typescript
async function listSandboxes(): Promise<SandboxInfo[]>
```

Implementation: `docker ps --filter label=gwrk.feature --format json` via `dockerode`.
