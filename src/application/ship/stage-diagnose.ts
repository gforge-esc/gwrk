/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { unwrapStreamJson } from "../../ports/agent-port.js";

export interface DiagnosableTask {
  id: string;
  status: string;
  description?: string;
}

export function extractOpenTaskErrors(tasks: DiagnosableTask[]): string[] {
  const errorContext: string[] = [];
  for (const task of tasks) {
    if (task.status === "open" && task.description) {
      const errorMatch = task.description.match(
        /(?:BUILD_CHECK FAILED|TEST_GATE REGRESSION|POST-FLIGHT GATE FAIL|REVIEW\/GATE DIVERGENCE|REVIEW FINDING|REVIEW FAIL)[\s\S]*$/,
      );
      if (errorMatch) {
        errorContext.push(`Task ${task.id}: ${errorMatch[0]}`);
      }
    }
  }
  return errorContext;
}

export function buildDiagnosisPrompt(
  errorContext: string[],
  currentErrors: string,
): string {
  const reviewDriven = errorContext.some((c) =>
    /REVIEW\/GATE DIVERGENCE|REVIEW FINDING|REVIEW FAIL/.test(c),
  );

  return [
    "You are a build and code-review diagnostician. Analyze the findings below and produce SPECIFIC fix instructions.",
    "",
    "## Current Build/Test Errors",
    currentErrors || "(build passes — the findings below are what failed)",
    "",
    reviewDriven
      ? "## Review Findings (build and gates are GREEN)"
      : "## Error Context from Failed Gates",
    ...(reviewDriven
      ? [
          "A reviewer reproduced these defects while every gate passed, so no gate covers them.",
          "Each FIX must repair the defect the reviewer named. Where a gate or test would have caught",
          "it, add one — a finding that survives its own fix is a finding that will recur.",
          "",
        ]
      : []),
    ...errorContext,
    "",
    "## Instructions",
    "For each error, produce ONE line in this exact format:",
    "FIX: <file_path> — <what to do>",
    "",
    "Examples:",
    "FIX: src/commands/plugin.ts — Add missing import: `import { type PluginSummary } from '../plugins/loader.js'`",
    "FIX: src/utils/config.ts — Change `extensions` type from `string[]` to `Record<string, ExtensionConfig>`",
    "FIX: src/engine/profile-detector.ts — Remove duplicate export of `detectProfile`",
    "",
    "Be SPECIFIC. Name the exact file, the exact import, the exact type. Do NOT explain why.",
    "Do NOT produce code blocks. Just FIX: lines.",
  ].join("\n");
}

export function extractFixLines(rawStdout: string): string[] {
  return unwrapStreamJson(rawStdout)
    .text.split("\n")
    .filter((line: string) => line.trim().startsWith("FIX:"))
    .map((line: string) => line.trim());
}
