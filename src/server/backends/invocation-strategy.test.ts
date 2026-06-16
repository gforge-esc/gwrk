/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchToAgent } from "../../utils/agent.js";
import { LocalInvocationStrategy } from "./invocation-strategy.js";

vi.mock("../../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

describe("LocalInvocationStrategy", () => {
  let strategy: LocalInvocationStrategy;

  beforeEach(() => {
    vi.clearAllMocks();
    strategy = new LocalInvocationStrategy();
  });

  it("FR-006, US-005: should invoke gemini cli in the correct workDir", async () => {
    (dispatchToAgent as Mock).mockResolvedValue({
      exitCode: 0,
      stdout: "success",
      stderr: "",
      durationS: 10,
    });

    const task = {
      taskId: "T1",
      featureId: "f1",
      phaseId: "p1",
      backend: "gemini" as const,
      workDir: "/test/root/.runs/sandboxes/T1",
      prompt: "Fix the bug",
    };

    await strategy.invoke(task);

    expect(dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "gemini",
        workDir: task.workDir,
        prompt: task.prompt,
      }),
    );
  });

  it("FR-006, US-005: should invoke claude cli in the correct workDir", async () => {
    (dispatchToAgent as Mock).mockResolvedValue({
      exitCode: 0,
      stdout: "success",
      stderr: "",
      durationS: 10,
    });

    const task = {
      taskId: "T2",
      featureId: "f1",
      phaseId: "p1",
      backend: "claude" as const,
      workDir: "/test/root/.runs/sandboxes/T2",
      prompt: "Implement the feature",
    };

    await strategy.invoke(task);

    expect(dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude",
        workDir: task.workDir,
        prompt: task.prompt,
      }),
    );
  });
});
