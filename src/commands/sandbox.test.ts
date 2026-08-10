/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The command is thin — `SandboxManager` owns the logic — but two wiring bugs
 * here would make it silently useless: forgetting to pass the project's
 * configured `worktree.teardown` (prune would drop records while releasing
 * nothing), and forgetting to pass `--dry-run` through (a preview that acts).
 */

import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sandboxCommand } from "./sandbox.js";
import * as config from "../utils/config.js";
import { SandboxManager } from "../server/sandbox.js";

vi.mock("../utils/config.js");
vi.mock("../server/sandbox.js", () => ({
  SandboxManager: vi.fn().mockImplementation(() => ({
    pruneOrphans: vi.fn().mockResolvedValue({ pruned: [], kept: [], failed: [] }),
    listRecords: vi.fn().mockReturnValue([]),
  })),
}));

/** The options `prune` handed to SandboxManager.pruneOrphans. */
function pruneArgs() {
  const instance = vi.mocked(SandboxManager).mock.results[0]?.value;
  return instance?.pruneOrphans.mock.calls[0]?.[0];
}

describe("gwrk sandbox prune", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(sandboxCommand);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(config.loadConfig).mockReturnValue({
      worktree: { teardown: "make worktree:down" },
    } as never);
  });

  it("passes the project's configured teardown through", async () => {
    await program.parseAsync(["sandbox", "prune"], { from: "user" });

    expect(pruneArgs()).toMatchObject({ teardown: "make worktree:down" });
  });

  it("passes --dry-run through, so a preview cannot act", async () => {
    await program.parseAsync(["sandbox", "prune", "--dry-run"], {
      from: "user",
    });

    expect(pruneArgs()).toMatchObject({ dryRun: true });
  });

  it("does not invent a teardown when the project configures none", async () => {
    vi.mocked(config.loadConfig).mockReturnValue({} as never);

    await program.parseAsync(["sandbox", "prune"], { from: "user" });

    expect(pruneArgs()?.teardown).toBeUndefined();
  });
});
