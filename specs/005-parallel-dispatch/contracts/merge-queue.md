# Contract: Merge Queue

**Location**: `src/server/merge-queue.ts`

## Interface

```typescript
export interface MergeRequest {
  featureId: string;
  phaseId: string;
  taskId?: string;
  sourceBranch: string;
  targetBranch: string;
  workDir: string;
}

export interface MergeResult {
  success: boolean;
  conflict?: boolean;
  error?: string;
}

export class MergeQueue {
  /**
   * Enqueues a merge request. Merges are executed sequentially.
   * Returns a promise that resolves when the merge is complete or fails.
   */
  async enqueueMerge(request: MergeRequest): Promise<MergeResult>;

  /**
   * Returns true if a merge is currently in progress.
   */
  isMerging(): boolean;
}
```

## Constraints
- MUST use a file-based lock (`.gwrk/merge.lock`) to ensure only one process (or server instance) merges at a time.
- MUST ensure the host repository is clean before and after merge.
- MUST detect git merge conflicts and return `conflict: true`.
