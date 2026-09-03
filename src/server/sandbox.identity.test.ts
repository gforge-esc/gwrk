/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A sandbox must stay nameable after its worktree is gone.
 *
 * `worktree.setup` starts resources the project owns — in a Docker project a
 * compose stack whose project name defaults to the worktree's basename. gwrk
 * then deletes the worktree. From that moment the stack has no name anyone can
 * compute, so nothing can reap it: ~40 orphaned containers and ~12 GB of
 * volumes accumulated across six features on data-dashboard, and clearing them
 * needed hand-written `docker ps | grep` passes.
 *
 * `worktree.teardown` (#168) narrows the window but cannot close it — SIGKILL, a
 * crashed node process and a closed laptop all skip the exit path, and each one
 * mints another unnameable stack.
 *
 * Two things fix the class:
 *   1. gwrk exports a stable identity into BOTH hooks, so the project can name
 *      its resources deterministically instead of inheriting a directory name.
 *   2. gwrk records every sandbox it creates, so an orphan is still discoverable
 *      once its worktree is gone — and teardown can then run from the project
 *      root using that identity.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type Mock, beforeEach, describe, expect, it, vi } from "vitest";
import { SandboxManager } from "./sandbox.js";

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));
vi.mock("node:fs", () => {
  const m = {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
  return { default: m, ...m };
});

const ROOT = "/test/root";
const REGISTRY = path.join(ROOT, ".runs", "sandbox-registry.json");

/** The env a hook was invoked with. */
function envOf(match: RegExp): Record<string, string> | undefined {
  const call = (execSync as Mock).mock.calls.find(([cmd]) =>
    match.test(String(cmd)),
  );
  return (call?.[1] as { env?: Record<string, string> } | undefined)?.env;
}

function cwdOf(match: RegExp): string | undefined {
  const call = (execSync as Mock).mock.calls.find(([cmd]) =>
    match.test(String(cmd)),
  );
  return (call?.[1] as { cwd?: string } | undefined)?.cwd;
}

/** What the manager last wrote to the registry. */
function registryWritten(): { id: string; workDir: string }[] | undefined {
  const calls = (fs.writeFileSync as Mock).mock.calls.filter(([p]) =>
    String(p).includes("sandbox-registry"),
  );
  if (calls.length === 0) return undefined;
  return JSON.parse(String(calls[calls.length - 1][1]));
}

describe("sandbox identity and orphan pruning", () => {
  let sandbox: SandboxManager;

  beforeEach(() => {
    vi.clearAllMocks();
    sandbox = new SandboxManager(ROOT);
    (execSync as Mock).mockImplementation((cmd: string) => {
      if (String(cmd).includes("rev-parse --verify")) {
        throw new Error("fatal: unknown revision");
      }
      return "";
    });
    (fs.existsSync as Mock).mockReturnValue(true);
    (fs.readFileSync as Mock).mockReturnValue("[]");
  });

  describe("identity passed to hooks", () => {
    it("gives the setup command a stable id, its directory, and the feature", async () => {
      const workDir = await sandbox.createSandbox({
        featureId: "005-dashboard-api",
        phaseId: "phase-01",
        taskId: "ship",
        projectRoot: ROOT,
        setup: "make worktree:init",
      });

      const env = envOf(/make worktree:init/);
      expect(env?.GWRK_SANDBOX_ID).toBe(path.basename(workDir));
      expect(env?.GWRK_SANDBOX_DIR).toBe(workDir);
      expect(env?.GWRK_FEATURE_ID).toBe("005-dashboard-api");
    });

    it("gives teardown the same id, so it can target what setup created", async () => {
      const workDir = "/test/root/.runs/sandboxes/005-dashboard-api-ship-2e1346a7";

      await sandbox.destroySandbox(workDir, "005-dashboard-api", {
        autoCommitPush: false,
        teardown: "make worktree:down",
      });

      const env = envOf(/make worktree:down/);
      expect(env?.GWRK_SANDBOX_ID).toBe("005-dashboard-api-ship-2e1346a7");
      expect(env?.GWRK_FEATURE_ID).toBe("005-dashboard-api");
    });
  });

  describe("registry", () => {
    it("records a created sandbox, so it survives a skipped teardown", async () => {
      const workDir = await sandbox.createSandbox({
        featureId: "005-dashboard-api",
        phaseId: "phase-01",
        taskId: "ship",
        projectRoot: ROOT,
      });

      expect(registryWritten()).toEqual([
        expect.objectContaining({ id: path.basename(workDir), workDir }),
      ]);
    });

    it("drops the entry once the sandbox is destroyed", async () => {
      (fs.readFileSync as Mock).mockReturnValue(
        JSON.stringify([
          { id: "gone-1", workDir: "/test/root/.runs/sandboxes/gone-1", featureId: "F" },
        ]),
      );

      await sandbox.destroySandbox(
        "/test/root/.runs/sandboxes/gone-1",
        "F",
        { autoCommitPush: false },
      );

      expect(registryWritten()).toEqual([]);
    });
  });

  describe("pruneOrphans", () => {
    const entries = [
      { id: "live-1", workDir: "/test/root/.runs/sandboxes/live-1", featureId: "F" },
      { id: "orphan-1", workDir: "/test/root/.runs/sandboxes/orphan-1", featureId: "F" },
    ];

    beforeEach(() => {
      (fs.readFileSync as Mock).mockReturnValue(JSON.stringify(entries));
      // Only the live sandbox still has a directory. The registry itself exists.
      (fs.existsSync as Mock).mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        if (s === REGISTRY) return true;
        return !s.includes("orphan-1");
      });
    });

    it("tears down only the sandbox whose worktree is gone", async () => {
      const result = await sandbox.pruneOrphans({ teardown: "make worktree:down" });

      expect(result.pruned).toEqual(["orphan-1"]);
      expect(result.kept).toEqual(["live-1"]);
    });

    it("runs teardown from the project root, because the worktree no longer exists", async () => {
      await sandbox.pruneOrphans({ teardown: "make worktree:down" });

      expect(cwdOf(/make worktree:down/)).toBe(ROOT);
      expect(envOf(/make worktree:down/)?.GWRK_SANDBOX_ID).toBe("orphan-1");
    });

    it("removes the pruned entry and keeps the live one", async () => {
      await sandbox.pruneOrphans({ teardown: "make worktree:down" });

      expect(registryWritten()).toEqual([
        expect.objectContaining({ id: "live-1" }),
      ]);
    });

    it("changes nothing under dryRun", async () => {
      const result = await sandbox.pruneOrphans({
        teardown: "make worktree:down",
        dryRun: true,
      });

      expect(result.pruned).toEqual(["orphan-1"]);
      expect((execSync as Mock).mock.calls.filter(([c]) =>
        /worktree:down/.test(String(c)),
      )).toHaveLength(0);
      expect(registryWritten()).toBeUndefined();
    });

    it("still forgets an orphan when the project declares no teardown", async () => {
      // Nothing to run, but the stale record must not accumulate forever.
      const result = await sandbox.pruneOrphans({});

      expect(result.pruned).toEqual(["orphan-1"]);
      expect(registryWritten()).toEqual([
        expect.objectContaining({ id: "live-1" }),
      ]);
    });

    it("keeps the entry when teardown fails, so it can be retried", async () => {
      (execSync as Mock).mockImplementation((cmd: string) => {
        if (/worktree:down/.test(String(cmd))) throw new Error("compose failed");
        return "";
      });

      const result = await sandbox.pruneOrphans({ teardown: "make worktree:down" });

      expect(result.failed).toEqual(["orphan-1"]);
      expect(registryWritten()).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "orphan-1" })]),
      );
    });
  });
});
