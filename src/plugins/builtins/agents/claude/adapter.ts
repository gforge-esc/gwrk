import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

export class ClaudeAdapter implements AgentBackend {
  readonly name = "claude";

  async isAvailable(): Promise<boolean> {
    const res = await execCommand("which", ["claude"]);
    return res.exitCode === 0;
  }

  async syncGovernance(
    projectRoot: string,
    governance: string,
  ): Promise<string> {
    const filePath = path.join(projectRoot, "CLAUDE.md");
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      content = "# Project Context\n\n<!-- gwrk:begin -->\n<!-- gwrk:end -->";
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
    const command = "claude";
    const args: string[] = ["-p", task.prompt || "", "--output-format", "json"];

    if (task.featureDir) args.push(task.featureDir);
    // Note: dispatchAgent in agent.ts uses workflowPath but buildCommand uses _workflowContent
    // Here we use task properties normalized to TaskDispatch

    args.push("--dangerously-skip-permissions");

    return {
      command,
      args,
      stdin: task.stdin || "",
      env: task.env,
    };
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    let exitCode = rawExitCode;
    let errorType: string | undefined;

    // Normalization from spec:
    // Claude 126 exit code to gwrk 1 (permission_denied)
    if (rawExitCode === 126) {
      exitCode = 1;
      errorType = "permission_denied";
    } else if (rawExitCode > 2 && rawExitCode !== 127) {
      exitCode = 1;
    }

    return {
      exitCode,
      errorType,
      stdout,
      stderr,
      durationS: 0,
    };
  }
}
