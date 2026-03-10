# Contract: Dispatch Orchestrator

**Location**: `src/server/dispatch-orchestrator.ts`

## Interface

```typescript
export interface OrchestrateOptions {
  featureId: string;
  phaseId: string;
  concurrency?: number;
}

export class DispatchOrchestrator {
  /**
   * Orchestrates the execution of a phase by dispatching tasks to the queue.
   * Calculates independent tasks based on dependencies.
   */
  async orchestratePhase(options: OrchestrateOptions): Promise<void>;

  /**
   * Calculates which tasks are ready to be dispatched.
   * A task is ready if it's 'open' and all its dependencies are 'completed'.
   */
  getReadyTasks(featureId: string, phaseId: string): string[];

  /**
   * Monitors the status of dispatched tasks and dispatches new ones as dependencies are met.
   */
  private onTaskCompleted(taskId: string): void;
}
```

## Constraints
- MUST respect task dependencies defined in `tasks.json`.
- MUST honor the global and per-backend concurrency limits.
- MUST handle task failure and stop dependent tasks from starting.
- MUST integrate with `DispatchQueue` for actual task execution.
