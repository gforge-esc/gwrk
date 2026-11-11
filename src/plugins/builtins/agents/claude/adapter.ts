/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import {
  type AgentTaskRequest as TaskDispatch,
  type AgentTaskResult as TaskResult,
  unwrapStreamJson,
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
 * Claude Code Agent Backend Adapter.
 * Implements Layer 1 AgentBackend interface for the `claude` CLI.
 */
export class ClaudeAdapter implements AgentBackend {
  readonly name = "claude";
  readonly displayName = "Claude Code";
  readonly emitsStreamJson = true;
  readonly nativeWriter = true;

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execCommand("which", ["claude"]);
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
      const { exitCode, stderr } = await execCommand("claude", [
        "-p",
        "respond with 1",
        "--max-turns",
        "1",
      ]);
      const latencyMs = Date.now() - start;

      if (exitCode === 0) {
        return { status: "available", latencyMs };
      }

      if (stderr.includes("429") || stderr.includes("Rate limit")) {
        return { status: "rate_limited", latencyMs, error: stderr.trim() };
      }

      if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("authentication")
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

  async dispatch(task: TaskDispatch): Promise<AgentDispatch> {
    const args: string[] = [
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--verbose",
    ];

    const rawPrompt = task.prompt ?? "";
    const isExpandedPrompt =
      Boolean(task.stdin) ||
      rawPrompt.includes("\n") ||
      Buffer.byteLength(rawPrompt, "utf-8") > MAX_INLINE_PROMPT_BYTES;

    let stdinPayload = task.stdin;
    if (isExpandedPrompt) {
      const inlineInstruction = task.workflow
        ? `Execute ${task.workflow} instructions from stdin`
        : "Execute instructions from stdin";
      args.push("-p", inlineInstruction);
      stdinPayload =
        task.stdin && rawPrompt
          ? `${rawPrompt}\n\n${task.stdin}`
          : task.stdin || rawPrompt;
    } else if (rawPrompt) {
      args.push("-p", rawPrompt);
    }

    if (task.outputSchema) {
      args.push("--json-schema", JSON.stringify(task.outputSchema));
    }

    const rawModel = task.model || task.env?.CLAUDE_MODEL;
    if (rawModel && rawModel !== "default") {
      args.push("--model", rawModel);
    }

    const effort =
      task.effort || task.env?.CLAUDE_EFFORT || task.env?.GWRK_EFFORT;
    if (effort) {
      args.push("--effort", effort);
    }

    return {
      command: "claude",
      args,
      stdin: stdinPayload ?? "",
      env: task.env,
      outputFormat: "stream-json",
    };
  }

  async syncGovernance(projectRoot: string, rules: string): Promise<string> {
    const claudeMdPath = path.join(projectRoot, "CLAUDE.md");
    const beginMarker = "<!-- gwrk:begin -->";
    const endMarker = "<!-- gwrk:end -->";
    const governanceBlock = `${beginMarker}\n${rules}\n${endMarker}`;

    let content = "";
    try {
      content = await fs.readFile(claudeMdPath, "utf-8");
    } catch {
      const newContent = `# Project Claude Governance\n\n${governanceBlock}\n`;
      await fs.writeFile(claudeMdPath, newContent, "utf-8");
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

    await fs.writeFile(claudeMdPath, updatedContent, "utf-8");
    return updatedContent;
  }

  parseResult(stdout: string, stderr: string, rawExitCode: number): TaskResult {
    const unwrapped = unwrapStreamJson(stdout);
    let errorType: TaskResult["errorType"];
    let exitCode =
      unwrapped.terminalStatus === "failure" ? rawExitCode || 1 : rawExitCode;

    if (exitCode !== 0) {
      if (rawExitCode === 127 || stderr.includes("command not found")) {
        errorType = "command_not_found";
        exitCode = 127;
      } else if (rawExitCode === 126 || stderr.includes("Permission denied")) {
        errorType = "permission_denied";
        exitCode = 1;
      } else if (
        unwrapped.isTurnLimit ||
        stdout.includes("error_max_turns") ||
        stderr.includes("error_max_turns")
      ) {
        errorType = "turn_limit";
        exitCode = 1;
      } else if (stderr.includes("429") || stderr.includes("Rate limit")) {
        errorType = "rate_limit";
        exitCode = 1;
      } else if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("auth") ||
        (unwrapped.terminalStatus === "failure" &&
          /failed to authenticate|oauth session expired/i.test(unwrapped.text))
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
      status: exitCode === 0 ? "success" : "failure",
      ...(unwrapped.terminalStatus
        ? { terminalStatus: unwrapped.terminalStatus }
        : {}),
      stdout,
      unwrappedStdout: unwrapped.text,
      observedModel: unwrapped.observedModel ?? "unknown",
      ...(unwrapped.structuredOutput
        ? { structuredOutput: unwrapped.structuredOutput }
        : {}),
      ...(unwrapped.usage ? { usage: unwrapped.usage } : {}),
      stderr,
      errorType,
      durationS: 0,
    };
  }
}
