import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

export class CodexAdapter implements AgentBackend {
  readonly name = "codex";

  async isAvailable(): Promise<boolean> {
    const res = await execCommand("which", ["codex"]);
    return res.exitCode === 0;
  }

  async syncGovernance(
    projectRoot: string,
    governance: string,
  ): Promise<string> {
    const contextFile = "AGENTS.md";
    const filePathCodex = path.join(projectRoot, contextFile);
    let content = "";
    try {
      content = await fs.readFile(filePathCodex, "utf-8");
    } catch {
      content = "# Codex Context\n\n<!-- gwrk:begin -->\n<!-- gwrk:end -->";
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

    await fs.writeFile(filePathCodex, content, "utf-8");
    return content;
  }

  async dispatch(task: TaskDispatch): Promise<{
    command: string;
    args: string[];
    stdin: string;
    env?: Record<string, string>;
  }> {
    const command = "codex";
    const args: string[] = ["exec", "--full-auto"];

    if (task.workflow) {
      args.push(task.workflow);
    }

    if (task.featureDir) args.push(task.featureDir);
    if (task.prompt) args.push(task.prompt);

    const model = task.model || task.env?.CODEX_MODEL;
    if (model) {
      args.push("--model", model);
    }

    args.push("--dangerously-bypass-approvals-and-sandbox");

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

    if (rawExitCode > 2 && rawExitCode !== 127) {
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
