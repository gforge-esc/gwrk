/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";

export class GitManager {
  constructor(private projectRoot: string) {}

  private exec(cmd: string): string {
    return execSync(cmd, {
      cwd: this.projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  createPhaseBranch(featureId: string, phaseId: string): string {
    const featureBranch = `feature/${featureId}-wip`;
    const phaseBranch = `phase/${featureId}-${phaseId}`;

    try {
      this.exec(`git rev-parse --verify ${phaseBranch}`);
      return phaseBranch;
    } catch {
      // Branch doesn't exist
    }

    try {
      this.exec(`git rev-parse --verify ${featureBranch}`);
    } catch {
      throw new Error(`Source feature branch ${featureBranch} not found`);
    }

    this.exec(`git branch ${phaseBranch} ${featureBranch}`);
    return phaseBranch;
  }

  mergePhaseBack(featureId: string, phaseId: string): void {
    const featureBranch = `feature/${featureId}-wip`;
    const phaseBranch = `phase/${featureId}-${phaseId}`;
    const currentBranch = this.exec("git rev-parse --abbrev-ref HEAD");

    try {
      this.exec(`git checkout ${featureBranch}`);
      this.exec(`git merge ${phaseBranch} --no-ff -m "Merge ${phaseBranch}"`);
    } catch (e) {
      // If merge fails, it might leave the repo in a dirty state.
      // We should probably abort the merge if we want to return to currentBranch safely.
      try {
        this.exec("git merge --abort");
      } catch {
        // ignore
      }
      throw new Error(
        `Merge conflict detected while merging ${phaseBranch} into ${featureBranch}`,
      );
    } finally {
      this.exec(`git checkout ${currentBranch}`);
    }
  }

  isClean(): boolean {
    try {
      const status = this.exec("git status --porcelain");
      return status === "";
    } catch {
      return false;
    }
  }

  deleteBranch(branchName: string): void {
    try {
      this.exec(`git branch -D ${branchName}`);
    } catch {
      // ignore
    }
  }
}
