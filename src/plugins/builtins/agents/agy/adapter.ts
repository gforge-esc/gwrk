/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

const AGY_2_MODEL_PATTERN =
  /^(gemini-4-|gemini-3\.8-|claude-(opus|sonnet)-5-5-|gpt-oss-)/;

export class AgyAdapter implements AgentBackend {
  readonly name = "agy";
  readonly nativeWriter = true;

  /**
   * Antigravity 2.0 CLI supports `--output-format stream-json`, emitting
   * structured event lines that the runner turns into a live `.runs/*.log`
   * transcript and `.jsonl` sidecar.
   */
  readonly emitsStreamJson = true;

  async isAvailable(): Promise<boolean> {
    const res = await execCommand("which", ["agy"]);
    return res.exitCode === 0;
  }

  async syncGovernance(
    projectRoot: string,
    governance: string,
  ): Promise<string> {
    const filePath = path.join(projectRoot, "AGENTS.md");
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
    const command = "agy";
    const args: string[] = [];

    let slashCmd = "";
    if (task.workflow) {
      slashCmd = `/${path.basename(task.workflow, ".md")}`;
    }

    if (task.featureDir) {
      slashCmd += `${slashCmd ? " " : ""}${task.featureDir}`;
    }
    if (task.prompt) {
      slashCmd += `${slashCmd ? " " : ""}${task.prompt}`;
    }

    if (slashCmd) {
      args.push("-p", slashCmd);
    }

    args.push("--output-format", "stream-json");

    if (task.outputSchema) {
      args.push("--json-schema", JSON.stringify(task.outputSchema));
    }

    // Pass --model when AGY_MODEL is explicitly set or task.model names a valid
    // Antigravity 2.0 model ID; omit legacy 1.5/2.0 model names (FR-004).
    const explicitModel =
      task.env?.AGY_MODEL ||
      (task.model && AGY_2_MODEL_PATTERN.test(task.model) ? task.model : undefined);
    if (explicitModel) {
      args.push("--model", explicitModel);
    }

    const effort = task.env?.AGY_EFFORT;
    if (effort) {
      args.push("--effort", effort);
    }

    // YOLO mode for all agentic dispatches
    // FR-004: Map YOLO mode to --dangerously-skip-permissions
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

    // Normalization logic (ADR-004/ADR-006)
    if (rawExitCode === 127) {
      errorType = "command_not_found";
    } else if (stderr.includes("turn_limit")) {
      exitCode = 1;
      errorType = "turn_limit";
    } else if (rawExitCode !== 0) {
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
