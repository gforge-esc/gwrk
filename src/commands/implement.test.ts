/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as routing from "../utils/resolve-agent.js";
import { runGate } from "../utils/gate-runner.js";
import { loadTaskState } from "../utils/state.js";
import { implementAction } from "./implement.js";

const executeWorkflow = vi.hoisted(() => vi.fn());
vi.mock("../plugins/workflow-runtime.js", () => ({
  WorkflowRuntime: class {
    executeWorkflow = executeWorkflow;
  },
}));

vi.mock("../utils/gate-runner.js", () => ({
  runGate: vi
    .fn()
    .mockResolvedValue({ passed: false, exitCode: 1, output: "" }),
}));

vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    agents: { implement: "mock-backend" },
  }),
}));

vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn().mockReturnValue({
    phases: [
      {
        id: "phase-01",
        tasks: [
          { id: "T001", title: "Task 1", status: "open" },
          { id: "T002", title: "Task 2", status: "open" },
        ],
      },
    ],
  }),
  markTaskComplete: vi.fn(),
  saveTaskState: vi.fn(),
}));

vi.mock("../utils/history.js", () => ({
  appendHistory: vi.fn(),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(123),
  finishRun: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(true),
    lstatSync(file: string, options?: { throwIfNoEntry?: boolean }) {
      const runner = process.env.GWRK_RUNNER_PROFILE || "local";
      if (file.endsWith(`.gwrk/models/route-lock.${runner}.json`)) {
        if (options?.throwIfNoEntry === false) return undefined;
        throw Object.assign(new Error("No route lock in this fixture"), {
          code: "ENOENT",
        });
      }
      throw new Error(`Unexpected lstat in implement fixture: ${file}`);
    },
  },
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockImplementation((input: string) => input),
}));

describe("implementAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock: fail pre-flight (not passed), pass post-flight (passed)
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation(async (p: string) => {
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      const passed = gateCalls[p] !== 1;
      return { passed, exitCode: passed ? 0 : 1, output: "" };
    });
  });

  it("executes each open task and runs both gates in task order", async () => {
    await implementAction("004-ship-loop", "1", {});

    expect(loadTaskState).toHaveBeenCalled();
    expect(executeWorkflow).toHaveBeenCalledTimes(2);
    for (const [index, task] of ["T001", "T002"].entries()) {
      expect(executeWorkflow).toHaveBeenNthCalledWith(
        index + 1,
        "gwrk-implement",
        expect.stringMatching(new RegExp(`${task}.*004-ship-loop.*phase-01`)),
        expect.objectContaining({ agent: "mock-backend" }),
      );
    }
    expect(
      vi.mocked(runGate).mock.calls.map(([gate]) => gate.split("/").pop()),
    ).toEqual(["T001-gate.sh", "T001-gate.sh", "T002-gate.sh", "T002-gate.sh"]);
  });

  it("passes the qualified route to the workflow for each task", async () => {
    const model = "qualified-implementation-model";
    const selected = vi.spyOn(routing, "resolveAgent").mockReturnValue({
      backend: "codex",
      model,
      effort: "high",
      routeMode: "pinned",
      role: "implement",
    });
    try {
      await implementAction("004-ship-loop", "1", {});
      expect(executeWorkflow).toHaveBeenCalledTimes(2);
      for (const [, , options] of executeWorkflow.mock.calls) {
        expect(options).toMatchObject({
          agent: "codex",
          model,
          effort: "high",
          routeMode: "pinned",
        });
      }
    } finally {
      selected.mockRestore();
    }
  });

  it("skips tasks that already pass pre-flight gate", async () => {
    // T001 passes pre-flight, T002 fails pre-flight then passes post-flight
    const gateCalls: Record<string, number> = {};
    vi.mocked(runGate).mockImplementation(async (p: string) => {
      if (p.includes("T001")) return { passed: true, exitCode: 0, output: "" };
      gateCalls[p] = (gateCalls[p] || 0) + 1;
      const passed = gateCalls[p] !== 1;
      return { passed, exitCode: passed ? 0 : 1, output: "" };
    });

    await implementAction("004-ship-loop", "1", {});

    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    expect(executeWorkflow).toHaveBeenCalledWith(
      "gwrk-implement",
      expect.stringContaining("T002"),
      expect.any(Object),
    );
  });

  it("respects dry-run flag", async () => {
    await implementAction("004-ship-loop", "1", { dryRun: true });

    expect(loadTaskState).toHaveBeenCalled();
    expect(runGate).toHaveBeenCalledTimes(2);
    expect(executeWorkflow).not.toHaveBeenCalled();
  });
});
