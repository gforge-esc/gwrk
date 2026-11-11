/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import type {
  AgentTaskRequest as TaskDispatch,
  AgentTaskResult as TaskResult,
} from "../../../../ports/agent-port.js";
import { execCommand } from "../../../../utils/exec.js";
import type {
  AgentBackend,
  AgentDispatch,
  ProbeResult,
  QuotaStatus,
} from "../../../agent-backend.js";

const MAX_INLINE_PROMPT_BYTES = 4096;

/**
 * OpenAI Codex CLI Agent Backend Adapter.
 * Implements Layer 1 AgentBackend interface for the `codex` CLI.
 */
export class CodexAdapter implements AgentBackend {
  readonly name = "codex";
  readonly displayName = "Codex CLI";
  readonly emitsStreamJson = false;
  readonly nativeWriter = true;

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execCommand("which", ["codex"]);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async checkQuota(): Promise<QuotaStatus> {
    return {
      status: "available",
      remaining: 100,
    };
  }

  async probe(): Promise<ProbeResult> {
    const start = Date.now();
    try {
      const { exitCode, stderr } = await execCommand("codex", [
        "exec",
        "echo 1",
      ]);
      const latencyMs = Date.now() - start;

      if (exitCode === 0) {
        return { status: "available", latencyMs };
      }

      if (stderr.includes("429") || stderr.includes("rate limit")) {
        return { status: "rate_limited", latencyMs, error: stderr.trim() };
      }

      if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("API key")
      ) {
        return { status: "auth_error", latencyMs, error: stderr.trim() };
      }

      return { status: "unavailable", latencyMs, error: stderr.trim() };
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      return {
        status: "unavailable",
        latencyMs: Date.now() - start,
        error,
      };
    }
  }

  resolveModel(task: Pick<TaskDispatch, "model" | "env">): string | undefined {
    const model =
      task.model || (task.env?.CODEX_MODEL ?? process.env.CODEX_MODEL);
    return model && model !== "default" ? model : undefined;
  }

  async dispatch(task: TaskDispatch): Promise<AgentDispatch> {
    const args: string[] = ["exec", "--full-auto"];

    const model = this.resolveModel(task);
    if (model) args.push("--model", model);

    const rawPrompt = task.prompt ?? "";
    const isExpandedPrompt =
      Boolean(task.stdin) ||
      rawPrompt.includes("\n") ||
      Buffer.byteLength(rawPrompt, "utf-8") > MAX_INLINE_PROMPT_BYTES;

    let stdinPayload = task.stdin;
    if (isExpandedPrompt) {
      args.push("-");
      stdinPayload =
        task.stdin && rawPrompt
          ? `${rawPrompt}\n\n${task.stdin}`
          : task.stdin || rawPrompt;
    } else if (rawPrompt) {
      args.push(rawPrompt);
    }

    return {
      command: "codex",
      args,
      stdin: stdinPayload ?? "",
      env: task.env,
      outputFormat: "text",
    };
  }

  async syncGovernance(projectRoot: string, rules: string): Promise<string> {
    const agentsMdPath = path.join(projectRoot, "AGENTS.md");
    const beginMarker = "<!-- gwrk:begin -->";
    const endMarker = "<!-- gwrk:end -->";
    const governanceBlock = `${beginMarker}\n${rules}\n${endMarker}`;

    let content = "";
    try {
      content = await fs.readFile(agentsMdPath, "utf-8");
    } catch {
      const newContent = `# Project Codex Governance\n\n${governanceBlock}\n`;
      await fs.writeFile(agentsMdPath, newContent, "utf-8");
      return newContent;
    }

    const beginIndex = content.indexOf(beginMarker);
    const endIndex = content.indexOf(endMarker);

    let updatedContent: string;
    if (beginIndex !== -1 && endIndex !== -1 && endIndex > beginIndex) {
      updatedContent =
        content.slice(0, beginIndex) +
        governanceBlock +
        content.slice(endIndex + endMarker.length);
    } else {
      updatedContent = `${content.trimEnd()}\n\n${governanceBlock}\n`;
    }

    await fs.writeFile(agentsMdPath, updatedContent, "utf-8");
    return updatedContent;
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    let errorType: TaskResult["errorType"];
    let exitCode = rawExitCode;

    if (rawExitCode !== 0) {
      if (rawExitCode === 127 || stderr.includes("command not found")) {
        errorType = "command_not_found";
        exitCode = 127;
      } else if (rawExitCode === 126 || stderr.includes("Permission denied")) {
        errorType = "permission_denied";
        exitCode = 1;
      } else if (stderr.includes("429") || stderr.includes("rate limit")) {
        errorType = "rate_limit";
        exitCode = 1;
      } else if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("API key")
      ) {
        errorType = "auth_failure";
        exitCode = 1;
      } else {
        errorType = "unknown";
        exitCode = 1;
      }
    }

    return {
      exitCode,
      rawExitCode,
      stdout,
      unwrappedStdout: stdout,
      stderr,
      errorType,
      durationS: 0,
    };
  }
}
