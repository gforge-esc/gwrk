/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { TaskDispatch, TaskResult } from "../utils/agent.js";

/**
 * Interface for AgentBackend plugins (ADR-006)
 */
export interface AgentBackend {
  /**
   * The unique name of this agent backend (e.g., "gemini", "claude").
   */
  readonly name: string;

  /**
   * When true, this agent writes files directly via its own tools rather than
   * returning JSON intents. The workflow runtime tolerates prose output from
   * native writers instead of requiring structured JSON.
   */
  readonly nativeWriter?: boolean;

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
   * Returns true if the backend's required CLI or integration is available.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Normalizes the proprietary CLI output and exit codes into gwrk standard.
   */
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}
