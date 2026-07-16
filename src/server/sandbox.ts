/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentBackendId } from "../utils/config.js";
import type { SandboxInfo } from "./types.js";

interface SandboxOptions {
  featureId: string;
  phaseId: string;
  taskId: string;
  backend: AgentBackendId;
  projectRoot: string;
  /** Base branch for the worktree. Defaults to `feature/<featureId>-wip`. */
  baseBranch?: string;
  /**
   * Command run inside the freshly-created worktree to self-provision it
   * (deps, per-worktree .env/ports), e.g. `make worktree:init`. From
   * `.gwrkrc` `worktree.setup`. A fresh worktree has only the committed tree.
   */
  setup?: string;
}

interface DestroyOptions {
  /**
   * When true (default, daemon behavior) a dirty worktree is committed, pushed,
   * and PR'd before removal. Ship sets this false — it owns commit/push/PR via
   * its own PR_CI stage — so destroy only removes the worktree.
   */
  autoCommitPush?: boolean;
}

export class SandboxManager {
  private runsDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.runsDir = path.join(projectRoot, ".runs", "sandboxes");
  }

  async checkGit(): Promise<boolean> {
    try {
      execSync("git --version", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }

  async createSandbox(opts: SandboxOptions): Promise<string> {
    const { featureId, phaseId, taskId, projectRoot } = opts;
    const uuid = crypto.randomUUID().slice(0, 8);
    // Spec format: .runs/sandboxes/<feature>-<task>-<uuid>/
    const sandboxName = `${featureId}-${taskId}-${uuid}`;
    const workDir = path.join(this.runsDir, sandboxName);
    const branchName = `sandbox/${sandboxName}`;

    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    // Create a new worktree with a new branch
    // git worktree add -b <new-branch> <path> <base-branch>
    const baseBranch = opts.baseBranch ?? `feature/${featureId}-wip`;

    try {
      // First ensure the base branch exists locally or we can't create a worktree from it
      execSync(`git branch --list ${baseBranch}`, { cwd: projectRoot });

      execSync(`git worktree add -b ${branchName} ${workDir} ${baseBranch}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (e: unknown) {
      // Fallback to current branch if baseBranch doesn't exist (though it should in gwrk flow)
      try {
        execSync(`git worktree add -b ${branchName} ${workDir}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
      } catch (e2: unknown) {
        const err2 = e2 instanceof Error ? e2 : new Error(String(e2));
        throw new Error(`Failed to create git worktree: ${err2.message}`);
      }
    }

    // Self-provision the fresh worktree (deps, per-worktree .env/ports). A
    // `git worktree add` copies only committed files, so an untracked .env /
    // node_modules must be created here (ADR-005). Non-fatal: a project without
    // a setup command still gets a usable worktree.
    if (opts.setup) {
      try {
        execSync(opts.setup, { cwd: workDir, stdio: "pipe" });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.error(
          `worktree setup ("${opts.setup}") failed in ${workDir}: ${err.message}`,
        );
      }
    }

    return workDir;
  }

  async destroySandbox(
    workDir: string,
    featureId: string,
    options: DestroyOptions = {},
  ): Promise<void> {
    if (!fs.existsSync(workDir)) return;

    const { autoCommitPush = true } = options;
    const projectRoot = path.dirname(path.dirname(this.runsDir));

    try {
      // 1. Check if there are changes
      const status = execSync("git status --porcelain", {
        cwd: workDir,
        encoding: "utf-8",
      }).trim();

      if (status && autoCommitPush) {
        // 2. Commit changes (gwrk agents usually do this, but just in case)
        execSync('git add . && git commit -m "Task contribution" || true', {
          cwd: workDir,
          stdio: "pipe",
        });

        // 3. Push the branch
        execSync("git push origin HEAD", { cwd: workDir, stdio: "pipe" });

        // 4. Create PR via gh CLI
        const branchName = execSync("git rev-parse --abbrev-ref HEAD", {
          cwd: workDir,
          encoding: "utf-8",
        }).trim();

        const baseBranch = `feature/${featureId}-wip`;

        try {
          execSync(
            `gh pr create --base ${baseBranch} --head ${branchName} --title "Task contribution: ${branchName}" --body "Automated PR from gwrk sandbox"`,
            {
              cwd: workDir,
              stdio: "pipe",
            },
          );
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          console.error(`Failed to create PR for ${workDir}: ${err.message}`);
        }
      }

      // 5. Remove worktree
      execSync(`git worktree remove --force ${workDir}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(
        `Error during sandbox destruction for ${workDir}: ${err.message}`,
      );
      // Try to cleanup worktree anyway if it failed midway
      try {
        execSync(`git worktree remove --force ${workDir}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
      } catch {
        // ignore
      }
    }
  }

  async listSandboxes(): Promise<SandboxInfo[]> {
    try {
      const output = execSync("git worktree list --porcelain", {
        encoding: "utf-8",
      });
      const lines = output.split("\n");
      const sandboxes: SandboxInfo[] = [];
      let current: Partial<SandboxInfo> = {};

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          const workDir = line.slice(9);
          if (workDir.includes(".runs/sandboxes/")) {
            current.workDir = workDir;
            // Name is `<featureId>-<taskId>-<uuid>`; featureId itself contains
            // hyphens (e.g. 001-platform-foundation), so parse from the end:
            // last segment = uuid, second-to-last = taskId, the rest = featureId.
            const parts = path.basename(workDir).split("-");
            if (parts.length >= 3) {
              parts.pop(); // uuid
              current.taskId = parts.pop();
              current.featureId = parts.join("-");
            } else {
              current.featureId = parts[0];
              current.taskId = parts[1];
            }
            current.status = "running";
            current.startedAt = new Date().toISOString(); // git gives no start time
          }
        } else if (line.startsWith("branch ") && current.workDir) {
          // could extract branch if needed
        } else if (line === "" && current.workDir) {
          sandboxes.push(current as SandboxInfo);
          current = {};
        }
      }
      return sandboxes;
    } catch {
      return [];
    }
  }

  async pruneSandboxes(): Promise<void> {
    try {
      execSync("git worktree prune", { stdio: "pipe" });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.error(`Failed to prune git worktrees: ${err.message}`);
    }
  }
}
