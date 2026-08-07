/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * PR identity across a multi-phase ship run.
 *
 * `gwrk ship <feature>` with no phase argument ships every open phase
 * sequentially on ONE branch (FR-013), and PR_CI runs once per phase. The
 * PR contract scopes its guarantee to the RUN — "all gates pass, all phases
 * complete" (specs/004-ship-loop/contracts/pr.md) — so one PR per run is the
 * design. What the PR must not do is keep the identity of whichever phase
 * happened to create it: a PR carrying phases 1–4 titled "Phase 1" with a
 * Phase-1-only task list misreports what a reviewer is being asked to merge.
 *
 * The phases a PR carries are recorded in a machine-readable marker in its
 * body, so the PR itself is the state store. Orchestrator state is per-phase
 * (.runs/<feature>_<phase>.state), so it cannot carry the span; reading the
 * marker back also survives crash-resume and re-minting after a mid-feature
 * merge closes the previous PR.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator";
import * as fs from "node:fs";
import * as state from "../utils/state";
import { execSync } from "node:child_process";

vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn().mockReturnValue("") };
});
vi.mock("../utils/state");

const config = {
  featureId: "005-dashboard-api",
  phaseId: "phase-02",
  backend: "claude",
  maxIterations: 3,
  ciTimeout: 30,
  cwd: "/mock/cwd",
};

/** Four phases with distinguishable task titles, as tasks.json would hold. */
function taskState() {
  return {
    featureId: "005-dashboard-api",
    createdAt: "2026-08-04T00:00:00.000Z",
    phases: [
      {
        id: "phase-01",
        title: "Read models",
        tasks: [
          {
            id: "T001",
            title: "Add the scoreboard reader",
            description: "d",
            status: "completed" as const,
            gateScript: "gates/T001-gate.sh",
          },
        ],
      },
      {
        id: "phase-02",
        title: "Push endpoint",
        tasks: [
          {
            id: "T002",
            title: "Add the metric push route",
            description: "d",
            status: "completed" as const,
            gateScript: "gates/T002-gate.sh",
          },
        ],
      },
      {
        id: "phase-03",
        title: "Redaction",
        tasks: [
          {
            id: "T003",
            title: "Redact driver errors",
            description: "d",
            status: "open" as const,
            gateScript: "gates/T003-gate.sh",
          },
        ],
      },
      {
        id: "phase-04",
        title: "History",
        tasks: [
          {
            id: "T004",
            title: "Cap history points",
            description: "d",
            status: "open" as const,
            gateScript: "gates/T004-gate.sh",
          },
        ],
      },
    ],
  };
}

/**
 * Drive the real PR_CI stage against a scripted `gh`. Returns every command
 * issued plus the PR body text the stage handed to `--body-file`, which is
 * what a reviewer actually sees.
 */
async function runPrCi(opts: {
  phaseId: string;
  /** `gh pr list` result — a number reuses that open PR, "" mints a new one. */
  existingPr: string;
  /** Body `gh pr view --json body` returns for the reused PR. */
  existingBody?: string;
  gateResult?: "PASS" | "FAIL";
  reviewVerdict?: "GO" | "NO-GO";
}) {
  const commands: string[] = [];
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    commands.push(String(cmd));
    const c = String(cmd);
    if (c.includes("git status --porcelain")) return "";
    if (c.includes("gh pr list")) return opts.existingPr;
    if (c.includes("gh pr view") && c.includes("--json body"))
      return opts.existingBody ?? "";
    if (c.includes("gh pr view") && c.includes("--json url"))
      return "https://github.com/o/r/pull/21";
    if (c.includes("gh pr create"))
      return "https://github.com/o/r/pull/99";
    return "";
  }) as unknown as typeof execSync);

  const orchestrator = new ShipOrchestrator({ ...config, phaseId: opts.phaseId });
  const s = (orchestrator as unknown as { state: Record<string, unknown> }).state;
  s.branchName = "feat/005-dashboard-api";
  if (opts.gateResult) s.gateResult = opts.gateResult;
  if (opts.reviewVerdict) s.reviewVerdict = opts.reviewVerdict;

  const result = await (
    orchestrator as unknown as { stagePrCi: () => Promise<{ success: boolean }> }
  ).stagePrCi();

  // The stage writes the body to a temp file and passes it via --body-file.
  const bodyWrite = vi
    .mocked(fs.writeFileSync)
    .mock.calls.find(([p]) => String(p).includes("gwrk-pr-body"));

  return {
    result,
    commands,
    body: bodyWrite ? String(bodyWrite[1]) : "",
    titleOf: (verb: "create" | "edit") => {
      const cmd = commands.find((c) => c.includes(`gh pr ${verb}`));
      return cmd?.match(/--title "([^"]*)"/)?.[1] ?? "";
    },
  };
}

describe("ship PR identity across a multi-phase run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(state.loadTaskState).mockReturnValue(taskState());
  });

  it("retitles a reused PR to span every phase it carries", async () => {
    // Phase 1 created the PR; phase 2 of the same run lands on it. Today the
    // reuse path returns early and the PR keeps saying "Phase 1" forever.
    const { commands, titleOf } = await runPrCi({
      phaseId: "phase-02",
      existingPr: "21",
      existingBody:
        '<!-- gwrk:pr {"phases":[{"id":"phase-01","gate":"PASS","review":"GO"}]} -->',
    });

    expect(titleOf("edit")).toBe("feat(dashboard-api): Phases 1–2");
    expect(commands.some((c) => c.includes("gh pr create"))).toBe(false);
  });

  it("lists tasks from every phase a reused PR carries, not just the newest", async () => {
    const { body } = await runPrCi({
      phaseId: "phase-02",
      existingPr: "21",
      existingBody:
        '<!-- gwrk:pr {"phases":[{"id":"phase-01","gate":"PASS","review":"GO"}]} -->',
    });

    expect(body).toContain("Add the scoreboard reader"); // phase-01
    expect(body).toContain("Add the metric push route"); // phase-02
  });

  it("records the phases it carries so the next phase can extend the span", async () => {
    // Without a marker the span cannot survive into the next phase's
    // orchestrator, which gets a fresh per-phase state file.
    const { body } = await runPrCi({ phaseId: "phase-01", existingPr: "" });

    expect(body).toMatch(/<!-- gwrk:pr .* -->/);
    expect(JSON.parse(body.match(/<!-- gwrk:pr (.*?) -->/)![1]).phases).toEqual([
      { id: "phase-01", gate: "PASS", review: "GO" },
    ]);
  });

  it("titles a single-phase PR for that phase alone", async () => {
    const { titleOf } = await runPrCi({ phaseId: "phase-01", existingPr: "" });

    expect(titleOf("create")).toBe("feat(dashboard-api): Phase 1");
  });

  it("claims only the current phase when minting a PR after a mid-feature merge", async () => {
    // The human merged phases 1–3, closing that PR. `gh pr list` sees no open
    // PR, so phase 4 mints a fresh one — it must not inherit the old span.
    const { titleOf, body } = await runPrCi({
      phaseId: "phase-04",
      existingPr: "",
    });

    expect(titleOf("create")).toBe("feat(dashboard-api): Phase 4");
    expect(JSON.parse(body.match(/<!-- gwrk:pr (.*?) -->/)![1]).phases).toEqual([
      { id: "phase-04", gate: "PASS", review: "GO" },
    ]);
  });

  it("extends the span of a PR written by an older gwrk with no marker", async () => {
    const { titleOf } = await runPrCi({
      phaseId: "phase-02",
      existingPr: "21",
      existingBody: "## feat(dashboard-api): Phase 1\n\nhand-written body",
    });

    expect(titleOf("edit")).toBe("feat(dashboard-api): Phases 1–2");
  });

  it("keeps shipping when someone hand-edits the marker into invalid JSON", async () => {
    const { result, titleOf } = await runPrCi({
      phaseId: "phase-02",
      existingPr: "21",
      existingBody:
        "## feat(dashboard-api): Phase 1\n\n<!-- gwrk:pr {oops not json} -->",
    });

    expect(result.success).toBe(true);
    expect(titleOf("edit")).toBe("feat(dashboard-api): Phases 1–2");
  });

  it("updates a re-shipped phase's record instead of listing it twice", async () => {
    // 005 phase 4 was shipped twice. A second run must not make the PR claim
    // "Phases 1, 2, 2" or list the same tasks over again.
    const { titleOf, body } = await runPrCi({
      phaseId: "phase-02",
      existingPr: "21",
      existingBody:
        '<!-- gwrk:pr {"phases":[{"id":"phase-01","gate":"PASS","review":"GO"},{"id":"phase-02","gate":"PASS","review":"GO"}]} -->',
    });

    expect(titleOf("edit")).toBe("feat(dashboard-api): Phases 1–2");
    expect(JSON.parse(body.match(/<!-- gwrk:pr (.*?) -->/)![1]).phases).toHaveLength(2);
    expect(body.match(/### Phase 2 /g)).toHaveLength(1);
  });

  it("reports the real review verdict instead of asserting GO", async () => {
    // The body hardcodes "Code review: GO" / "UAT: GO" unconditionally. 005's
    // own history has `review: UAT Phase 01 - NO-GO` inside a PR claiming GO.
    const { body } = await runPrCi({
      phaseId: "phase-01",
      existingPr: "",
      gateResult: "PASS",
      reviewVerdict: "NO-GO",
    });

    expect(body).not.toContain("Code review: GO");
    expect(body).toContain("NO-GO");
  });
});
