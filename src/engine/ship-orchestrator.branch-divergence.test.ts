/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A branch that cannot be pushed must fail at BRANCH_SETUP, not at PR_CI.
 *
 * On 005-dashboard-api the local `feat/005-dashboard-api` was recreated from
 * develop while a stale `origin/feat/005-dashboard-api` still held two commits.
 * Nothing noticed until PR_CI ran `git push` — after 9m35s of implementation,
 * 5m31s of code review and 3m29s of UAT. The push was rejected non-fast-forward
 * and the whole run was discarded.
 *
 * Every input to that outcome is known before the first agent token, so the
 * check belongs at the start. A branch merely behind its remote is fast-
 * forwarded and the run continues; a genuinely diverged branch stops the run
 * immediately with the remediation.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as git from "../utils/git.js";
import { execSync } from "node:child_process";

vi.mock("../utils/git.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("./test-activator.js");
vi.mock("./profile-detector.js", () => ({
  detectProfile: vi.fn().mockResolvedValue({ type: "nodejs" }),
}));
vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn(), execFileSync: vi.fn() };
});

const config = {
  cwd: "/root",
  featureId: "005-dashboard-api",
  phaseId: "phase-01",
  backend: "claude",
  maxIterations: 3,
  ciTimeout: 30,
};

const BRANCH = "feat/005-dashboard-api";

/**
 * Script git for a branch already checked out locally.
 *
 * @param remoteExists whether `origin/<branch>` is present
 * @param behind commits on the remote that the local branch lacks
 * @param ahead commits on the local branch the remote lacks
 */
function scriptGit(opts: {
  remoteExists: boolean;
  behind: number;
  ahead: number;
}) {
  const commands: string[] = [];
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    const c = String(cmd);
    commands.push(c);
    if (c.includes("rev-parse") && c.includes("refs/remotes/origin/")) {
      if (!opts.remoteExists) throw new Error("fatal: bad revision");
      return "abc123\n";
    }
    // `<branch>..origin/<branch>` — commits the remote has that we do not.
    if (c.includes("rev-list") && /\.\.origin\//.test(c)) return `${opts.behind}\n`;
    // `origin/<branch>..<branch>` — commits we have that the remote does not.
    if (c.includes("rev-list") && /--count\s+origin\//.test(c)) return `${opts.ahead}\n`;
    return "";
  }) as never);
  return commands;
}

async function runBranchSetup() {
  const orchestrator = new ShipOrchestrator(config as never);
  // @ts-ignore private
  return await orchestrator.stageBranchSetup();
}

describe("BRANCH_SETUP remote divergence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(git.isDirty).mockResolvedValue(false);
    vi.mocked(git.getCurrentBranch).mockReturnValue(BRANCH);
  });

  it("stops the run when the remote branch has diverged", async () => {
    const result = await scriptGitAndRun({ remoteExists: true, behind: 2, ahead: 14 });

    expect(result.stage.success).toBe(false);
    expect(result.stage.error).toMatch(/diverge/i);
  });

  it("names the branch and the fix in the error, so it is actionable", async () => {
    const result = await scriptGitAndRun({ remoteExists: true, behind: 2, ahead: 14 });

    expect(result.stage.error).toContain(BRANCH);
  });

  it("fast-forwards a branch that is merely behind and continues", async () => {
    const result = await scriptGitAndRun({ remoteExists: true, behind: 3, ahead: 0 });

    expect(result.stage.success).toBe(true);
    expect(result.commands.some((c) => /merge\s+--ff-only/.test(c))).toBe(true);
  });

  it("proceeds untouched when the branch has no remote counterpart yet", async () => {
    const result = await scriptGitAndRun({ remoteExists: false, behind: 0, ahead: 0 });

    expect(result.stage.success).toBe(true);
    expect(result.commands.some((c) => /merge\s+--ff-only/.test(c))).toBe(false);
  });

  it("proceeds without merging when the local branch is simply ahead", async () => {
    const result = await scriptGitAndRun({ remoteExists: true, behind: 0, ahead: 5 });

    expect(result.stage.success).toBe(true);
    expect(result.commands.some((c) => /merge\s+--ff-only/.test(c))).toBe(false);
  });
});

async function scriptGitAndRun(opts: {
  remoteExists: boolean;
  behind: number;
  ahead: number;
}) {
  const commands = scriptGit(opts);
  const stage = await runBranchSetup();
  return { stage, commands };
}
