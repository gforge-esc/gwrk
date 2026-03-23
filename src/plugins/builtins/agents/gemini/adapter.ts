import fs from "node:fs/promises";
import path from "node:path";
import type { AgentBackend } from "../../../agent-backend.js";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";

export class GeminiAdapter implements AgentBackend {
  async syncGovernance(projectRoot: string, governance: string): Promise<string> {
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

    args.push("--approval-mode", "yolo");
    args.push("--yolo");

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
