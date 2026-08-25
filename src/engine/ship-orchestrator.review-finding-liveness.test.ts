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
