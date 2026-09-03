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

---

## `reapStale(maxAgeMs: number): Promise<number>`

**Source**: `src/server/sandbox.ts`
**Consumed by**: `src/server/index.ts` (interval reaper)

Lists all containers with `gwrk.*` labels and destroys those where `gwrk.startedAt` is older than `maxAgeMs`. Returns the count of destroyed containers.

```typescript
async function reapStale(maxAgeMs: number): Promise<number>
```

---

> **Note:** the sections above describe the original Docker-container sandbox.
> The implementation is git-worktree based (ADR-005). The lifecycle contract
> below is the current one; treat the container API above as historical.

## Worktree Sandbox Lifecycle

### Identity

`createSandbox` mints a stable id — `<featureId>-<taskId>-<uuid8>`, also the
worktree basename — and exports it to **both** hooks:

| Variable | Meaning |
|---|---|
| `GWRK_SANDBOX_ID` | stable id, also the worktree basename |
| `GWRK_SANDBOX_DIR` | the worktree path (may no longer exist during prune) |
| `GWRK_FEATURE_ID` | the feature being shipped |

Identity is what makes a sandbox reapable. A project that lets a tool infer a
name from the directory (compose defaults its project name to the basename)
loses all handle on those resources the moment gwrk deletes the worktree —
~40 containers and ~12 GB of volumes accumulated on data-dashboard that way, and
clearing them required hand-written `docker ps | grep` passes. A project that
pins names from `GWRK_SANDBOX_ID` stays reapable.

### Registry

Every created sandbox is recorded in `.runs/sandbox-registry.json` — deliberately
outside `.runs/sandboxes/`, so nothing scanning that directory mistakes it for a
worktree. Written **before** `setup` runs: if setup starts a stack and then
throws, the sandbox is already leaking and must be prunable.

`destroySandbox` removes the record on the ordinary exit path.

### `pruneOrphans({ teardown?, dryRun? }): Promise<PruneResult>`

An orphan is a recorded sandbox whose `workDir` no longer exists. `destroySandbox`
covers the ordinary exit; this covers everything that skips it — SIGKILL, a
crashed process, a slept machine — which is the only way an unreapable resource
can appear once identity is stable. A `finally` block cannot cover those, so
exit-path cleanup alone is necessary but not sufficient.

- Teardown runs from the **project root**, since the worktree is gone by
  definition. The project must therefore target the sandbox via
  `GWRK_SANDBOX_ID`, not the working directory.
- A failed teardown **keeps** the record (reported in `failed`) so a later prune
  can retry, rather than discarding the only handle on the leaked resources.
- `dryRun` reports without acting and without writing the registry.
- With no `teardown` configured, records are still dropped — but the CLI says
  plainly that nothing the project started was released, rather than reporting a
  sweep that freed nothing.

Surfaced as `gwrk sandbox list` and `gwrk sandbox prune [--dry-run]`.

**Known limitation:** the registry is forward-looking. Sandboxes created before
it existed are not in it, and a sandbox whose worktree AND record are both gone
is undiscoverable by gwrk — releasing those needs a one-time project-side sweep.
