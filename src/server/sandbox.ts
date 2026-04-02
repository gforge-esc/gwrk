import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AgentBackend } from "../utils/config.js";
import type { SandboxInfo } from "./types.js";

export interface SandboxOptions {
  featureId: string;
  phaseId: string;
  taskId: string;
  backend: AgentBackend;
  projectRoot: string;
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
    // We assume the feature branch is current or we should specify it
    const baseBranch = `feature/${featureId}-wip`;

    try {
      // First ensure the base branch exists locally or we can't create a worktree from it
      execSync(`git branch --list ${baseBranch}`, { cwd: projectRoot });

      execSync(`git worktree add -b ${branchName} ${workDir} ${baseBranch}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (e: any) {
      // Fallback to current branch if baseBranch doesn't exist (though it should in gwrk flow)
      try {
        execSync(`git worktree add -b ${branchName} ${workDir}`, {
          cwd: projectRoot,
          stdio: "pipe",
        });
      } catch (e2: any) {
        throw new Error(`Failed to create git worktree: ${e2.message}`);
      }
    }

    return workDir;
  }

  async destroySandbox(workDir: string, featureId: string): Promise<void> {
    if (!fs.existsSync(workDir)) return;

    const projectRoot = path.dirname(path.dirname(this.runsDir));

    try {
      // 1. Check if there are changes
      const status = execSync("git status --porcelain", {
        cwd: workDir,
        encoding: "utf-8",
      }).trim();

      if (status) {
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
        } catch (e: any) {
          console.error(`Failed to create PR for ${workDir}: ${e.message}`);
        }
      }

      // 5. Remove worktree
      execSync(`git worktree remove --force ${workDir}`, {
        cwd: projectRoot,
        stdio: "pipe",
      });
    } catch (e: any) {
      console.error(
        `Error during sandbox destruction for ${workDir}: ${e.message}`,
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
            const name = path.basename(workDir);
            const parts = name.split("-");
            current.featureId = parts[0];
            current.taskId = parts[1];
            current.status = "running";
            current.startedAt = new Date().toISOString(); // We don't have exact start time from git
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
    } catch (e: any) {
      console.error(`Failed to prune git worktrees: ${e.message}`);
    }
  }
}
