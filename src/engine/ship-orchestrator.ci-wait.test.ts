/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Waiting for CI must degrade, not fail — and must never degrade to "skip".
 *
 * PR_CI ran `gh pr checks --watch --required` but tolerated only the message
 * the NON-required form emits. On a repo without branch protection nothing is
 * marked required, so gh exits 1 with "no **required** checks reported" — which
 * does not contain the substring "no checks reported" — and the error was
 * re-thrown. That killed 005-dashboard-api's run in 0s with green CI.
 *
 * Broadening the guard alone would be worse than the bug: gwrk would then skip
 * CI entirely on every unprotected repo and report success, which is the
 * vacuous-green class 026/027 exist to close. So the wait escalates instead:
 *
 *   --required  →  none required?  →  wait on ALL checks
 *               →  none at all?    →  skip, and say so
 *
 * A protected repo waits on its required checks; an unprotected repo with CI
 * still waits on the checks it has; only a repo with no CI skips.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as fs from "node:fs";
import * as state from "../utils/state.js";
import { execSync } from "node:child_process";

vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn().mockReturnValue("") };
});
vi.mock("../utils/state.js");

const config = {
  featureId: "005-dashboard-api",
  phaseId: "phase-01",
  backend: "claude",
  maxIterations: 3,
  ciTimeout: 30,
  cwd: "/mock/cwd",
};

const taskState = {
  featureId: "005-dashboard-api",
  createdAt: "2026-08-08T00:00:00.000Z",
  phases: [
    {
      id: "phase-01",
      title: "Persistence",
      tasks: [
        {
          id: "T001",
          title: "cdo-push persistence",
          description: "d",
          status: "completed" as const,
          gateScript: "gates/T001-gate.sh",
        },
      ],
    },
  ],
};

/** Error shaped like a failed `gh` invocation. */
const ghError = (message: string) => {
  throw new Error(message);
};

/**
 * Drive the real PR_CI stage with scripted `gh pr checks` behaviour.
 *
 * @param onRequired what the `--required` invocation does
 * @param onAll what the fallback (no `--required`) invocation does
 */
async function runPrCi(
  onRequired: () => string,
  onAll: () => string = () => "",
) {
  const checkCommands: string[] = [];
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    const c = String(cmd);
    if (c.includes("gh pr checks")) {
      checkCommands.push(c);
      return c.includes("--required") ? onRequired() : onAll();
    }
    if (c.includes("git status --porcelain")) return "";
    if (c.includes("gh pr list")) return "";
    if (c.includes("gh pr create")) return "https://github.com/o/r/pull/28";
    if (c.includes("gh pr view")) return "https://github.com/o/r/pull/28";
    return "";
  }) as unknown as typeof execSync);

  const orchestrator = new ShipOrchestrator(config as never);
  (orchestrator as unknown as { state: Record<string, unknown> }).state.branchName =
    "feat/005-dashboard-api";

  const result = await (
    orchestrator as unknown as { stagePrCi: () => Promise<{ success: boolean }> }
  ).stagePrCi();

  return { result, checkCommands };
}

describe("PR_CI check waiting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(state.loadTaskState).mockReturnValue(taskState as never);
  });

  it("waits on all checks when the branch has no required checks", async () => {
    const { result, checkCommands } = await runPrCi(
      () => ghError("no required checks reported on the 'feat/x' branch"),
      () => "all checks passing",
    );

    expect(result.success).toBe(true);
    expect(checkCommands).toHaveLength(2);
    expect(checkCommands[1]).not.toContain("--required");
  });

  it("fails the stage when the fallback finds a genuinely failing check", async () => {
    // The whole point: an unprotected repo must still be gated by its CI.
    const { result } = await runPrCi(
      () => ghError("no required checks reported on the 'feat/x' branch"),
      () => ghError("Some checks were not successful"),
    );

    expect(result.success).toBe(false);
  });

  it("skips only when the repo reports no checks at all", async () => {
    const { result, checkCommands } = await runPrCi(
      () => ghError("no required checks reported on the 'feat/x' branch"),
      () => ghError("no checks reported on the 'feat/x' branch"),
    );

    expect(result.success).toBe(true);
    expect(checkCommands).toHaveLength(2);
  });

  it("does not fall back when required checks exist and pass", async () => {
    const { result, checkCommands } = await runPrCi(() => "required checks pass");

    expect(result.success).toBe(true);
    expect(checkCommands).toHaveLength(1);
    expect(checkCommands[0]).toContain("--required");
  });

  it("does not fall back when required checks exist and fail", async () => {
    // A real required-check failure must not be retried into a softer query.
    const { result, checkCommands } = await runPrCi(() =>
      ghError("Some checks were not successful"),
    );

    expect(result.success).toBe(false);
    expect(checkCommands).toHaveLength(1);
  });
});
