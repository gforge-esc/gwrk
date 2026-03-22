import fs from "node:fs/promises";
import path from "node:path";
import { AgentBackend, TaskDispatch, TaskResult } from "../../../agent-backend.js";

export class ClaudeAdapter implements AgentBackend {
  readonly name = "claude";
  readonly contextFileName = "CLAUDE.md";

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
    const command = "claude";
    const args: string[] = ["--dangerously-skip-permissions"];
    
    // Stdin delivery is mandatory per ADR-006.
    // For Claude, stdin is a first-class prompt source.
    const stdin = task.stdin || "";

    // The prompt arg is minimal instructions.
    let prompt = task.prompt || "implement";
    if (task.featureDir) prompt += ` in ${task.featureDir}`;

    args.push("-p", prompt);
    args.push("--output-format", "json");

    return {
      command,
      args,
      stdin,
      env: task.env,
      streamable: true,
    };
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    let structuredOutput: any;
    try {
       // Claude output format JSON might be mixed with text or wrapped
       // But assuming it's clean if we used --output-format json
       structuredOutput = JSON.parse(stdout);
    } catch (e) {}

    const EXIT_CODE_MAP: Record<number, { exitCode: 0 | 1 | 2 | 127; errorType?: TaskResult['errorType'] }> = {
      0: { exitCode: 0 },
      1: { exitCode: 1 },
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
      structuredOutput
    };
  }
}
