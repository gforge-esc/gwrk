/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A GitHub hiccup must not throw away a 45-minute run.
 *
 * 005-dashboard-api Phase 7 completed everything — implement, both reviews after
 * a real NO-GO/iterate cycle, the PR, and green CI in 9s — then died at the last
 * step on:
 *
 *   GraphQL: Something went wrong while executing your query on
 *   2026-08-10T15:41:42Z. Please include `CE07:18D2C9:…` when reporting this issue.
 *
 * That is GitHub's own 502-class error, not a CI verdict. #169 classified three
 * outcomes — no required checks, no checks, real failure — and folded server
 * transience into the third, so the run exited 1 with a passing PR.
 *
 * Retry is scoped deliberately: only errors that are recognisably GitHub's
 * infrastructure or a rate limit. A CI verdict is never retried, because retrying
 * it would double the wait and could mask a genuine red.
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
  phaseId: "phase-07",
  backend: "claude",
  maxIterations: 3,
  ciTimeout: 30,
  cwd: "/mock/cwd",
};

const taskState = {
  featureId: "005-dashboard-api",
  createdAt: "2026-08-10T00:00:00.000Z",
  phases: [
    {
      id: "phase-07",
      title: "trust envelope",
      tasks: [
        {
          id: "T007",
          title: "trust envelope",
          description: "d",
          status: "completed" as const,
          gateScript: "gates/T007-gate.sh",
        },
      ],
    },
  ],
};

/** The verbatim error that killed run #2631. */
const GRAPHQL_TRANSIENT =
  "GraphQL: Something went wrong while executing your query on 2026-08-10T15:41:42Z. Please include `CE07:18D2C9:19468E0:54D4164:6A79F135` when reporting this issue.";

/**
 * Drive the real PR_CI stage, scripting each successive `gh pr checks` call.
 *
 * @param outcomes one entry per expected invocation; a string resolves, an Error throws
 */
async function runPrCi(outcomes: (string | Error)[]) {
  const checkCommands: string[] = [];
  vi.mocked(execSync).mockImplementation(((cmd: string) => {
    const c = String(cmd);
    if (c.includes("gh pr checks")) {
      const next = outcomes[checkCommands.length] ?? "ok";
      checkCommands.push(c);
      if (next instanceof Error) throw next;
      return next;
    }
    if (c.includes("git status --porcelain")) return "";
    if (c.includes("gh pr list")) return "";
    if (c.includes("gh pr create")) return "https://github.com/o/r/pull/31";
    if (c.includes("gh pr view")) return "https://github.com/o/r/pull/31";
    return "";
  }) as unknown as typeof execSync);

  const orchestrator = new ShipOrchestrator(config as never);
  (orchestrator as unknown as { state: Record<string, unknown> }).state.branchName =
    "feat/005-dashboard-api";
  // Keep the suite fast and deterministic — the backoff itself is not the contract.
  (orchestrator as unknown as { sleep: (ms: number) => Promise<void> }).sleep =
    () => Promise.resolve();

  const result = await (
    orchestrator as unknown as { stagePrCi: () => Promise<{ success: boolean }> }
  ).stagePrCi();

  return { result, attempts: checkCommands.length, checkCommands };
}

describe("PR_CI resilience to GitHub transience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(state.loadTaskState).mockReturnValue(taskState as never);
  });

  it("survives the GraphQL error that killed run #2631", async () => {
    const { result } = await runPrCi([new Error(GRAPHQL_TRANSIENT), "all checks pass"]);

    expect(result.success).toBe(true);
  });

  it("retries rather than treating transience as a verdict", async () => {
    const { attempts } = await runPrCi([new Error(GRAPHQL_TRANSIENT), "ok"]);

    expect(attempts).toBe(2);
  });

  it("gives up after exhausting retries, instead of looping forever", async () => {
    const { result, attempts } = await runPrCi([
      new Error(GRAPHQL_TRANSIENT),
      new Error(GRAPHQL_TRANSIENT),
      new Error(GRAPHQL_TRANSIENT),
      new Error(GRAPHQL_TRANSIENT),
      new Error(GRAPHQL_TRANSIENT),
    ]);

    expect(result.success).toBe(false);
    expect(attempts).toBeLessThanOrEqual(4);
  });

  it("never retries a real CI failure", async () => {
    // Retrying a verdict would double the wait and could mask a genuine red.
    const { result, attempts } = await runPrCi([
      new Error("Some checks were not successful"),
      "ok",
    ]);

    expect(result.success).toBe(false);
    expect(attempts).toBe(1);
  });

  it("retries a secondary rate limit", async () => {
    const { result } = await runPrCi([
      new Error("You have exceeded a secondary rate limit. Please wait a few minutes"),
      "ok",
    ]);

    expect(result.success).toBe(true);
  });

  it("retries a gateway error", async () => {
    const { result } = await runPrCi([
      new Error("HTTP 502: Bad Gateway (https://api.github.com/graphql)"),
      "ok",
    ]);

    expect(result.success).toBe(true);
  });

  it("retries a dropped connection", async () => {
    const { result } = await runPrCi([new Error("read ECONNRESET"), "ok"]);

    expect(result.success).toBe(true);
  });

  it("still escalates past --required when transience clears", async () => {
    // The #169 fallback and the retry must compose: a hiccup on the required
    // query, then "none required", then a green all-checks wait.
    const { result, checkCommands } = await runPrCi([
      new Error(GRAPHQL_TRANSIENT),
      new Error("no required checks reported on the 'feat/x' branch"),
      "all checks pass",
    ]);

    expect(result.success).toBe(true);
    expect(checkCommands[2]).not.toContain("--required");
  });
});
