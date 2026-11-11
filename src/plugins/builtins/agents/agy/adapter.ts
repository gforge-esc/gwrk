/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { parseAgyModelList } from "../../../../adapters/models/agy-catalog.js";
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

  async isAvailable(): Promise<boolean> {
    try {
      const { exitCode } = await execCommand("which", ["agy"]);
      return exitCode === 0;
    } catch {
      return false;
    }
  }

  async discoverModels() {
    const { stdout } = await promisify(execFile)("agy", ["models"], {
      timeout: 10_000,
    });
    return parseAgyModelList(stdout);
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

    const rawModel = task.model || task.env?.AGY_MODEL;
    const explicitEnvModel = Boolean(task.env?.AGY_MODEL);
    if (
      rawModel &&
      rawModel !== "default" &&
      (explicitEnvModel || !LEGACY_GEMINI_MODEL_PATTERN.test(rawModel))
    ) {
      args.push("--model", rawModel);
    }

    const effort = task.effort || task.env?.AGY_EFFORT || task.env?.GWRK_EFFORT;
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
    let terminalError: string | undefined;
    const normalized = stdout
      .split("\n")
      .map((line) => {
        try {
          const event = JSON.parse(line);
          if (
            event?.event === "init" &&
            typeof event.init?.model === "string"
          ) {
            return JSON.stringify({
              type: "system",
              subtype: "init",
              model: event.init.model,
            });
          }
          if (event?.event !== "result" || !event.result) return line;
          const failed = event.result.status !== "SUCCESS";
          if (failed && typeof event.result.error === "string") {
            terminalError ??= event.result.error;
          }
          return JSON.stringify({
            type: "result",
            result: event.result.response,
            usage: event.result.usage,
            is_error: failed,
          });
        } catch {
          return line;
        }
      })
      .join("\n");
    const unwrapped = unwrapStreamJson(normalized);
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
      } else if (
        stderr.includes("429") ||
        stderr.includes("Quota exceeded") ||
        /credits balance is too low|quota exceeded|resource_exhausted/i.test(
          terminalError ?? "",
        )
      ) {
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
      ...(terminalError ? { error: terminalError } : {}),
      errorType,
      durationS: 0,
    };
  }
}
