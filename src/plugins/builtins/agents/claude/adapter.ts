/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import type { TaskDispatch, TaskResult } from "../../../../utils/agent.js";
import { execCommand } from "../../../../utils/exec.js";
import type { AgentBackend } from "../../../agent-backend.js";

export class ClaudeAdapter implements AgentBackend {
  readonly name = "claude";

  /**
   * Claude Code runs with `--output-format stream-json`, emitting one JSON
   * event per line. The runner renders these into a readable .runs/*.log
   * transcript and persists the raw stream to a .jsonl sidecar. Backends that
   * emit plain prose (agy/codex) leave this unset and are logged as-is.
   */
  readonly emitsStreamJson = true;

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
    // `stream-json` emits one JSON event per line as work happens (system /
    // assistant / tool_use / tool_result / result), which the runner turns into
    // a full run transcript. `--verbose` is required by Claude Code to stream
    // events in `-p` (print) mode. The prior `--output-format json` buffered
    // everything into a single end-of-run blob, so runs had no reviewable log.
    const args: string[] = [
      "-p",
      task.prompt || "",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    // Enforce the workflow's output contract at the model level. Without this,
    // Claude may spend its single non-interactive turn asking clarifying
    // questions instead of emitting the {summary, intents} envelope — the run
    // then produces no schema-conforming JSON and fails validation. `--json-schema`
    // makes Claude channel any ambiguity *into* the schema rather than break it.
    if (task.outputSchema) {
      args.push("--json-schema", JSON.stringify(task.outputSchema));
    }

    if (task.featureDir) args.push(task.featureDir);

    const model = task.model || task.env?.CLAUDE_MODEL;
    if (model) {
      args.push("--model", model);
    }

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
