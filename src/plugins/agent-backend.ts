import type { TaskDispatch, TaskResult } from '../utils/agent.js';

/**
 * Interface for AgentBackend plugins (ADR-006)
 */
export interface AgentBackend {
  /**
   * Generates the CLI-specific context file from the project's source of truth.
   * MUST use <!-- gwrk:begin --> / <!-- gwrk:end --> boundary markers.
   */
  syncGovernance(projectRoot: string, governance: string): Promise<string>;

  /**
   * Prepares the execution context for a single agent run.
   * MUST deliver the bulk of context via the stdin field.
   */
  dispatch(task: TaskDispatch): Promise<{
    command: string;
    args: string[];
    stdin: string;
    env?: Record<string, string>;
  }>;

  /**
   * Normalizes the proprietary CLI output and exit codes into gwrk standard.
   */
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}
