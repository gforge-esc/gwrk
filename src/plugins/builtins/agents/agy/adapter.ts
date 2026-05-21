import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

/**
 * Antigravity (agy) CLI adapter.
 *
 * agy is the successor to gemini-cli, using the same Gemini models
 * but with a Go-based CLI. Key flag differences:
 *   gemini: -p "<prompt>" --approval-mode yolo --sandbox false
 *   agy:    --print "<prompt>" --dangerously-skip-permissions
 *
 * Context file: AGENTS.md (shared with Antigravity IDE extension)
 */
export class AgyAdapter implements AgentBackend {
  readonly name = "agy";

  async isAvailable(): Promise<boolean> {
    const res = await execCommand("which", ["agy"]);
    return res.exitCode === 0;
  }

  async syncGovernance(
    projectRoot: string,
    governance: string,
  ): Promise<string> {
    // agy reads AGENTS.md (same as Antigravity IDE extension)
    const filePath = path.join(projectRoot, "AGENTS.md");
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      content = "# AGENTS Project Context\n\n<!-- gwrk:begin -->\n<!-- gwrk:end -->";
    }

    const beginMarker = "<!-- gwrk:begin -->";
    const endMarker = "<!-- gwrk:end -->";

    const beginIndex = content.indexOf(beginMarker);
    const endIndex = content.indexOf(endMarker);

    if (beginIndex !== -1 && endIndex !== -1 && beginIndex < endIndex) {
      const before = content.substring(0, beginIndex + beginMarker.length);
      const after = content.substring(endIndex);
      content = `${before}\n${governance}\n${after}`;
    } else {
      content = `${content}\n\n${beginMarker}\n${governance}\n${endMarker}`;
    }

    await fs.writeFile(filePath, content, "utf-8");
    return content;
  }

  async dispatch(task: TaskDispatch): Promise<{
    command: string;
    args: string[];
    stdin: string;
    env?: Record<string, string>;
  }> {
    const command = "agy";
    const args: string[] = [];

    // agy uses --print (or -p) for non-interactive mode
    let prompt = "";
    if (task.workflow) {
      prompt = `/${path.basename(task.workflow, ".md")}`;
    }
    if (task.featureDir) prompt += ` ${task.featureDir}`;
    if (task.prompt) prompt += ` ${task.prompt}`;

    if (prompt) {
      args.push("--print", prompt);
    }

    // agy uses --dangerously-skip-permissions (same as claude)
    args.push("--dangerously-skip-permissions");

    // Model selection — agy doesn't have a --model flag in current version,
    // but respects environment variable for model routing
    const model = task.model || task.env?.AGY_MODEL;
    if (model && task.env) {
      task.env.AGY_MODEL = model;
    }

    return {
      command,
      args,
      stdin: task.stdin || "",
      env: task.env,
    };
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    // agy uses Go-style exit codes:
    // 0 = success
    // 1 = general error
    // 2 = usage error (bad flags)
    let exitCode = rawExitCode;
    let errorType: string | undefined;

    if (rawExitCode > 2 && rawExitCode !== 127) {
      exitCode = 1;
      errorType = "agent_error";
    }

    return {
      exitCode,
      errorType,
      stdout,
      stderr,
      durationS: 0, // Set by caller
    };
  }
}
