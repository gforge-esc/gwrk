/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A review agent's blocking finding must survive to the verdict.
 *
 * `executeReviewWorkflow` reverts every file the review agent touched except
 * tasks.json, so a task moved `completed` → `open` is the agent's only way to
 * say NO-GO. Three things quietly broke that channel for CODE_REVIEW while
 * leaving it intact for UAT — which is why UAT looped correctly every time and
 * code review printed GO over four blocking findings (runs #2727 / #2728).
 *
 * - D10: `stageCodeReview` appended "if a completed task's implementation has
 *   issues, note them in your summary but do NOT change its status" AFTER the
 *   prompt, so it was the last thing the agent read. Unqualified by phase, and
 *   every current-phase task is `completed` by the time review runs, it read as
 *   "never re-open anything". `stageUatReview` has no such line.
 * - D2: `readVerdict` skipped tasks with no `gateScript` before consulting the
 *   re-opens, so a finding on a gateless task vanished into a vacuous GO. A
 *   task with no gate is the case where review is the ONLY verdict available.
 * - D5: DIAGNOSE only recognised build/test failures as context, so on the
 *   review path — where BUILD_CHECK and TEST_GATE both pass, which is the whole
 *   point of the divergence warning — it always printed "no error context".
 *
 * See docs/code-review-verdict-defect.md.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as stateUtils from "../utils/state.js";
import * as gateExec from "../utils/gate-exec.js";
import * as agentUtils from "../utils/agent.js";
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
      path: "/mock/plugins/review-code-webapp",
      manifest: { name: "review-code-webapp" },
    }),
  })),
}));
vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn(), exec: vi.fn(), execFile: vi.fn() };
});

const mockConfig = {
  cwd: "/root",
  featureId: "010-reporting-email",
  phaseId: "phase-06",
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

/**
 * tasks.json for the phase. `gateScript: undefined` models a phase whose
 * Done-When is fenced prose rather than a per-task gate — common, and the case
 * where the review agent's judgement is the only verdict there is.
 */
const stateWith = (
  status: string,
  opts: { gateScript?: string; description?: string } = {},
) => ({
  featureId: "010-reporting-email",
  createdAt: "2026-08-13T00:00:00.000Z",
  phases: [
    {
      id: "phase-06",
      title: "send pipeline",
      tasks: [
        {
          id: "T006",
          title: "send pipeline",
          description: opts.description ?? "seed",
          status,
          gateScript: opts.gateScript,
        },
      ],
    },
  ],
});

/** Call 1 is the pre-dispatch snapshot; later calls are the post-review state. */
function loadTaskStateReturns(
  before: ReturnType<typeof stateWith>,
  after: ReturnType<typeof stateWith>,
) {
  let call = 0;
  vi.mocked(stateUtils.loadTaskState).mockImplementation((() => {
    call++;
    return (call === 1 ? before : after) as never;
  }) as never);
}

/** Every prompt the orchestrator dispatched this test. */
function dispatchedPrompts(): string[] {
  return vi
    .mocked(agentUtils.dispatchToAgent)
    .mock.calls.map((c) => (c[0] as { prompt: string }).prompt);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue(
    mockPlugin as never,
  );
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(fs.readFileSync).mockReturnValue("# Review prompt" as never);
  vi.mocked(detectProfile).mockResolvedValue({
    type: "webapp",
    stack: {},
    layout: "flat",
  } as never);
  vi.mocked(conditionPrompt).mockImplementation((p) => p);
  vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  } as never);
});

describe("D2 — a re-open on a task with no gate still reports NO-GO", () => {
  it("reports NO-GO when review re-opens a gateless task", async () => {
    loadTaskStateReturns(stateWith("completed"), stateWith("open"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("leaves the gateless re-opened task open", async () => {
    loadTaskStateReturns(stateWith("completed"), stateWith("open"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
    const last = calls[calls.length - 1][1] as ReturnType<typeof stateWith>;
    expect(last.phases[0].tasks[0].status).toBe("open");
  });

  it("records why, so DIAGNOSE and IMPLEMENT can act on it", async () => {
    loadTaskStateReturns(stateWith("completed"), stateWith("open"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
    const last = calls[calls.length - 1][1] as ReturnType<typeof stateWith>;
    expect(last.phases[0].tasks[0].description).toMatch(/REVIEW FINDING/i);
  });

  it("still reports GO when review leaves a gateless task alone", async () => {
    // No finding, no gate, nothing to report — must not become a false NO-GO.
    loadTaskStateReturns(stateWith("completed"), stateWith("completed"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("GO");
  });

  it("does not run a gate for a task that has none", async () => {
    loadTaskStateReturns(stateWith("completed"), stateWith("open"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.executeReviewWorkflow("review-code-webapp", "scope");

    expect(gateExec.runTaskGate).not.toHaveBeenCalled();
  });
});

describe("D5 — DIAGNOSE reads review findings as error context", () => {
  it("diagnoses a task carrying a REVIEW/GATE DIVERGENCE note", async () => {
    const withNote = stateWith("open", {
      gateScript: "gates/T006-gate.sh",
      description:
        "seed\n\nREVIEW/GATE DIVERGENCE (T006, gate: gates/T006-gate.sh):\nThe review agent re-opened this task and its gate still passes.",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(withNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    expect(dispatchedPrompts().join("\n")).toMatch(/DIVERGENCE/);
  });

  it("diagnoses a task carrying a REVIEW FAIL note", async () => {
    const withNote = stateWith("open", {
      gateScript: "gates/T006-gate.sh",
      description:
        "seed\n\nREVIEW FAIL (code): an 8-bit body is put on the wire without negotiating 8BITMIME.",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(withNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    expect(dispatchedPrompts().join("\n")).toMatch(/8BITMIME/);
  });

  it("still skips when an open task carries no finding at all", async () => {
    const noNote = stateWith("open", { gateScript: "gates/T006-gate.sh" });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(noNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    expect(agentUtils.dispatchToAgent).not.toHaveBeenCalled();
  });
});

describe("D10 — the code-review scope context carries the verdict channel", () => {
  beforeEach(() => {
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "ok",
      gatePath: "gates/T006-gate.sh",
    } as never);
    const s = stateWith("completed", { gateScript: "gates/T006-gate.sh" });
    loadTaskStateReturns(s, s);
  });

  it("tells the review agent that re-opening the task is the NO-GO", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(dispatchedPrompts().join("\n")).toMatch(/VERDICT CHANNEL/);
  });

  it("no longer tells it to leave a completed task's status alone", async () => {
    // The exact sentence that disabled code review as a gate. It was meant to
    // protect EARLIER phases; unqualified, it covered the current one too.
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(dispatchedPrompts().join("\n")).not.toMatch(
      /note them in your summary but do NOT change its status/,
    );
  });

  it("still forbids touching tasks from other phases", async () => {
    // The infinite-loop guard the old sentence was protecting must survive.
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(dispatchedPrompts().join("\n")).toMatch(/OTHER phase/);
  });
});
