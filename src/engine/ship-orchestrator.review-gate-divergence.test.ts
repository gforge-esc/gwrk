/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A green gate must not erase a review agent's finding.
 *
 * ADR-007 makes gates truth and the agent verdict advisory. The defect was that
 * "advisory" meant "discarded": `readVerdict()` forced `status = "completed"`
 * on every task whose gate passed, including tasks a review agent had just
 * re-opened after finding a real defect. The console then printed GO.
 *
 * Observed on 005-dashboard-api Phase 1 — both review commits read NO-GO with a
 * defect reproduced against the database, while the console printed
 * `review-code-webapp: GO`. The UAT commit named the mechanism: "T001 re-opened
 * (it had been flipped back to completed with the source untouched after the
 * code-review NO-GO). No test covers mixed dated/undated ordering, so all 11
 * Done-When gates and both suites are green with the defect live."
 *
 * Gate green + review re-opened is not noise to resolve in the gate's favour.
 * It is the signal that the gate has a coverage hole, and it is the only moment
 * the system knows that. So it fails the phase and says why.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as stateUtils from "../utils/state.js";
import * as gateExec from "../utils/gate-exec.js";
import { conditionPrompt } from "./prompt-conditioner.js";
import { detectProfile } from "./profile-detector.js";
import fs from "node:fs";

vi.mock("./prompt-conditioner.js");
vi.mock("./profile-detector.js");
vi.mock("../plugins/review-plugin.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("../utils/gate-exec.js");
vi.mock("./test-activator.js");
vi.mock("node:fs");
vi.mock("../plugins/loader.js", () => ({
  PluginLoader: vi.fn().mockImplementation(() => ({
    resolvePlugin: vi.fn().mockResolvedValue({
      path: "/mock/plugins/review-code-cli",
      manifest: { name: "review-code-cli" },
    }),
  })),
}));
vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn(), exec: vi.fn(), execFile: vi.fn() };
});

const mockConfig = {
  cwd: "/root",
  featureId: "005-dashboard-api",
  phaseId: "phase-01",
  backend: "claude",
  maxIterations: 3,
};

const mockPlugin = {
  name: "review-webapp",
  version: "1.0.0",
  description: "Webapp review",
  projectType: "webapp",
  codeReviewWorkflow: "review-code-webapp",
  uatReviewWorkflow: "review-uat-webapp",
  steps: { code: [], uat: [] },
};

/** tasks.json for the phase, with T001 at the given status. */
const stateWith = (status: string) => ({
  featureId: "005-dashboard-api",
  createdAt: "2026-08-08T00:00:00.000Z",
  phases: [
    {
      id: "phase-01",
      title: "cdo-push persistence",
      tasks: [
        {
          id: "T001",
          title: "cdo-push persistence",
          description: "seed",
          status,
          gateScript: "gates/T001-gate.sh",
        },
      ],
    },
  ],
});

/**
 * Mock the review agent's only surviving channel. `executeReviewWorkflow`
 * reverts source mutations but preserves tasks.json, so a re-open is how the
 * agent says NO-GO. Call 1 is the pre-dispatch snapshot; later calls are the
 * post-review state.
 */
function loadTaskStateReturns(before: string, after: string) {
  let call = 0;
  vi.mocked(stateUtils.loadTaskState).mockImplementation((() => {
    call++;
    return (call === 1 ? stateWith(before) : stateWith(after)) as never;
  }) as never);
}

/** The status readVerdict last persisted for T001. */
function savedStatus(): string | undefined {
  const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
  if (calls.length === 0) return undefined;
  const last = calls[calls.length - 1][1] as ReturnType<typeof stateWith>;
  return last.phases[0].tasks[0].status;
}

function savedDescription(): string {
  const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
  const last = calls[calls.length - 1][1] as ReturnType<typeof stateWith>;
  return last.phases[0].tasks[0].description ?? "";
}

describe("review/gate divergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue(mockPlugin as never);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Review prompt" as never);
    vi.mocked(detectProfile).mockResolvedValue({ type: "webapp", stack: {}, layout: "flat" } as never);
    vi.mocked(conditionPrompt).mockImplementation((p) => p);
    // The coverage hole: the gate passes and cannot see what review found.
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: true, exitCode: 0, output: "ok", gatePath: "gates/T001-gate.sh",
    } as never);
  });

  it("does not report GO when a passing gate covers a task review re-opened", async () => {
    loadTaskStateReturns("completed", "open");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("leaves the re-opened task open instead of flipping it back to completed", async () => {
    loadTaskStateReturns("completed", "open");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    expect(savedStatus()).toBe("open");
  });

  it("records the divergence on the task so DIAGNOSE sees why it failed", async () => {
    loadTaskStateReturns("completed", "open");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    expect(savedDescription()).toMatch(/DIVERGENCE/i);
  });

  it("names the diverging tasks in ship state for the manifest", async () => {
    loadTaskStateReturns("completed", "open");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewGateDivergence).toEqual(["T001"]);
  });

  it("still completes a passing task the review left alone", async () => {
    // The ordinary path: review touched nothing, gate is green ⇒ GO.
    loadTaskStateReturns("open", "open");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("GO");
    expect(savedStatus()).toBe("completed");
  });

  it("leaves a failing gate's own NO-GO path untouched", async () => {
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: false, exitCode: 1, output: "assertion failed", gatePath: "gates/T001-gate.sh",
    } as never);
    loadTaskStateReturns("completed", "completed");
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
    expect(savedStatus()).toBe("open");
    // A gate failure is not a divergence — the gate and review agree.
    // @ts-ignore private
    expect(orchestrator.state.reviewGateDivergence).toBeUndefined();
  });
});
