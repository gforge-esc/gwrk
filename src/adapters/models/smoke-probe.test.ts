/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { AgentTaskRequest } from "../../ports/agent-port.js";
import { createSmokeProbe } from "./smoke-probe.js";

const request = {
  route: {
    backend: "codex",
    provider: "openai",
    family: "gpt",
    modelId: "gpt-6.1-sol",
    effort: "low",
  },
  scope: {
    workspaceId: "fixture",
    runnerProfile: "local",
    platform: process.platform,
    arch: process.arch,
  },
  timeoutMs: 1000,
};

describe("model smoke probe", () => {
  it("sends an exact route from a temporary checkout and preserves unknown model identity", async () => {
    const dispatch = vi.fn(async (task: AgentTaskRequest) => {
      expect(readdirSync(task.workDir!).sort()).toEqual([
        ".git",
        ".gwrkrc.json",
      ]);
      return {
        exitCode: 0,
        stdout: '{"status":"ok"}',
        stderr: "",
        durationS: 0,
      };
    });

    const result = await createSmokeProbe(dispatch).runSmokeProbe(request);
    const task = dispatch.mock.calls[0][0];
    expect(task).toMatchObject({
      agent: "codex",
      model: "gpt-6.1-sol",
      effort: "low",
      routeMode: "pinned",
      timeoutMs: 1000,
    });
    expect(existsSync(task.workDir!)).toBe(false);
    expect(result).toMatchObject({
      status: "passed",
      schemaValid: true,
      observedModel: "unknown",
      requested: request.route,
    });
  });

  it.each([
    [{ exitCode: 124, timedOut: true }, "timed_out"],
    [{ exitCode: 1, errorType: "auth_failure" as const }, "auth_error"],
    [{ exitCode: 0, observedModel: "another-model" }, "failed"],
    [{ exitCode: 0, status: "failure" as const }, "failed"],
    [{ exitCode: 0, stdout: '{"status":"ok","extra":true}' }, "failed"],
  ] as const)("classifies %j as %s", async (overrides, status) => {
    const probe = createSmokeProbe(async () => ({
      stdout: '{"status":"ok"}',
      stderr: "",
      durationS: 0,
      ...overrides,
    }));
    expect((await probe.runSmokeProbe(request)).status).toBe(status);
  });

  it("rejects invalid deadlines before dispatch", async () => {
    const dispatch = vi.fn();
    const probe = createSmokeProbe(dispatch);
    await expect(
      probe.runSmokeProbe({ ...request, timeoutMs: 0 }),
    ).rejects.toThrow(/timeout/);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
