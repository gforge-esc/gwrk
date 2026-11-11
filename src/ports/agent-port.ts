/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Canonical AgentPort interface and stream-json unwrapping utilities (ADR-006, ADR-011).
 */

import type { RouteSelectionDecision } from "../domain/agent-routing.js";

export interface AgentTaskRequest {
  type?: string;
  workflow?: string;
  featureDir?: string;
  prompt?: string;
  stdin?: string;
  agent?: string;
  model?: string;
  workDir?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
  logPath?: string;
  quiet?: boolean;
  phase?: string;
}

export interface AgentDispatchSpec {
  command: string;
  args: string[];
  stdin?: string;
  env?: Record<string, string>;
  outputFormat?: "text" | "json" | "stream-json";
}

export interface AgentTaskResult {
  exitCode: number;
  rawExitCode?: number;
  stdout: string;
  unwrappedStdout?: string;
  structuredOutput?: Record<string, unknown>;
  stderr: string;
  durationS: number;
  durationMs?: number;
  timedOut?: boolean;
  status?: "success" | "failure";
  error?: string;
  errorType?:
    | "rate_limit"
    | "auth_failure"
    | "command_not_found"
    | "permission_denied"
    | "turn_limit"
    | "unknown";
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
}

export interface RoutingContext {
  type: string;
  preview?: boolean;
  runId?: string;
  skillName?: string;
  feature?: string;
  phase?: string;
  preferredAgent?: string;
  explicitBackend?: string;
  explicitModel?: string;
  language?: string;
  taskSP?: number;
}

export type SelectedAgentRoute = RouteSelectionDecision;

export interface AgentPort {
  execute(task: AgentTaskRequest): Promise<AgentTaskResult>;
  selectRoute(
    context: RoutingContext,
    projectRoot?: string,
  ): Promise<SelectedAgentRoute>;
}

export interface UnwrappedStreamResult {
  text: string;
  structuredOutput?: Record<string, unknown>;
  isTurnLimit?: boolean;
  usage?: {
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
  };
}

/**
 * Unwraps a `--output-format stream-json` NDJSON event stream or single JSON
 * result envelope into plain text, structured output, and usage telemetry.
 */
export function unwrapStreamJson(stdout: string): UnwrappedStreamResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { text: "" };
  }

  const lines = trimmed.split("\n");
  let lastResultText: string | undefined;
  let lastStructuredOutput: Record<string, unknown> | undefined;
  const assistantChunks: string[] = [];
  let isTurnLimit = false;
  let usage: UnwrappedStreamResult["usage"];
  let parsedAnyEvent = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("{") || !line.endsWith("}")) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!evt || typeof evt !== "object") continue;

    if (evt.subtype === "error_max_turns") {
      isTurnLimit = true;
    }

    if (
      evt.type === "assistant" &&
      evt.message &&
      typeof evt.message === "object"
    ) {
      parsedAnyEvent = true;
      const msg = evt.message as { content?: unknown };
      if (typeof msg.content === "string") {
        assistantChunks.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (
            block &&
            typeof block === "object" &&
            (block as { type?: string }).type === "text" &&
            typeof (block as { text?: string }).text === "string"
          ) {
            assistantChunks.push((block as { text: string }).text);
          }
        }
      }
    } else if (evt.type === "result") {
      parsedAnyEvent = true;
      if (evt.structured_output && typeof evt.structured_output === "object") {
        lastStructuredOutput = evt.structured_output as Record<string, unknown>;
      }
      if (typeof evt.result === "string") {
        lastResultText = evt.result;
      }
      if (evt.usage && typeof evt.usage === "object") {
        const u = evt.usage as Record<string, unknown>;
        usage = {
          tokensIn:
            typeof u.input_tokens === "number" ? u.input_tokens : undefined,
          tokensOut:
            typeof u.output_tokens === "number" ? u.output_tokens : undefined,
          costUsd:
            typeof evt.total_cost_usd === "number"
              ? evt.total_cost_usd
              : undefined,
        };
      }
    }
  }

  if (!parsedAnyEvent) {
    return {
      text: stdout,
      isTurnLimit: stdout.includes("error_max_turns") || undefined,
    };
  }

  const text =
    lastResultText ??
    (lastStructuredOutput
      ? JSON.stringify(lastStructuredOutput)
      : assistantChunks.join("\n") || stdout);

  return {
    text,
    ...(lastStructuredOutput ? { structuredOutput: lastStructuredOutput } : {}),
    ...(isTurnLimit ? { isTurnLimit: true } : {}),
    ...(usage ? { usage } : {}),
  };
}
