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

/** Legacy Gemini 1.x / 2.0 model names that Agy 2.0 rejects on `--model`. */
const LEGACY_GEMINI_MODEL_PATTERN = /^gemini-(1\.0|1\.5|2\.0)-/;
const MAX_INLINE_PROMPT_BYTES = 4096;

/**
 * Antigravity (agy) CLI Agent Backend Adapter.
 * Implements Layer 1 AgentBackend interface for the `agy` CLI.
 */
export class AgyAdapter implements AgentBackend {
  readonly name = "agy";
  readonly displayName = "Antigravity";
  readonly emitsStreamJson = true;
  readonly nativeWriter = true;

  async isAvailable(signal?: AbortSignal): Promise<boolean> {
    try {
      const args = ["agy"];
      const { exitCode } = signal
        ? await execCommand("which", args, undefined, { signal })
        : await execCommand("which", args);
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
      const { exitCode, stderr } = await execCommand("agy", [
        "chat",
        "-m",
        "respond with 1",
        "--mode",
        "agent",
      ]);
      const latencyMs = Date.now() - start;

      if (exitCode === 0) {
        return { status: "available", latencyMs };
      }

      if (stderr.includes("429") || stderr.includes("Quota exceeded")) {
        return { status: "rate_limited", latencyMs, error: stderr.trim() };
      }

      if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("auth") ||
        stderr.includes("Sign in")
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
    const model = task.model || task.env?.AGY_MODEL;
    if (!model || model === "default") return undefined;
    if (!task.env?.AGY_MODEL && LEGACY_GEMINI_MODEL_PATTERN.test(model)) {
      return undefined;
    }
    return model;
  }

  async dispatch(task: TaskDispatch): Promise<AgentDispatch> {
    const rawPrompt = task.prompt ?? "";
    const isExpandedPrompt =
      Boolean(task.stdin) ||
      rawPrompt.includes("\n") ||
      Buffer.byteLength(rawPrompt, "utf-8") > MAX_INLINE_PROMPT_BYTES;

    let inlinePrompt: string;
    let stdinPayload = task.stdin;

    if (isExpandedPrompt) {
      inlinePrompt = task.workflow
        ? `Execute ${task.workflow} instructions from stdin`
        : "Execute instructions from stdin";
      stdinPayload =
        task.stdin && rawPrompt
          ? `${rawPrompt}\n\n${task.stdin}`
          : task.stdin || rawPrompt;
    } else {
      const promptParts: string[] = [];
      if (task.workflow) {
        promptParts.push(`/${task.workflow}`);
      }
      if (task.featureDir) {
        promptParts.push(task.featureDir);
      }
      if (rawPrompt) {
        promptParts.push(rawPrompt);
      }
      inlinePrompt = promptParts.join(" ").trim() || "Execute task";
    }

    const args: string[] = [
      "-p",
      inlinePrompt,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions",
    ];

    if (task.outputSchema) {
      args.push("--json-schema", JSON.stringify(task.outputSchema));
    }

    const model = this.resolveModel(task);
    if (model) args.push("--model", model);

    const effort = task.env?.AGY_EFFORT || task.env?.GWRK_EFFORT;
    if (effort) {
      args.push("--effort", effort);
    }

    return {
      command: "agy",
      args,
      stdin: stdinPayload ?? "",
      env: {
        ...task.env,
        APPROVAL_MODE: "yolo",
      },
      outputFormat: "stream-json",
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
      const newContent = `# Project Agents Governance\n\n${governanceBlock}\n`;
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
    let terminalFailure = false;
    let terminalSeen = false;
    const normalized = stdout
      .split("\n")
      .map((line) => {
        try {
          const event = JSON.parse(line);
          if (
            event.event !== "result" ||
            !event.result ||
            typeof event.result.response !== "string"
          )
            return line;
          terminalSeen = true;
          terminalFailure = event.result.status !== "SUCCESS";
          return JSON.stringify({
            type: "result",
            result: event.result.response,
            usage: event.result.usage,
          });
        } catch {
          return line;
        }
      })
      .join("\n");
    const unwrapped = unwrapStreamJson(normalized);
    let errorType: TaskResult["errorType"];
    let exitCode = terminalFailure && rawExitCode === 0 ? 1 : rawExitCode;

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
      } else if (stderr.includes("429") || stderr.includes("Quota exceeded")) {
        errorType = "rate_limit";
        exitCode = 1;
      } else if (
        stderr.includes("401") ||
        stderr.includes("403") ||
        stderr.includes("auth") ||
        stderr.includes("Sign in")
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
      ...(terminalSeen
        ? {
            status: terminalFailure
              ? ("failure" as const)
              : ("success" as const),
          }
        : {}),
      stdout,
      unwrappedStdout: unwrapped.text,
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
