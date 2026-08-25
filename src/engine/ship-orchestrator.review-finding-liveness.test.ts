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

/**
 * `before` until the review agent runs, `after` once it has.
 *
 * Keyed off the dispatch, not off a call count. "Call 1 is the pre-dispatch
 * snapshot" only holds for a direct `executeReviewWorkflow` call:
 * `stageCodeReview` reads tasks.json first to build its phase-task list, so a
 * counting mock hands `beforeState` the AFTER state, `detectReviewReopens`
 * diffs after-vs-after, and a real re-open reports GO — through the exact path
 * `gwrk ship` uses. The dispatch is the event that separates the two states, so
 * that is what the mock keys on.
 */
function loadTaskStateReturns(
  before: ReturnType<typeof stateWith>,
  after: ReturnType<typeof stateWith>,
) {
  vi.mocked(stateUtils.loadTaskState).mockImplementation((() => {
    const dispatched =
      vi.mocked(agentUtils.dispatchToAgent).mock.calls.length > 0;
    return (dispatched ? after : before) as never;
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

  it("diagnoses a task carrying a REVIEW FINDING note", async () => {
    // The third of FR-006's three formats, and the newest: `readVerdict`
    // writes it for a re-opened task with no gateScript. Nothing else in the
    // suite covered it, so dropping `REVIEW FINDING|` from the filter left
    // every test green while the gateless finding — the case where review is
    // the ONLY verdict — went back to "no error context to diagnose".
    const withNote = stateWith("open", {
      description:
        "seed\n\nREVIEW FINDING (T006, no gate):\nThe review agent re-opened this task and it has no gateScript, so nothing mechanical can confirm or refute the finding.",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(withNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    expect(dispatchedPrompts().join("\n")).toMatch(/no gateScript/);
  });

  it("tells the diagnostician the build is green and asks for a gate per fix", async () => {
    // TR-006. The filter matching is half the fix: a diagnostician handed a
    // green build under the heading "Error Context from Failed Gates" hunts
    // for compiler errors that do not exist and returns nothing.
    const withNote = stateWith("open", {
      gateScript: "gates/T006-gate.sh",
      description:
        "seed\n\nREVIEW FAIL (code): an 8-bit body is put on the wire without negotiating 8BITMIME.",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(withNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    const prompt = dispatchedPrompts().join("\n");
    expect(prompt).toMatch(/You are a build and code-review diagnostician/);
    expect(prompt).toMatch(/## Review Findings \(build and gates are GREEN\)/);
    expect(prompt).toMatch(
      /a finding that survives its own fix is a finding that will recur/,
    );
  });

  it("keeps the failed-gate heading when the context is a real build failure", async () => {
    // NEGATIVE control for the case above: the review wording must not leak
    // onto the build/test path, where the errors are real and the gates red.
    const withNote = stateWith("open", {
      gateScript: "gates/T006-gate.sh",
      description: "seed\n\nBUILD_CHECK FAILED: TS2304 cannot find name 'foo'.",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(withNote as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    const prompt = dispatchedPrompts().join("\n");
    expect(prompt).toMatch(/## Error Context from Failed Gates/);
    expect(prompt).not.toMatch(/build and gates are GREEN/);
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

/**
 * TR-008. The channel all four missed NO-GOs actually used.
 *
 * Each of them wrote `REVIEW FAIL (code): …` into a task description and left
 * `status: "completed"`. The VERDICT CHANNEL block asks for the status flip,
 * but the note is what a review agent reliably produces — so a detector that
 * reads only the flip reads all four findings as silence, which is exactly what
 * it did. The description diff is the second signal.
 *
 * It is count-based, not presence-based, and both halves of that matter: a
 * `REVIEW FAIL (` block already in the pre-dispatch snapshot belongs to an
 * earlier iteration and must not re-fire, while a description that already
 * carried one must still fire when a second block lands on it — the ordinary
 * shape of iteration 2 of a NO-GO loop.
 */
describe("FR-008/TR-008 — a description-only finding is a finding", () => {
  const gated = { gateScript: "gates/T006-gate.sh" };
  const FINDING =
    "REVIEW FAIL (code): an 8-bit body is put on the wire without negotiating 8BITMIME.";
  const SECOND_FINDING =
    "REVIEW FAIL (code): the retry loop swallows a permanent 5xx and reports success.";

  const gatePasses = () =>
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "ok",
      gatePath: "gates/T006-gate.sh",
    } as never);

  /** tasks.json as `readVerdict` last persisted it. */
  const savedTask = () => {
    const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
    const last = calls[calls.length - 1][1] as ReturnType<typeof stateWith>;
    return last.phases[0].tasks[0];
  };

  it("treats a newly appended REVIEW FAIL block as a finding", async () => {
    // Green gate, status never moved. The description diff is the only thing
    // that could have raised this, so the divergence naming T006 IS the proof.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: "seed" }),
      stateWith("completed", { ...gated, description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewGateDivergence).toEqual(["T006"]);
  });

  it("re-opens the task so DIAGNOSE can see the finding it blocked on", async () => {
    // DIAGNOSE collects error context from OPEN tasks only. A description-only
    // finding left `completed` would be a NO-GO whose cause the next stage
    // never reads — a loop that blocks without ever saying why.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: "seed" }),
      stateWith("completed", { ...gated, description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(savedTask().status).toBe("open");
  });

  it("names the mechanism that raised it, not just that something did", async () => {
    // "The agent ignored the VERDICT CHANNEL block" and "the agent followed it"
    // are different bugs with different fixes, and the verdict output is the
    // only place a maintainer can tell them apart.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: "seed" }),
      stateWith("completed", { ...gated, description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(savedTask().description).toMatch(/status left unchanged/);
  });

  it("reports NO-GO on a description-only finding", async () => {
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: "seed" }),
      stateWith("completed", { ...gated, description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("reports NO-GO when a description-only finding lands on a gateless task", async () => {
    // The two holes compounded: no gate AND no status flip. `readVerdict` must
    // consult the findings BEFORE the gateless `continue`, or this task is
    // skipped twice over and the phase ships with the defect live.
    loadTaskStateReturns(
      stateWith("completed", { description: "seed" }),
      stateWith("completed", { description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
    expect(gateExec.runTaskGate).not.toHaveBeenCalled();
  });

  it("does not re-fire on a pre-existing REVIEW FAIL block", async () => {
    // The block is on disk before the dispatch, so it is a previous iteration's
    // finding that IMPLEMENT already answered. Presence-based detection would
    // pin the phase at NO-GO forever; the count is what makes it terminate.
    gatePasses();
    const carried = `seed\n\n${FINDING}`;
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: carried }),
      stateWith("completed", { ...gated, description: carried }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("GO");
    expect(savedTask().status).toBe("completed");
  });

  it("fires again when a second block lands on a description that already carried one", async () => {
    // The other half of count-based detection, and the reason presence alone is
    // not merely conservative but wrong: iteration 2 of a NO-GO loop appends to
    // a description that already carries iteration 1's block.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: `seed\n\n${FINDING}` }),
      stateWith("completed", {
        ...gated,
        description: `seed\n\n${FINDING}\n\n${SECOND_FINDING}`,
      }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("still calls a status flip a re-open, not a description-only finding", async () => {
    // The channels stay distinguishable. A task that flipped completed → open
    // AND carries a note is the prompt being followed — reporting it as the
    // description-only channel would send a maintainer after a prompt defect
    // that is not there.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", { ...gated, description: "seed" }),
      stateWith("open", { ...gated, description: `seed\n\n${FINDING}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
    expect(savedTask().description).toMatch(/re-opened by review/);
    expect(savedTask().description).not.toMatch(/status left unchanged/);
  });
});

/**
 * TR-012. The cases above call `executeReviewWorkflow` directly; `gwrk ship`
 * never does. It runs `stageCodeReview` / `stageUatReview`, and each reads
 * tasks.json BEFORE dispatching — to build its phase-task list and its
 * Done-When. That extra read is what made the first version of this suite
 * miss the defect entirely: with a call-counting mock the pre-dispatch snapshot
 * went to the stage, `beforeState` got the post-review state, and a re-open
 * diffed to the empty set. Identical state, opposite verdict, depending only on
 * which door you came through. So drive the doors.
 */
describe("FR-008/TR-012 — a re-open survives the entry points `gwrk ship` uses", () => {
  const gated = { gateScript: "gates/T006-gate.sh" };

  const gatePasses = () =>
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "ok",
      gatePath: "gates/T006-gate.sh",
    } as never);

  it("reports NO-GO through stageCodeReview when the gate still passes", async () => {
    // Runs #2727 / #2728, end to end: green gate, reproduced defect, re-open.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", gated),
      stateWith("open", gated),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("reports NO-GO through stageCodeReview when the re-opened task has no gate", async () => {
    loadTaskStateReturns(stateWith("completed"), stateWith("open"));
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("reports NO-GO through stageUatReview too", async () => {
    // UAT was never broken — it is the control. If this one goes red the
    // regression is in the shared path, not in the code-review scope context.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", gated),
      stateWith("open", gated),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageUatReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });

  it("still reports GO through stageCodeReview when review re-opens nothing", async () => {
    gatePasses();
    const untouched = stateWith("completed", gated);
    loadTaskStateReturns(untouched, untouched);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("GO");
  });

  it("reads the pre-dispatch state before the agent runs, not after", async () => {
    // The mechanism, asserted directly: whatever the stage reads first must be
    // the snapshot the diff is taken against. A counting mock cannot express
    // this, which is why the entry-point cases above were needed to find it.
    gatePasses();
    const seen: string[] = [];
    vi.mocked(stateUtils.loadTaskState).mockImplementation((() => {
      const dispatched =
        vi.mocked(agentUtils.dispatchToAgent).mock.calls.length > 0;
      seen.push(dispatched ? "after" : "before");
      return (dispatched
        ? stateWith("open", gated)
        : stateWith("completed", gated)) as never;
    }) as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    expect(seen.filter((s) => s === "before").length).toBeGreaterThan(1);
    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
  });
});

describe("FR-007 — the doctrine is not written down in its broad form", () => {
  /**
   * TR-007. `node:fs` is auto-mocked for this file, so read the real source
   * through `importActual` — the point of this case is the bytes on disk.
   *
   * This is a doc-comment contract, and it earns its place: the comment above
   * `readVerdict` used to promise "if any tasks in the phase are open → NO-GO",
   * which the code has never done. A maintainer reading it would conclude the
   * re-open channel was already load-bearing and stop looking — which is how
   * three recurrences of this defect were each re-authored from the definitional
   * layer rather than from the code.
   */
  const readOrchestratorSource = async (): Promise<string> => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    return realFs.readFileSync(
      new URL("./ship-orchestrator.ts", import.meta.url),
      "utf-8",
    );
  };

  /** Strip the leading ` * ` of each comment line and collapse hard wraps. */
  const flatten = (s: string): string =>
    s
      .replace(/^\s*\*\s?/gm, "")
      .replace(/\s+/g, " ")
      .trim();

  it("readVerdict's doc comment states the real rule", async () => {
    const src = await readOrchestratorSource();

    // Attached, not merely present. Scanning every `/** */` in the file for the
    // text accepts it anywhere — and it sat two blocks up, above
    // `detectReviewReopens`, so `readVerdict` had NO doc comment at all: an IDE
    // hover showed nothing and JSDoc attributed the correction to the wrong
    // method. A doc-comment contract that does not check attachment is
    // documenting a location, not a function.
    // `(?:(?!\*\/)[\s\S])*` cannot cross a `*/`, so this matches ONE block.
    const attached = src.match(
      /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*private async readVerdict\b/,
    );
    expect(
      attached,
      "the doc block must immediately precede `private async readVerdict`",
    ).not.toBeNull();

    const block = (attached as RegExpMatchArray)[0];
    expect(block).toContain('NOT "any open task → NO-GO"');

    const doc = flatten(block);

    // The correction is explicit, and says why the old claim was wrong.
    expect(doc).toMatch(/NOT "any open task → NO-GO"/);
    expect(doc).toMatch(
      /a task can be open because nobody has implemented it yet/,
    );

    // It describes the two signals the code actually reads.
    expect(doc).toMatch(
      /each task's gate, and the tasks the review agent re-opened/,
    );

    // And all three NO-GO conditions, including the coverage hole — the case
    // the broad "gates are truth" doctrine resolves the wrong way.
    expect(doc).toMatch(/NO-GO if a gate fails/);
    expect(doc).toMatch(/gate passes anyway \(a coverage hole\)/);
    expect(doc).toMatch(/re-opened task has no gate at all/);
  });

  it("no longer promises that any open task is a NO-GO", async () => {
    // NEGATIVE. The sentence being guarded against is verbatim from e588d1f^:
    //
    //   If any tasks in the phase are "open", the review agent re-opened them → NO-GO.
    //
    // US-007 AS-2 words this grep as `.open. .*` — a mandatory space after the
    // quoted word, where the real text has a comma. That pattern matches
    // nothing, in either direction, so as an assertion it can only ever pass.
    // Written that way it is the same false-green shape as the defect under
    // repair, so the gap is closed here: no mandatory separator, and the span
    // may cross the comment's hard wrap.
    const src = await readOrchestratorSource();

    expect(src).not.toMatch(
      /If any tasks? in the phase (?:are|is) .open.[\s\S]{0,160}NO-GO/,
    );
  });
});

/**
 * FR-011 / W4. The ADR is the definitional layer the review prompts encode.
 *
 * ADR-007 §2.1 is where "The agent's verdict is advisory. Gates are truth."
 * was first written down, and every prompt that force-completed a task on a
 * green gate is downstream of that sentence. The file already carries a `026
 * correction` blockquote for the last time the doctrine outran the code; this
 * is the same treatment for 028, and it is a test rather than prose because
 * the three prior recurrences of this defect were each re-authored from the
 * definitional layer *after* the code had already been fixed.
 *
 * `node:fs` is auto-mocked for this file, so the ADR is read through
 * `importActual` — the point of these cases is the bytes on disk.
 */
describe("FR-011/W4 — ADR-007 carries the doctrine correction", () => {
  const readAdrSource = async (): Promise<string> => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    return realFs.readFileSync(
      new URL(
        "../../docs/decisions/ADR-007-single-dispatch-path.md",
        import.meta.url,
      ),
      "utf-8",
    );
  };

  /** The contiguous `>`-prefixed block opening with `**<label>.**`. */
  const quoteBlock = (src: string, label: string): string[] => {
    const lines = src.split("\n");
    const start = lines.findIndex((l) => l.startsWith(`> **${label}.**`));
    if (start === -1) return [];
    let end = start;
    while (end + 1 < lines.length && lines[end + 1].startsWith(">")) end += 1;
    return lines.slice(start, end + 1);
  };

  /** Strip the `> ` quote prefix and collapse the block's hard wraps. */
  const flatten = (block: string[]): string =>
    block
      .map((l) => l.replace(/^>\s?/, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

  it("ADR-007 carries the 028 one-way correction", async () => {
    const src = await readAdrSource();

    const block = quoteBlock(src, "028 correction");
    expect(
      block.length,
      "ADR-007 must carry an `028 correction` blockquote",
    ).toBeGreaterThan(0);

    const doc = flatten(block);

    // One-way, and named as such. The direction IS the correction.
    expect(doc).toMatch(/"Gates are truth" is one-way/);

    // Both halves. Asserting only the prohibition would pass on a block that
    // revoked gate authority outright — the opposite over-correction, and one
    // that would strand every task no reviewer ever looked at.
    expect(doc).toMatch(/may close a task the reviewer raised no finding on/);
    expect(doc).toMatch(
      /never close a task the reviewer reproduced a defect on/,
    );

    // The combination, and what the code already does with it.
    expect(doc).toMatch(/coverage hole \(`readVerdict` treats it as NO-GO\)/);

    // What actually went wrong, with the evidence. Stripped of the count and
    // the run numbers this reads as a hypothetical rather than a post-mortem.
    expect(doc).toMatch(/force `status: completed` whenever gates passed/);
    expect(doc).toMatch(
      /four blocking code-review findings across runs #2727\/#2728/,
    );

    // And the citation, so a reader lands on the diagnosis instead of
    // re-deriving it — which is how 028 became the third recurrence.
    expect(doc).toContain("docs/code-review-verdict-defect.md");
  });

  it("places the 028 correction under the doctrine it corrects, after 026", async () => {
    const src = await readAdrSource();

    // Attached, not merely present. `grep -q '028 correction'` — the shape of
    // this task's own gate — passes just as happily on a block appended to the
    // references section, where nobody reading "Gates are truth" would ever
    // meet it. Position is what makes a correction load-bearing: 026 earned
    // its place directly under the sentence it narrows, and 028 inherits it.
    const doctrine = src.indexOf(
      "The agent's verdict is advisory. Gates are truth.",
    );
    const c026 = src.indexOf("> **026 correction.**");
    const c028 = src.indexOf("> **028 correction.**");
    const nextSection = src.indexOf("### 2.2");

    expect(
      doctrine,
      "§2.1 must still state the doctrine being corrected",
    ).toBeGreaterThan(-1);
    expect(
      nextSection,
      "§2.2 must still follow, bounding the section",
    ).toBeGreaterThan(-1);
    expect(c026, "the 026 correction must still be there").toBeGreaterThan(
      doctrine,
    );
    expect(c028, "the 028 correction goes after the 026 block").toBeGreaterThan(
      c026,
    );
    expect(
      c028,
      "and before §2.2, inside the section it corrects",
    ).toBeLessThan(nextSection);
  });
});

/**
 * TR-010. The returned JSON verdict, as a one-way ratchet (FR-010, D4).
 *
 * Run #2728 iteration 2 is the case every other channel in this file misses:
 * the agent returned `"verdict": "NO-GO"` in its structured output, every gate
 * was green, and it wrote nothing to tasks.json — so there was no re-open to
 * detect and no `REVIEW FAIL (` block to find. `ReviewResult.verdict` has been
 * declared at review-plugin.ts:45 the whole time and read by nobody, and the
 * console printed GO.
 *
 * The direction is the point, and TC-006 fixes it permanently: NO-GO ratchets,
 * GO is ignored, and unreadable output changes nothing and kills nothing.
 *
 * Every case here is driven through `dispatchToAgent`'s real return shape.
 * `TaskResult.stdout` is whatever the backend wrote, verbatim: `agent.ts` pushes
 * raw lines into `stdoutLines` and resolves `stdout: stdoutLines.join("\n")`,
 * and `ClaudeAdapter.parseResult` hands that straight back. On the claude
 * backend — `emitsStreamJson`, dispatched with `--output-format stream-json` —
 * that means the agent's JSON is a STRING VALUE inside an event envelope, so
 * every inner quote arrives backslash-escaped. An earlier version of this suite
 * mocked a bare `'{"verdict":"NO-GO"}'`, a shape no adapter emits, and so
 * proved a behaviour production did not have. The fixtures below emit what the
 * adapters emit, and the two shapes are run as a matrix.
 */
describe("FR-010/TR-010 — the returned JSON verdict ratchets one way", () => {
  const gated = { gateScript: "gates/T006-gate.sh" };

  const gatePasses = () =>
    vi.mocked(gateExec.runTaskGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "ok",
      gatePath: "gates/T006-gate.sh",
    } as never);

  /** Raw stdout, exactly as `dispatchToAgent` resolves it. */
  const agentReturns = (stdout: string) =>
    vi
      .mocked(agentUtils.dispatchToAgent)
      .mockResolvedValue({ exitCode: 0, stdout, stderr: "" } as never);

  /**
   * The claude backend: one JSON event per line, the agent's own text carried
   * as a string value inside `assistant` text blocks and the terminal `result`
   * event. `JSON.stringify` does the escaping the CLI does.
   */
  const streamJson = (agentText: string) =>
    [
      JSON.stringify({ type: "system", subtype: "init", session_id: "s1" }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          type: "message",
          content: [{ type: "text", text: agentText }],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: agentText,
      }),
    ].join("\n");

  /** agy and codex leave `emitsStreamJson` unset and print plain prose. */
  const plainProse = (agentText: string) => agentText;

  const BACKENDS = [
    { name: "claude/stream-json", stdoutFor: streamJson },
    { name: "agy,codex/plain prose", stdoutFor: plainProse },
  ];

  /** Green gates, nothing touched in tasks.json — evidence says GO. */
  const cleanRun = () => {
    gatePasses();
    const untouched = stateWith("completed", gated);
    loadTaskStateReturns(untouched, untouched);
  };

  /** Drive a review stage and hand back the verdict it settled on. */
  async function verdictOf(workflow = "review-code-webapp"): Promise<string> {
    const orchestrator = new ShipOrchestrator(mockConfig as never);
    // @ts-ignore private
    await orchestrator.executeReviewWorkflow(workflow, "scope");
    // @ts-ignore private
    return orchestrator.state.reviewVerdict;
  }

  for (const backend of BACKENDS) {
    it(`a returned NO-GO forces NO-GO — ${backend.name}`, async () => {
      // AS-1. Green gates, no re-opens, and the agent's word is the only signal
      // there is. Before FR-010 this printed GO.
      cleanRun();
      agentReturns(
        backend.stdoutFor(
          '{"summary":"auth bypass in the session guard","verdict":"NO-GO","reopenedTasks":[],"intents":[]}',
        ),
      );

      expect(await verdictOf()).toBe("NO-GO");
    });

    it(`a returned GO never overrides re-open evidence — ${backend.name}`, async () => {
      // AS-2 and the load-bearing half of TC-006. The agent re-opened the task
      // and then claimed GO; the evidence wins, permanently.
      gatePasses();
      loadTaskStateReturns(
        stateWith("completed", gated),
        stateWith("open", gated),
      );
      agentReturns(
        backend.stdoutFor(
          '{"summary":"all clear","verdict":"GO","reopenedTasks":[]}',
        ),
      );

      expect(await verdictOf()).toBe("NO-GO");
    });

    it(`a returned GO never overrides a failing gate — ${backend.name}`, async () => {
      // The other evidence channel, same rule. A returned GO is not consulted,
      // so there is nothing for it to override with.
      vi.mocked(gateExec.runTaskGate).mockResolvedValue({
        passed: false,
        exitCode: 1,
        output: "1 failing",
        gatePath: "gates/T006-gate.sh",
      } as never);
      const untouched = stateWith("completed", gated);
      loadTaskStateReturns(untouched, untouched);
      agentReturns(backend.stdoutFor('{"verdict":"GO"}'));

      expect(await verdictOf()).toBe("NO-GO");
    });

    it(`a returned GO on a clean run leaves the GO alone — ${backend.name}`, async () => {
      // The ratchet only tightens — it must not invent a NO-GO either.
      cleanRun();
      agentReturns(
        backend.stdoutFor(
          '{"summary":"clean","verdict":"GO","reopenedTasks":[]}',
        ),
      );

      expect(await verdictOf()).toBe("GO");
    });

    it(`an absent or unparseable verdict does not fail the run — ${backend.name}`, async () => {
      // AS-3 and the rest of TC-006: a badly formatted summary must not be a
      // new way for a run to die, and must not move the verdict either way.
      for (const agentText of [
        "",
        "Review complete. Everything looks fine to me.",
        "{{{ not json at all",
        '{"summary":"no verdict field here"}',
        '{"verdict":"MAYBE"}',
      ]) {
        cleanRun();
        agentReturns(backend.stdoutFor(agentText));

        expect(await verdictOf()).toBe("GO");
      }
    });

    it(`reads a verdict out of a fenced JSON block — ${backend.name}`, async () => {
      cleanRun();
      agentReturns(
        backend.stdoutFor(
          'Here is my review.\n\n```json\n{\n  "summary": "leaks the token",\n  "verdict": "NO-GO",\n  "reopenedTasks": []\n}\n```\n',
        ),
      );

      expect(await verdictOf()).toBe("NO-GO");
    });

    it(`is not tripped by an agent quoting the JSON Intent Format spec — ${backend.name}`, async () => {
      // NEGATIVE. The review prompts gloss the field as: `verdict`: "GO" if all
      // checks pass and all tasks remain completed, "NO-GO" otherwise. An agent
      // restating that has raised no finding, and a spurious NO-GO costs a
      // whole DIAGNOSE → IMPLEMENT loop.
      cleanRun();
      agentReturns(
        backend.stdoutFor(
          'My output must contain `verdict`: "GO" if all checks pass and all tasks remain completed, "NO-GO" otherwise.\n\n{"verdict": "GO"}',
        ),
      );

      expect(await verdictOf()).toBe("GO");
    });

    it(`the ratchet is live for the uat-review stage too — ${backend.name}`, async () => {
      // Both stages go through `executeReviewWorkflow`, and UAT is the stage
      // that was already looping correctly — it must not regress into GO when
      // the agent's word is the only signal.
      cleanRun();
      agentReturns(backend.stdoutFor('{"verdict":"NO-GO"}'));

      expect(await verdictOf("review-uat-webapp")).toBe("NO-GO");
    });
  }

  it("reads a verdict out of truncated output — plain prose", async () => {
    // The case that rules out a JSON.parse-only reader. Agent stdout gets
    // clipped, and a verdict this legible must not be lost to a missing brace.
    cleanRun();
    agentReturns('{"verdict": "NO-GO", "summary": "the gate does not cover');

    expect(await verdictOf()).toBe("NO-GO");
  });

  it("reads a verdict out of truncated output — clipped result envelope", async () => {
    // Same rule one layer down, and the likelier half of it: the `result` event
    // is last and largest, so on the claude backend it is what gets clipped.
    // The verdict is still legible in the escaped payload.
    cleanRun();
    agentReturns(
      '{"type":"result","subtype":"success","result":"{\\"verdict\\": \\"NO-GO\\", \\"summary\\": \\"the gate does not cover',
    );

    expect(await verdictOf()).toBe("NO-GO");
  });

  it("names the returned verdict as the source", async () => {
    // This NO-GO has no failing gate and no re-opened task behind it, so
    // without attribution the log gives an operator nothing to act on.
    cleanRun();
    agentReturns(streamJson('{"verdict":"NO-GO","summary":"see above"}'));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await verdictOf();
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();

    expect(printed).toMatch(/RETURNED VERDICT/);
  });

  it("names the returned verdict even when a re-open already forced NO-GO", async () => {
    // A genuine returned NO-GO alongside a re-open is a second corroborating
    // signal. The verdict is the same either way, but suppressing the line
    // hides half of why the run stopped from the operator reading the log.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", gated),
      stateWith("open", gated),
    );
    agentReturns(streamJson('{"verdict":"NO-GO","reopenedTasks":["T006"]}'));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    const verdict = await verdictOf();
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    log.mockRestore();

    expect(verdict).toBe("NO-GO");
    expect(printed).toMatch(/RETURNED VERDICT/);
  });

  it("ratchets after the gate computation, never instead of it", async () => {
    // Ordering is the contract: evidence is computed in full first, and the
    // agent's word only tightens what it arrived at. A returned NO-GO must
    // therefore not short-circuit the gates — their side effects on tasks.json
    // are what DIAGNOSE reads next.
    cleanRun();
    agentReturns(streamJson('{"verdict":"NO-GO"}'));

    expect(await verdictOf()).toBe("NO-GO");
    expect(gateExec.runTaskGate).toHaveBeenCalled();
  });

  // ── Pinned to bytes captured from real runs. The synthesised fixtures above
  //    model the envelope; these three ARE the envelope, lifted out of
  //    .runs/*.jsonl transcripts, so a future change to the escaping the CLI
  //    emits cannot pass here by agreeing with our own model of it.

  it("fires on a result envelope captured from a real transcript", async () => {
    // .runs/2026-07-24T17-29-56_gwrk-implement_023-plan-format-contract.jsonl,
    // line 228 — a genuine agent-returned NO-GO, `result` field narrowed to the
    // fenced block around the verdict and otherwise byte-for-byte.
    cleanRun();
    agentReturns(
      "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"```json\\n{\\n  \\\"summary\\\": \\\"Phase 01 UAT: build clean and all 25 plan-to-tasks tests green (US-001..US-004 -t acceptance filters pass), but Phase-1 'Done When' cmd 3 fails (exit 1) and cmd 4 passes vacuously — both, plus spec US-001 AC#1 bullet 2 and §9 VR-004, reference specs/_fixtures/plan-format/.gwrk/tasks.json, which is not committed. Parser behavior verified correct by materializing output (gate = 'make dev:up && make db:migrate && make test:db' verbatim, no echo stub). NO-GO: acceptance criteria as written are not executable against committed repo state. Phase-01 adds no CLI surface; help output unchanged.\\\",\\n  \\\"verdict\\\": \\\"NO-GO\\\",\\n  \\\"reopenedTasks\\\": [\\\"T001\\\"]\\n}\\n```\",\"session_id\":\"b6d6f1c7-2b72-4a00-8594-6f32a9fe7e68\",\"uuid\":\"ca287aa7-ede1-44d0-80b9-2c3075953769\"}",
    );

    expect(await verdictOf()).toBe("NO-GO");
  });

  it("is not tripped by a tool_use block searching for the verdict string", async () => {
    // NEGATIVE, and captured from this feature's own run:
    // .runs/2026-08-25T03-26-03_gwrk-implement_028-review-finding-liveness.jsonl
    // line 104 — an agent grepping the repo for `"verdict": "NO-GO"`. The
    // search term is not a finding, and a `tool_use` input is not something the
    // agent said.
    cleanRun();
    agentReturns(
      "{\"type\":\"assistant\",\"message\":{\"model\":\"claude-opus-5\",\"id\":\"msg_011CeNkm7Mhdn63LA1P4EkPT\",\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"toolu_01CUnZh2trPkPpEt2q4rZ9HV\",\"name\":\"Bash\",\"input\":{\"command\":\"grep -rn '\\\\\"verdict\\\\\": *\\\\\"NO-GO\\\\\"\\\\\\\\|\\\\\"verdict\\\\\":\\\\\"NO-GO\\\\\"' --include='*.md' --include='*.ts' --include='*.sh' --include='*.json' . 2>/dev/null | grep -v node_modules | grep -v '^\\\\\\\\./dist' | head -30\",\"description\":\"Search for literal verdict NO-GO strings\"},\"caller\":{\"type\":\"direct\"}}]},\"session_id\":\"c44a518e-b0ea-42b0-babc-2a32071d36f9\",\"uuid\":\"a20a6433-8dff-472d-ac1f-72d0aedd1ed4\"}",
    );

    expect(await verdictOf()).toBe("GO");
  });

  it("is not tripped by a tool_result carrying spec.md bytes", async () => {
    // NEGATIVE, and the reason this parser reads the envelope instead of
    // widening the regex to tolerate escapes. A review agent reads spec.md and
    // plan.md every run, and both contain `"verdict": "NO-GO"` verbatim
    // (spec.md:174,181,247,286,331,344; plan.md:230,236). Those bytes come back
    // as a `user` / `tool_result` event — the transcript quoting a file, not
    // the agent returning a verdict.
    cleanRun();
    agentReturns(
      "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"tool_use_id\":\"toolu_01X\",\"type\":\"tool_result\",\"content\":\"   174\\t- `verdict`: \\\"NO-GO\\\" when a finding is reproduced\\n   181\\t  \\\"verdict\\\": \\\"NO-GO\\\",\\n\"}]},\"session_id\":\"c44a518e-b0ea-42b0-babc-2a32071d36f9\"}",
    );

    expect(await verdictOf()).toBe("GO");
  });
});
