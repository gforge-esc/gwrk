# Contract: SandboxManager (Worktree-Based)

## Purpose

The `SandboxManager` creates, manages, and destroys ephemeral Git worktree sandboxes for parallel task execution. Each task runs in its own worktree, ensuring complete file-system isolation from the host repository and other concurrent tasks.

> **Migration note:** The current `src/server/sandbox.ts` uses Docker (Dockerode). This is a **full rewrite** to Git worktrees per R001 decision. The Docker implementation is replaced entirely.

## Class Definition

### `SandboxManager`

Constructor: `new SandboxManager(projectRoot: string)`

#### `createSandbox(opts: SandboxOptions): Promise<SandboxResult>`
Creates a new Git worktree for a task.

- **Parameters:**
  ```typescript
  interface SandboxOptions {
    featureId: string;       // e.g., '005-parallel-dispatch'
    taskId: string;          // e.g., 'T001'
    backend: string;         // AgentBackend string enum value
    branchBase: string;      // Base branch (feature branch)
  }
  ```
- **Returns:**
  ```typescript
  interface SandboxResult {
    workDir: string;         // Absolute path: <projectRoot>/.runs/sandboxes/<featureId>-<taskId>-<uuid>/
    branchName: string;      // e.g., 'sandbox/<featureId>-<taskId>-<uuid>'
  }
  ```
- **Side Effects:**
  - `mkdir -p <projectRoot>/.runs/sandboxes/`
  - `git worktree add <workDir> -b <branchName> <branchBase>`
- **Error:**
  - `FAIL: SandboxManager — git worktree add failed: <stderr>`

#### `destroySandbox(workDir: string): Promise<void>`
Pushes the sandbox branch, creates a PR, then removes the worktree.

- **Side Effects (in order):**
  1. `git push origin <branchName>` (from workDir cwd)
  2. `gh pr create --base <featureBranch> --head <branchName> --title "T<id>: <title>"` (from workDir cwd)
  3. `git worktree remove --force <workDir>`
- **Error:**
  - Push/PR failure: log warning, still remove worktree

#### `pruneSandboxes(): Promise<void>`
Cleans up stale/orphaned worktrees.

- **Side Effects:** `git worktree prune`
- **Called by:** `gwrk server start` on boot

#### `listSandboxes(): Promise<SandboxInfo[]>`
Lists all active worktree sandboxes.

- **Returns:**
  ```typescript
  interface SandboxInfo {
    workDir: string;
    featureId: string;
    taskId: string;
    branchName: string;
    status: 'running' | 'completed' | 'orphaned';
  }
  ```
- **Implementation:** Parses `git worktree list --porcelain`, filters for `.runs/sandboxes/` paths.

## Invariants

1. **No Host Mutation (TC-004):** All modifications happen within `workDir`, never in the host working tree.
2. **Ephemeral (TC-005):** Worktrees are created per-task and removed after PR creation or on failure.
3. **Naming Convention:** `<projectRoot>/.runs/sandboxes/<featureId>-<taskId>-<uuid>/`
4. **Branch Convention:** `sandbox/<featureId>-<taskId>-<uuid>`
