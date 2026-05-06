import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

export class GeminiAdapter implements AgentBackend {
  readonly name = "gemini";

  async isAvailable(): Promise<boolean> {
    const res = await execCommand("which", ["gemini"]);
    return res.exitCode === 0;
  }

  async syncGovernance(
    projectRoot: string,
    governance: string,
  ): Promise<string> {
    const filePath = path.join(projectRoot, "GEMINI.md");
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
    const command = "gemini";
    const args: string[] = [];

    // gemini -p "/plan specs/001-cli-core" --approval-mode yolo
    let slashCmd = "";
    if (task.workflow) {
      slashCmd = `/${path.basename(task.workflow, ".md")}`;
    }

    if (task.featureDir) slashCmd += ` ${task.featureDir}`;
    if (task.prompt) slashCmd += ` ${task.prompt}`;

    if (slashCmd) {
      args.push("-p", slashCmd);
    }

    // YOLO mode for all agentic dispatches (agent can't pause for approval)
    args.push("--approval-mode", "yolo");

    // Sandbox: disabled only for write workflows that must modify source code.
    // All other workflows (define, research, review, analyze) keep sandbox enabled.
    const writeWorkflows = ["gwrk-implement", "gwrk-ship", "implement", "ship"];
    const isWriteWorkflow = task.workflow
      ? writeWorkflows.some((w) => task.workflow?.includes(w) ?? false)
      : false;

    if (isWriteWorkflow) {
      args.push("--sandbox", "false");
    }

    // Model selection flows from config → TaskDispatch.env.GEMINI_MODEL
    const model = task.env?.GEMINI_MODEL;
    if (model) {
      args.push("--model", model);
    }

    return {
      command,
      args,
      stdin: task.stdin || "",
      env: task.env,
    };
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    // Normalization Rules:
    // Gemini exit 53 -> exitCode: 1, errorType: "turn_limit".
    // Gemini exit 42 -> exitCode: 2, errorType: "usage_error".

    let exitCode = rawExitCode;
    let errorType: string | undefined;

    if (rawExitCode === 53) {
      exitCode = 1;
      errorType = "turn_limit";
    } else if (rawExitCode === 42) {
      exitCode = 2;
      errorType = "usage_error";
    } else if (rawExitCode > 2 && rawExitCode !== 127) {
      exitCode = 1;
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
