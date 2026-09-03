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
   * Branch to check out in the worktree. Defaults to the daemon's
   * `sandbox/<name>`. Ship passes `feat/<featureId>` so the PR head matches
   * harvest's branch parser. If it already exists, it is checked out (re-ship).
   */
  branchName?: string;
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
  /**
   * Command run inside the worktree to release whatever `setup` started, before
   * the tree is removed — from `.gwrkrc` `worktree.teardown`, e.g.
   * `make worktree:down`. Without it a compose stack bind-mounting the worktree
   * keeps holding node_modules and `git worktree remove --force` fails EPERM,
   * stranding both the directory and the stack.
   */
  teardown?: string;
}

/**
 * One sandbox gwrk created, recorded so it stays findable after its worktree is
 * removed — including when the exit path never ran at all.
 */
export interface SandboxRecord {
  /** Stable identity, also the worktree basename. */
  id: string;
  workDir: string;
  featureId: string;
  createdAt: string;
}

export interface PruneResult {
  /** Orphans released and forgotten. */
  pruned: string[];
  /** Sandboxes whose worktree still exists — a run may own them. */
  kept: string[];
  /** Orphans whose teardown failed; their records are retained for a retry. */
  failed: string[];
}

export class SandboxManager {
  private runsDir: string;
  private projectRoot: string;
  /**
   * Registry of created sandboxes. Deliberately OUTSIDE `.runs/sandboxes/`, so
   * it is never mistaken for a worktree by anything scanning that directory.
   */
  private registryPath: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
    this.runsDir = path.join(projectRoot, ".runs", "sandboxes");
    this.registryPath = path.join(projectRoot, ".runs", "sandbox-registry.json");
  }

  /**
   * The identity gwrk hands to `setup` and `teardown`.
   *
   * A project that names its resources from these (e.g.
   * `COMPOSE_PROJECT_NAME=gwrk-$GWRK_SANDBOX_ID`) stays reapable after the
   * worktree is gone. A project that lets the tool infer a name from the
   * directory does not — which is how ~40 containers outlived their sandboxes.
   */
  private hookEnv(id: string, workDir: string, featureId: string) {
    return {
      ...process.env,
      GWRK_SANDBOX_ID: id,
      GWRK_SANDBOX_DIR: workDir,
      GWRK_FEATURE_ID: featureId,
    };
  }

  private readRegistry(): SandboxRecord[] {
    try {
      if (!fs.existsSync(this.registryPath)) return [];
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf-8"));
      return Array.isArray(parsed) ? (parsed as SandboxRecord[]) : [];
    } catch {
      // A corrupt registry must not block sandbox creation; it self-heals on
      // the next write.
      return [];
    }
  }

  private writeRegistry(records: SandboxRecord[]): void {
    try {
      const dir = path.dirname(this.registryPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        this.registryPath,
        JSON.stringify(records, null, 2),
        "utf-8",
      );
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      console.warn(`  ⚠ could not update sandbox registry: ${err.message}`);
    }
  }

  private recordSandbox(record: SandboxRecord): void {
    const records = this.readRegistry().filter((r) => r.id !== record.id);
    records.push(record);
    this.writeRegistry(records);
  }

  private forgetSandbox(workDir: string): void {
    const id = path.basename(workDir);
    const records = this.readRegistry();
    if (!records.some((r) => r.id === id)) return;
    this.writeRegistry(records.filter((r) => r.id !== id));
  }

  /**
   * Release sandboxes whose worktree no longer exists.
   *
   * `destroySandbox` covers the ordinary exit. This covers everything that
   * skips it — SIGKILL, a crashed process, a machine that slept — which is the
   * only way an unreapable stack can appear once identity is stable.
   *
   * Teardown runs from the project root, since the worktree is gone by
   * definition; the project must therefore target the sandbox through
   * `GWRK_SANDBOX_ID` rather than the working directory.
   */
  async pruneOrphans(
    opts: { teardown?: string; dryRun?: boolean } = {},
  ): Promise<PruneResult> {
    const result: PruneResult = { pruned: [], kept: [], failed: [] };
    const records = this.readRegistry();

    const survivors: SandboxRecord[] = [];
    for (const record of records) {
      if (fs.existsSync(record.workDir)) {
        result.kept.push(record.id);
        survivors.push(record);
        continue;
      }

      result.pruned.push(record.id);
      if (opts.dryRun) {
        survivors.push(record);
        continue;
      }

      if (opts.teardown) {
        try {
          execSync(opts.teardown, {
            cwd: this.projectRoot,
            env: this.hookEnv(record.id, record.workDir, record.featureId),
            stdio: "pipe",
          });
        } catch (e: unknown) {
          const err = e instanceof Error ? e : new Error(String(e));
          console.warn(
            `  ⚠ teardown failed for orphan ${record.id}: ${err.message}`,
          );
          // Keep the record so a later prune can retry rather than losing the
          // only handle on the leaked resources.
          result.pruned.pop();
          result.failed.push(record.id);
          survivors.push(record);
          continue;
        }
      }
    }

    if (!opts.dryRun && (result.pruned.length > 0 || result.failed.length > 0)) {
      this.writeRegistry(survivors);
    }
    return result;
  }

  /** Every sandbox gwrk has recorded, live or orphaned. */
  listRecords(): (SandboxRecord & { orphaned: boolean })[] {
    return this.readRegistry().map((r) => ({
      ...r,
      orphaned: !fs.existsSync(r.workDir),
    }));
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
    // The worktree's branch. Defaults to the daemon's per-task sandbox branch;
    // ship passes its own `feat/<feature>` so the PR head matches harvest's
    // branch parser.
    const branchName = opts.branchName ?? `sandbox/${sandboxName}`;

    if (!fs.existsSync(this.runsDir)) {
      fs.mkdirSync(this.runsDir, { recursive: true });
    }

    const baseBranch = opts.baseBranch ?? `feature/${featureId}-wip`;

    // Re-ship safe: if the branch already exists, check it out into the new
    // worktree instead of failing on `-b`.
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify --quiet ${branchName}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    try {
      if (branchExists) {
        execSync(`git worktree add ${workDir} ${branchName}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
      } else {
        // Ensure the base branch exists; otherwise fall back to current HEAD.
        execSync(`git branch --list ${baseBranch}`, { cwd: projectRoot });
        execSync(`git worktree add -b ${branchName} ${workDir} ${baseBranch}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
      }
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
    // Record before setup runs: if setup starts a stack and then throws, the
    // sandbox is already leaking and must be prunable.
    this.recordSandbox({
      id: sandboxName,
      workDir,
      featureId,
      createdAt: new Date().toISOString(),
    });

    if (opts.setup) {
      try {
        execSync(opts.setup, {
          cwd: workDir,
          env: this.hookEnv(sandboxName, workDir, featureId),
          stdio: "pipe",
        });
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

    const { autoCommitPush = true, teardown } = options;
    const projectRoot = path.dirname(path.dirname(this.runsDir));

    // 0. Release what `setup` started, while the worktree still exists.
    //    Best-effort: a failing teardown must not strand the worktree forever,
    //    so removal proceeds either way — but say so, because the usual cause
    //    (a still-running stack holding node_modules) makes removal fail next.
    if (teardown) {
      try {
        execSync(teardown, {
          cwd: workDir,
          env: this.hookEnv(path.basename(workDir), workDir, featureId),
          stdio: "pipe",
        });
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        console.warn(
          `  ⚠ worktree teardown ("${teardown}") failed in ${workDir}: ${err.message}`,
        );
      }
    }

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
      // 6. Forget it — the ordinary exit path; pruneOrphans covers the rest.
      this.forgetSandbox(workDir);
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
