# Contract: Git Manager (Parallel Extensions)

**Location**: `src/server/git-manager.ts`

## Interface

```typescript
export interface GitManager {
  /**
   * Creates a git worktree for the given branch at the target path.
   * Optimizes for speed using local references if possible.
   */
  createWorktree(branchName: string, targetPath: string): string;

  /**
   * Removes a git worktree at the given path and cleans up the worktree registration.
   */
  removeWorktree(targetPath: string): void;

  /**
   * Performs an atomic merge from a worktree (sourceBranch) into the targetBranch.
   * Uses a file-based lock for atomicity.
   * Returns a result indicating success or conflict.
   */
  atomicMerge(
    sourceBranch: string, 
    targetBranch: string, 
    workDir: string
  ): Promise<{ success: boolean; conflict?: boolean; error?: string }>;

  /**
   * Checks for merge conflicts in the current state of a workDir.
   */
  hasConflicts(workDir: string): boolean;
}
```

## Constraints
- `createWorktree` MUST NOT mutate the host repository's HEAD.
- `atomicMerge` MUST leave the `targetBranch` in a clean state (no pending merge) if a conflict occurs, unless explicitly entering conflict resolution mode.
- MUST use `git worktree add --detach` or similar to create isolated branches.
