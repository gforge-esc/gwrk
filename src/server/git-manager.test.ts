/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fixtureGit } from "../../tests/helpers/server-fixture.js";
import { GitManager } from "./git-manager.js";

describe("GitManager", () => {
  let tempDir: string;
  let gitManager: GitManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-git-test-"));
    fixtureGit(tempDir, "init", "--template=", "--initial-branch=develop");
    fixtureGit(tempDir, "config", "user.name", "Gwrk Test");
    fixtureGit(tempDir, "config", "user.email", "gwrk-test@example.invalid");
    fixtureGit(tempDir, "config", "commit.gpgsign", "false");
    // Need a commit to have a branch
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Test Repo");
    fixtureGit(tempDir, "add", "README.md");
    fixtureGit(tempDir, "commit", "-m", "Initial commit");

    gitManager = new GitManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("should create a phase branch from a feature branch", () => {
    const featureId = "001-cli-core";
    const phaseId = "phase-01";
    const featureBranch = `feature/${featureId}-wip`;
    const phaseBranch = `phase/${featureId}-${phaseId}`;

    fixtureGit(tempDir, "checkout", "-b", featureBranch);

    const createdBranch = gitManager.createPhaseBranch(featureId, phaseId);
    expect(createdBranch).toBe(phaseBranch);

    const branches = fixtureGit(tempDir, "branch");
    expect(branches).toContain(phaseBranch);
  });

  it("should detect merge conflicts", () => {
    const featureId = "001-cli-core";
    const phaseId = "phase-01";
    const featureBranch = `feature/${featureId}-wip`;
    const phaseBranch = `phase/${featureId}-${phaseId}`;

    // Setup feature branch with a file
    fixtureGit(tempDir, "checkout", "-b", featureBranch);
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "feature content");
    fixtureGit(tempDir, "add", "conflict.txt");
    fixtureGit(tempDir, "commit", "-m", "Feature commit");

    // Create phase branch
    gitManager.createPhaseBranch(featureId, phaseId);

    // Modify file in feature branch
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "feature modified");
    fixtureGit(tempDir, "add", "conflict.txt");
    fixtureGit(tempDir, "commit", "-m", "Feature modified");

    // Modify same file in phase branch
    fixtureGit(tempDir, "checkout", phaseBranch);
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "phase modified");
    fixtureGit(tempDir, "add", "conflict.txt");
    fixtureGit(tempDir, "commit", "-m", "Phase modified");

    // Try to merge back - should fail with conflict
    expect(() => gitManager.mergePhaseBack(featureId, phaseId)).toThrow(
      /Merge conflict detected/,
    );

    // Check we are back on the original branch or at least not in a merging state
    const status = fixtureGit(tempDir, "status");
    expect(status).not.toContain("merge");
  });
});
