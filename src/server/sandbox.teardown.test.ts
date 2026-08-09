/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A worktree must be released before it is removed.
 *
 * `worktree.setup` provisions a fresh worktree (`make worktree:init`), which in
 * a Docker project starts a compose stack bind-mounting that directory. There
 * was no counterpart on the way out: `destroySandbox` went straight to
 * `git worktree remove --force`, Docker still held `node_modules`, and removal
 * failed with `Permission denied`. Observed on 005-dashboard-api, and it is why
 * sandbox stacks were found still running after 2–4 days.
 *
 * Teardown is best-effort: a project whose teardown fails must not keep the
 * worktree forever, so removal still runs.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxManager } from "./sandbox.js";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));
vi.mock("node:fs", () => ({
  default: { existsSync: vi.fn(), mkdirSync: vi.fn(), rmSync: vi.fn(), readdirSync: vi.fn() },
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  readdirSync: vi.fn(),
}));

const WORKDIR = "/test/root/.runs/sandboxes/005-dashboard-api-ship-2e1346a7";

describe("sandbox teardown before worktree removal", () => {
  let sandbox: SandboxManager;
  let commands: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    sandbox = new SandboxManager("/test/root");
    commands = [];
    (fs.existsSync as Mock).mockReturnValue(true);
    (execSync as Mock).mockImplementation((cmd: string) => {
      commands.push(String(cmd));
      return "";
    });
  });

  const indexOfMatch = (re: RegExp) => commands.findIndex((c) => re.test(c));

  it("runs the configured teardown before removing the worktree", async () => {
    await sandbox.destroySandbox(WORKDIR, "005-dashboard-api", {
      autoCommitPush: false,
      teardown: "make worktree:down",
    });

    const teardownAt = indexOfMatch(/make worktree:down/);
    const removeAt = indexOfMatch(/worktree remove/);

    expect(teardownAt).toBeGreaterThanOrEqual(0);
    expect(removeAt).toBeGreaterThanOrEqual(0);
    expect(teardownAt).toBeLessThan(removeAt);
  });

  it("runs teardown inside the worktree, where its compose project lives", async () => {
    await sandbox.destroySandbox(WORKDIR, "005-dashboard-api", {
      autoCommitPush: false,
      teardown: "make worktree:down",
    });

    const call = (execSync as Mock).mock.calls.find(([cmd]) =>
      /make worktree:down/.test(String(cmd)),
    );
    expect(call?.[1]).toMatchObject({ cwd: WORKDIR });
  });

  it("still removes the worktree when teardown fails", async () => {
    (execSync as Mock).mockImplementation((cmd: string) => {
      commands.push(String(cmd));
      if (/make worktree:down/.test(String(cmd))) {
        throw new Error("compose: no such project");
      }
      return "";
    });

    await sandbox.destroySandbox(WORKDIR, "005-dashboard-api", {
      autoCommitPush: false,
      teardown: "make worktree:down",
    });

    expect(indexOfMatch(/worktree remove/)).toBeGreaterThanOrEqual(0);
  });

  it("issues no teardown when the project configures none", async () => {
    await sandbox.destroySandbox(WORKDIR, "005-dashboard-api", {
      autoCommitPush: false,
    });

    expect(indexOfMatch(/worktree remove/)).toBeGreaterThanOrEqual(0);
    expect(commands.filter((c) => /make /.test(c))).toEqual([]);
  });
});
