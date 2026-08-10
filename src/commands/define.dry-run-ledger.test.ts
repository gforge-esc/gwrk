/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A dry run must leave no trace in the execution ledger.
 *
 * Every `define` command calls `startRun` in its banner/setup block, before
 * anything consults `--dry-run`. The orchestrator then correctly no-ops each
 * stage, so nothing is dispatched — but the run row is already written, and
 * because the command returns before `finishRun`, it stays open forever with a
 * NULL exit_code.
 *
 * Observed as row 2657: "the net cost was one abandoned run record."
 *
 * The row is not inert. `runs` is what harvest correlates against and what
 * `getShippedPhases` reads; an unfinished row for work that never happened is
 * exactly the kind of false evidence #173 had to filter out. A preview that
 * writes to the ledger is not a preview.
 *
 * Note the dry-run gate AFTER `runLoop` in specify.ts is correct and must stay:
 * the orchestrator's per-stage no-op is what PRINTS the preview, so the loop has
 * to be entered. Only the ledger write is misplaced.
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as runs from "../db/runs.js";

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(4242),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));
vi.mock("../engine/define-orchestrator.js", () => ({
  DefineOrchestrator: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    run: vi.fn().mockResolvedValue(0),
    runLoop: vi.fn().mockResolvedValue(0),
  })),
}));
vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({ handleDefineComplete: vi.fn() })),
}));
vi.mock("../utils/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ agents: { define: "claude" } }),
}));
vi.mock("../utils/resolve-model.js", () => ({
  resolveModelForTask: vi.fn().mockReturnValue("default"),
}));
vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockReturnValue("012-data-health"),
}));
vi.mock("../utils/project-id.js", () => ({
  resolveProjectId: vi.fn().mockReturnValue("proj"),
}));
vi.mock("../utils/output.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readStdin: vi.fn().mockResolvedValue(""),
}));

describe("define --dry-run leaves the ledger alone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  /**
   * Mount the command under its REAL parent.
   *
   * An earlier version of this helper added the subcommand to a bare
   * `new Command()`, which removed the very collision under test: with no
   * `define` parent declaring --dry-run, the flag bound to the subcommand and
   * the test passed while the real CLI silently dropped it. The topology IS the
   * contract here, so the real tree — including program.enablePositionalOptions()
   * — has to be reproduced.
   */
  const parse = async (argv: string[]) => {
    const { defineCommand } = await import("./define.js");
    const program = new Command();
    program.enablePositionalOptions();
    program.addCommand(defineCommand);
    await program.parseAsync(argv, { from: "user" });
  };

  it("writes no run row for `define spec --dry-run`", async () => {
    await parse(["define", "spec", "012", "refine the trust section", "--dry-run"]);

    expect(runs.startRun).not.toHaveBeenCalled();
  });

  it("still writes a run row for a real `define spec`", async () => {
    // The guard must be conditional, not a removal.
    await parse(["define", "spec", "012", "refine the trust section"]);

    expect(runs.startRun).toHaveBeenCalledTimes(1);
  });

  it("writes no run row for the full `define --dry-run` loop", async () => {
    await parse(["define", "012", "--dry-run"]);

    expect(runs.startRun).not.toHaveBeenCalled();
  });
});
