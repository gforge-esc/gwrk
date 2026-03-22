import type { AnyManifest } from "./manifest.js";

/**
 * Task input for agent dispatch (ADR-006).
 */
export interface TaskDispatch {
  prompt?: string;
  agent?: string;
  workDir?: string;
  stdin?: string;
  env?: Record<string, string>;
  workflow?: string;
  featureDir?: string;
}

/**
 * Normalized task result (ADR-006).
 */
export interface TaskResult {
  success: boolean;
  exitCode: 0 | 1 | 2 | 127;
  errorType?: "gate_failure" | "turn_limit" | "auth_error" | "usage_error" | "not_found" | "turn_limit" | "permission_denied" | "killed" | "terminated";
  stdout: string;
  stderr: string;
  output: string; // Combined or primary output
  structuredOutput?: Record<string, unknown>;
  tokenUsage?: { input: number; output: number };
  durationMs?: number;
  logPath?: string;
}

/**
 * Agent Backend plugin interface (ADR-006).
 */
export interface AgentBackend {
  /** Internal identifier */
  readonly name: string;

  /** CLI-specific project memory file name (e.g., "GEMINI.md", "CLAUDE.md") */
  readonly contextFileName: string;

  /**
   * Sync durable governance from .gwrk/agent-context.md to the CLI-specific file.
   */
  syncGovernance(projectRoot: string, governance: string): Promise<void>;

  /**
   * Prepare a CLI invocation for the given task.
   * gwrk core handles the actual spawn and stdin piping.
   */
  dispatch(task: TaskDispatch): {
    command: string;
    args: string[];
    stdin: string;
    env?: Record<string, string>;
    streamable: boolean;
  };

  /**
   * Normalize proprietary CLI output and exit codes to gwrk standard.
   */
  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult;
}

/**
 * Metadata for a loaded agent plugin.
 */
export interface LoadedAgentPlugin {
  manifest: AnyManifest;
  adapter: AgentBackend;
  path: string;
}
