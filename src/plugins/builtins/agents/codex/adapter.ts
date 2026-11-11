/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { readCodexModelCatalog } from "../../../../adapters/models/codex-catalog.js";
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
  readonly supportsModelForwarding = true;

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execCommand("which", ["codex"]);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  discoverModels() {
    return readCodexModelCatalog();
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

  async dispatch(task: TaskDispatch): Promise<AgentDispatch> {
    const args = [
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
    ];

    const rawModel = task.model || task.env?.CODEX_MODEL;
    if (rawModel && rawModel !== "default") {
      args.push("--model", rawModel);
    }

    const effort = task.effort || task.env?.GWRK_EFFORT;
    if (effort)
      args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);

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
    let unwrappedStdout = stdout;
    let terminalStatus: TaskResult["terminalStatus"];
    for (const line of stdout.split("\n")) {
      try {
        const event = JSON.parse(line);
        if (event?.type === "turn.failed") terminalStatus = "failure";
        if (event?.type === "turn.completed" && terminalStatus !== "failure") {
          terminalStatus = "success";
        }
        if (
          event?.type === "item.completed" &&
          event.item?.type === "agent_message" &&
          typeof event.item.text === "string"
        ) {
          unwrappedStdout = event.item.text;
        }
      } catch {
        // Plain text remains a supported output.
      }
    }

    let structuredOutput: TaskResult["structuredOutput"];
    try {
      const payload = JSON.parse(unwrappedStdout);
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        structuredOutput = payload;
      }
    } catch {
      // Structured output is optional.
    }

    let exitCode =
      terminalStatus === "failure" ? rawExitCode || 1 : rawExitCode;
    if (exitCode !== 0) {
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
      status: exitCode === 0 ? "success" : "failure",
      ...(terminalStatus ? { terminalStatus } : {}),
      stdout,
      unwrappedStdout,
      observedModel: "unknown",
      ...(structuredOutput ? { structuredOutput } : {}),
      stderr,
      errorType,
      durationS: 0,
    };
  }
}
