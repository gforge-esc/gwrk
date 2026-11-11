/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import {
  WorkflowRuntime,
  extractJsonFromOutput,
} from "../../plugins/workflow-runtime.js";
import type {
  SmokeProbeEvidence,
  SmokeProbePort,
} from "../../ports/model-qualification-port.js";
import { dispatchToAgent } from "../../utils/agent.js";

const expected = { status: "ok" };
const prompt =
  'Return exactly the JSON object {"status":"ok"}. Do not use tools or change files.';

export function createSmokeProbe(dispatch = dispatchToAgent): SmokeProbePort {
  return {
    async runSmokeProbe({ route, timeoutMs }): Promise<SmokeProbeEvidence> {
      if (
        !Number.isInteger(timeoutMs) ||
        timeoutMs < 1 ||
        timeoutMs > 2_147_483_647
      ) {
        throw new RangeError(
          "Smoke probe timeout must be a positive timer duration in milliseconds.",
        );
      }

      const directory = await mkdtemp(join(tmpdir(), "gwrk-model-smoke-"));
      try {
        await promisify(execFile)("git", ["init", "--quiet", directory], {
          timeout: 5_000,
        });
        await writeFile(
          join(directory, ".gwrkrc.json"),
          JSON.stringify({
            project: { name: "model-smoke-probe" },
          }),
        );
        const { taskResult } = await new WorkflowRuntime().executeWorkflow(
          "gwrk-model-smoke-probe",
          prompt,
          {
            nativeOnly: true,
            allowMissingPrompt: true,
            projectRoot: directory,
            taskType: "model-smoke-probe",
            agent: route.backend,
            model: route.modelId,
            quiet: true,
            dispatcher: (task) =>
              dispatch({
                ...task,
                effort: route.effort,
                routeMode: "pinned",
                timeoutMs,
                logPath: join(directory, ".runs", "probe.log"),
                includeExternalContext: false,
              }),
          },
        );
        const observedModel = taskResult.observedModel ?? "unknown";
        let schemaValid = false;
        try {
          const payload =
            taskResult.structuredOutput ??
            extractJsonFromOutput(
              taskResult.unwrappedStdout ?? taskResult.stdout,
            );
          schemaValid = isDeepStrictEqual(payload, expected);
        } catch {
          // Invalid output is recorded as probe evidence.
        }

        const matches =
          observedModel === "unknown" || observedModel === route.modelId;
        const status = taskResult.timedOut
          ? "timed_out"
          : taskResult.errorType === "auth_failure"
            ? "auth_error"
            : taskResult.exitCode === 0 &&
                taskResult.status !== "failure" &&
                schemaValid &&
                matches
              ? "passed"
              : "failed";
        return {
          requested: route,
          observedModel,
          status,
          schemaValid,
          exitCode: taskResult.exitCode,
          durationMs: taskResult.durationMs ?? taskResult.durationS * 1000,
          ...(taskResult.errorType ? { error: taskResult.errorType } : {}),
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  };
}
