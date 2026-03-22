import fs from "node:fs/promises";
import path from "node:path";
import { AgentBackend, TaskDispatch, TaskResult } from "../../../agent-backend.js";

export class GeminiAdapter implements AgentBackend {
  readonly name = "gemini";
  readonly contextFileName = "GEMINI.md";

  async syncGovernance(projectRoot: string, governance: string): Promise<void> {
    const targetPath = path.join(projectRoot, this.contextFileName);
    let content = "";
    try {
      content = await fs.readFile(targetPath, "utf-8");
    } catch (e) {}

    const beginMarker = "<!-- gwrk:begin -->";
    const endMarker = "<!-- gwrk:end -->";

    const beginIndex = content.indexOf(beginMarker);
    const endIndex = content.indexOf(endMarker);

    let newContent: string;
    if (beginIndex !== -1 && endIndex !== -1) {
      newContent =
        content.slice(0, beginIndex + beginMarker.length) +
        "\n" +
        governance.trim() +
        "\n" +
        content.slice(endIndex);
    } else {
      newContent = `${beginMarker}\n${governance.trim()}\n${endMarker}\n${content}`;
    }

    await fs.writeFile(targetPath, newContent, "utf-8");
  }

  dispatch(task: TaskDispatch) {
    const command = "gemini";
    const args: string[] = [];
    
    // Normalize workflow name if provided
    const workflowName = task.workflow 
      ? path.basename(task.workflow, ".md").replace(/^gwrk-/, "")
      : "implement";

    let slashCmd = `/${workflowName}`;
    if (task.featureDir) slashCmd += ` ${task.featureDir}`;
    if (task.prompt) slashCmd += ` ${task.prompt}`;
    
    args.push("-p", slashCmd);
    
    // Default approval mode: analyze is plan, others are yolo
    const mode = workflowName === "analyze" ? "plan" : "yolo";
    args.push("--approval-mode", mode);

    // Stdin delivery (ADR-006 constraint)
    const stdin = task.stdin || "";

    return {
      command,
      args,
      stdin,
      env: task.env,
      streamable: true,
    };
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    // Normalization mapping from ADR-006
    const EXIT_CODE_MAP: Record<number, { exitCode: 0 | 1 | 2 | 127; errorType?: TaskResult['errorType'] }> = {
      0: { exitCode: 0 },
      1: { exitCode: 1 },
      42: { exitCode: 2, errorType: "usage_error" },
      53: { exitCode: 1, errorType: "turn_limit" },
      126: { exitCode: 1, errorType: "permission_denied" },
      127: { exitCode: 127 },
      137: { exitCode: 1, errorType: "killed" },
      143: { exitCode: 1, errorType: "terminated" },
    };

    const mapped = EXIT_CODE_MAP[rawExitCode] || { 
      exitCode: rawExitCode > 2 && rawExitCode !== 127 ? 1 : (rawExitCode as any) 
    };

    return {
      success: mapped.exitCode === 0,
      exitCode: mapped.exitCode,
      errorType: mapped.errorType,
      stdout,
      stderr,
      output: stdout,
    };
  }
}
