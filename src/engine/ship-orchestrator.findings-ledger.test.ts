/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * TR-009. A recorded finding outlives the file that mirrors it.
 *
 * Detection (FR-008) makes a description-only finding visible to the verdict.
 * Durability is the other half: `task.description` is rewritten wholesale by
 * every later agent, and `48c3ea6` and `5b29881` each deleted a real,
 * unresolved finding exactly that way — a `jq` rewrite of tasks.json, no
 * malice, no error, no trace. The phase then shipped with the defect live.
 *
 * So these cases assert two things the mirror cannot give you:
 *
 * - the ledger still reads back the finding after tasks.json has been rewritten
 *   without it;
 * - an existing entry cannot be rewritten or removed through the write path
 *   this module exposes — not "should not", cannot, because no function here
 *   takes an index or an id to update and none opens the file for truncation.
 *
 * `node:fs` is deliberately NOT mocked. The claim under test is about bytes on
 * disk surviving a hostile rewrite, and a mocked filesystem would assert only
 * that the code called the functions the test already expected it to call.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Finding,
  appendFinding,
  findingsPath,
  readFindings,
} from "./findings-ledger.js";
import * as ledger from "./findings-ledger.js";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as agentUtils from "../utils/agent.js";
import * as gateExec from "../utils/gate-exec.js";
import * as stateUtils from "../utils/state.js";
import { conditionPrompt } from "./prompt-conditioner.js";
import { detectProfile } from "./profile-detector.js";

vi.mock("./prompt-conditioner.js");
vi.mock("./profile-detector.js");
vi.mock("../plugins/review-plugin.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("../utils/gate-exec.js");
vi.mock("./test-activator.js");
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

const FEATURE_ID = "010-reporting-email";
const PHASE_ID = "phase-06";

const FINDING_TEXT =
  "REVIEW FAIL (code): an 8-bit body is put on the wire without negotiating 8BITMIME.";

const mockPlugin = {
  name: "review-webapp",
  version: "1.0.0",
  description: "Webapp review",
  projectType: "webapp",
  codeReviewWorkflow: "review-code-webapp",
  uatReviewWorkflow: "review-uat-webapp",
  steps: { code: [], uat: [] },
};

let tmp: string;
let featureDir: string;
let mockConfig: Record<string, unknown>;

const entry = (over: Partial<Finding> = {}): Finding => ({
  taskId: "T006",
  phaseId: PHASE_ID,
  stage: "code-review",
  text: FINDING_TEXT,
  recordedAt: "2026-08-21T09:14:02.000Z",
  ...over,
});

/** tasks.json for the phase, as the orchestrator's collaborators return it. */
const stateWith = (
  status: string,
  opts: { gateScript?: string; description?: string } = {},
) => ({
  featureId: FEATURE_ID,
  createdAt: "2026-08-13T00:00:00.000Z",
  phases: [
    {
      id: PHASE_ID,
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
 * `before` until the review agent runs, `after` once it has — keyed off the
 * dispatch, not off a call count. `stageCodeReview` reads tasks.json before
 * dispatching to build its phase-task list, so a counting mock would hand
 * `beforeState` the AFTER state and the finding would diff away to nothing.
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

const gatePasses = () =>
  vi.mocked(gateExec.runTaskGate).mockResolvedValue({
    passed: true,
    exitCode: 0,
    output: "ok",
    gatePath: "gates/T006-gate.sh",
  } as never);

/** The raw file, byte for byte. */
const ledgerBytes = () => fs.readFileSync(findingsPath(featureDir), "utf-8");

beforeEach(() => {
  vi.clearAllMocks();

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-findings-ledger-"));
  featureDir = path.join(tmp, "specs", FEATURE_ID);
  fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
  mockConfig = {
    cwd: tmp,
    featureId: FEATURE_ID,
    phaseId: PHASE_ID,
    backend: "claude",
    maxIterations: 3,
  };

  // The revert is what makes this hazardous: `git clean -fd` removes untracked
  // files, and findings.jsonl is untracked. Simulate exactly that, so the
  // snapshot/restore in revertSourceMutations is under test rather than assumed.
  vi.mocked(execSync).mockImplementation(((cmd: unknown) => {
    if (typeof cmd === "string" && cmd.startsWith("git clean")) {
      fs.rmSync(path.join(featureDir, ".gwrk"), {
        recursive: true,
        force: true,
      });
    }
    return "" as never;
  }) as never);

  vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue(
    mockPlugin as never,
  );
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

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("FR-009/TR-009 — the ledger is the store of record", () => {
  it("a recorded finding survives a description overwrite", async () => {
    // The dispatch records the finding; then a later agent rewrites tasks.json
    // wholesale without it — `48c3ea6` and `5b29881`, reproduced. The mirror
    // loses the finding. The ledger must not.
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: "seed",
      }),
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: `seed\n\n${FINDING_TEXT}`,
      }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    const tasksJson = path.join(featureDir, ".gwrk", "tasks.json");
    fs.writeFileSync(
      tasksJson,
      JSON.stringify(stateWith("completed", { description: "seed" })),
      "utf-8",
    );

    // The mirror no longer carries it…
    expect(fs.readFileSync(tasksJson, "utf-8")).not.toContain("REVIEW FAIL");
    // …and the store of record still does, unchanged.
    const recorded = readFindings(featureDir);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].taskId).toBe("T006");
    expect(recorded[0].phaseId).toBe(PHASE_ID);
    expect(recorded[0].stage).toBe("code-review");
    expect(recorded[0].text).toContain("8BITMIME");
  });

  it("the ledger is append-only", () => {
    // Not a convention — a property of the exported surface. There is no
    // function here that takes an index or an id to update, and none that
    // opens the file for writing with truncation, so the erasure D3 performed
    // has no expression through this module. A second append proves the shape:
    // the file grows and line 1 is byte-identical.
    appendFinding(featureDir, entry());
    const firstLine = ledgerBytes();

    appendFinding(
      featureDir,
      entry({
        taskId: "T007",
        text: "REVIEW FAIL (code): the retry loop swallows a permanent 5xx.",
        recordedAt: "2026-08-21T09:41:55.000Z",
      }),
    );

    const after = ledgerBytes();
    expect(after.startsWith(firstLine)).toBe(true);
    expect(after.length).toBeGreaterThan(firstLine.length);
    expect(after.split("\n").filter(Boolean)).toHaveLength(2);

    const read = readFindings(featureDir);
    expect(read.map((f) => f.taskId)).toEqual(["T006", "T007"]);
    expect(read[0].text).toBe(FINDING_TEXT);

    // The write path exposes no way to reach an entry that is already written.
    expect(Object.keys(ledger).sort()).toEqual([
      "FindingSchema",
      "appendFinding",
      "findingsPath",
      "readFindings",
    ]);
  });

  it("puts the ledger beside tasks.json, not inside it", () => {
    expect(findingsPath(featureDir)).toBe(
      path.join(featureDir, ".gwrk", "findings.jsonl"),
    );
    // findingsPath is a pure derivation — nothing exists until a finding lands.
    expect(fs.existsSync(findingsPath(featureDir))).toBe(false);
  });
});

describe("FR-009 — readFindings never throws", () => {
  it("returns nothing when no finding has ever been recorded", () => {
    expect(readFindings(featureDir)).toEqual([]);
    expect(readFindings(path.join(tmp, "specs", "no-such-feature"))).toEqual([]);
  });

  it("skips a malformed line and returns the rest", () => {
    // The asymmetry with the write side is the point: the ledger exists so a
    // finding survives damage elsewhere, so one bad line must not take every
    // other recorded finding down with it.
    appendFinding(featureDir, entry());
    fs.appendFileSync(findingsPath(featureDir), "{ not json at all\n", "utf-8");
    fs.appendFileSync(
      findingsPath(featureDir),
      `${JSON.stringify({ taskId: "nope", stage: "code-review" })}\n`,
      "utf-8",
    );
    appendFinding(featureDir, entry({ taskId: "T007" }));

    const read = readFindings(featureDir);
    expect(read.map((f) => f.taskId)).toEqual(["T006", "T007"]);
  });

  it("refuses to write a malformed entry rather than recording a lie", () => {
    // Strict on the way in, tolerant on the way out. Nothing invalid enters.
    expect(() =>
      appendFinding(featureDir, entry({ taskId: "T6" })),
    ).toThrow();
    expect(() =>
      appendFinding(featureDir, entry({ phaseId: "phase-6" })),
    ).toThrow();
    expect(() => appendFinding(featureDir, entry({ text: "" }))).toThrow();
    expect(fs.existsSync(findingsPath(featureDir))).toBe(false);
  });
});

describe("FR-009 — the orchestrator records what it blocked on", () => {
  it("records a description-only finding raised through stageCodeReview", async () => {
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: "seed",
      }),
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: `seed\n\n${FINDING_TEXT}`,
      }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("NO-GO");
    expect(readFindings(featureDir)).toHaveLength(1);
  });

  it("names the stage the finding came from", async () => {
    loadTaskStateReturns(
      stateWith("completed"),
      stateWith("open", { description: `seed\n\n${FINDING_TEXT}` }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageUatReview();

    expect(readFindings(featureDir)[0].stage).toBe("uat-review");
  });

  it("records nothing when the review raised nothing", async () => {
    // The negative control. A ledger that fills up on every green review is a
    // ledger nobody reads.
    gatePasses();
    const clean = stateWith("completed", {
      gateScript: "gates/T006-gate.sh",
    });
    loadTaskStateReturns(clean, clean);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // @ts-ignore private
    expect(orchestrator.state.reviewVerdict).toBe("GO");
    expect(readFindings(featureDir)).toEqual([]);
  });

  it("records a re-opened task whose description is empty", async () => {
    // An empty `text` fails FindingSchema, and dropping a real finding because
    // the agent left the description blank would be the silence this feature
    // exists to remove.
    loadTaskStateReturns(
      stateWith("completed", { description: "" }),
      stateWith("open", { description: "" }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    const recorded = readFindings(featureDir);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].text).toContain("T006");
  });
});

describe("FR-009/TC-009 — the revert preserves the ledger", () => {
  it("keeps an earlier iteration's finding across the next dispatch's revert", async () => {
    // The entries at risk are not this dispatch's — they are already on disk
    // when the NEXT review reverts, and `git clean -fd` deletes untracked
    // files. Without the snapshot, iteration 1's finding vanishes in iteration
    // 2 and D3 returns through a different door.
    appendFinding(featureDir, entry({ text: "REVIEW FAIL (code): iteration 1." }));
    gatePasses();
    const clean = stateWith("completed", {
      gateScript: "gates/T006-gate.sh",
    });
    loadTaskStateReturns(clean, clean);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    // The simulated `git clean -fd` ran…
    expect(
      vi
        .mocked(execSync)
        .mock.calls.some((c) => String(c[0]).startsWith("git clean")),
    ).toBe(true);
    // …and the finding is still there.
    const recorded = readFindings(featureDir);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].text).toContain("iteration 1");
  });

  it("accumulates iteration 1's entry and this dispatch's, in order", async () => {
    // A NO-GO loop's whole value is the sequence, so entries must add up rather
    // than replace one another.
    //
    // Note what this does NOT prove. The contract puts the append AFTER the
    // revert so a dispatch cannot delete its own entry, and that ordering is
    // unobservable here — verified by mutation: hoisting the append above
    // `revertSourceMutations()` keeps all 12 cases green, because the snapshot
    // is taken before `git clean` runs and restores whatever was already on
    // disk. The ordering is belt to the snapshot's braces; the survival of both
    // entries is the property a test can actually hold.
    appendFinding(featureDir, entry({ text: "REVIEW FAIL (code): iteration 1." }));
    gatePasses();
    loadTaskStateReturns(
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: "seed",
      }),
      stateWith("completed", {
        gateScript: "gates/T006-gate.sh",
        description: `seed\n\n${FINDING_TEXT}`,
      }),
    );
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageCodeReview();

    const texts = readFindings(featureDir).map((f) => f.text);
    expect(texts).toHaveLength(2);
    expect(texts[0]).toContain("iteration 1");
    expect(texts[1]).toContain("8BITMIME");
  });
});
