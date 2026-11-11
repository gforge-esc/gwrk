/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  AgentTaskRequest as TaskDispatch,
  AgentTaskResult as TaskResult,
} from "../ports/agent-port.js";

export interface QuotaStatus {
  status: "available" | "rate-limited" | "exhausted" | "unknown";
  remaining?: number;
  resetAt?: string;
  backoffS?: number;
}

export interface ProbeResult {
  status: "available" | "rate_limited" | "auth_error" | "unavailable";
  latencyMs: number;
  error?: string;
}

export interface AgentDispatch {
  command: string;
  args: string[];
  stdin: string;
  env?: Record<string, string>;
  outputFormat?: "text" | "json" | "stream-json";
}

/**
 * Interface for AgentBackend plugins (ADR-006)
 */
export interface AgentBackend {
  /**
   * The unique name of this agent backend (e.g., "agy", "claude").
   */
  readonly name: string;
  readonly displayName?: string;

  /**
   * When true, this agent writes files directly via its own tools rather than
   * returning JSON intents. The workflow runtime tolerates prose output from
   * native writers instead of requiring structured JSON.
   */
  readonly nativeWriter?: boolean;

  /**
   * When true, this backend's stdout is a newline-delimited JSON event stream
   * (e.g. Claude Code's `--output-format stream-json`). The dispatch runner
   * renders those events into a readable .runs/*.log transcript and mirrors the
   * raw stream to a .jsonl sidecar. Backends that emit plain prose leave this
   * unset, and their output is written to the log verbatim (unchanged).
   */
  readonly emitsStreamJson?: boolean;

  /**
   * Generates the CLI-specific context file from the project's source of truth.
   * MUST use <!-- gwrk:begin --> / <!-- gwrk:end --> boundary markers.
   */
  syncGovernance(projectRoot: string, governance: string): Promise<string>;

  /**
   * Prepares the execution context for a single agent run.
   * MUST deliver the bulk of context via the stdin field.
   */
  dispatch(task: TaskDispatch): Promise<AgentDispatch>;

  resolveModel?(task: Pick<TaskDispatch, "model" | "env">): string | undefined;

  /**
   * Returns true if the backend's required CLI or integration is available.
   */
  isAvailable(): Promise<boolean>;

  checkQuota?(): Promise<QuotaStatus>;
  probe?(): Promise<ProbeResult>;

  /**
   * Normalizes the proprietary CLI output and exit codes into gwrk standard.
   */
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}
