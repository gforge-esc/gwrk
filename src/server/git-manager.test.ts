import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitManager } from "./git-manager.js";

describe("GitManager", () => {
  let tempDir: string;
  let gitManager: GitManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-git-test-"));
    execSync("git init", { cwd: tempDir, stdio: "ignore" });
    // Need a commit to have a branch
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Test Repo");
    execSync("git add README.md", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Initial commit"', {
      cwd: tempDir,
      stdio: "ignore",
    });
    // Rename main/master to something consistent if needed, but we'll create our feature branch

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

    execSync(`git checkout -b ${featureBranch}`, {
      cwd: tempDir,
      stdio: "ignore",
    });

    const createdBranch = gitManager.createPhaseBranch(featureId, phaseId);
    expect(createdBranch).toBe(phaseBranch);

    const branches = execSync("git branch", {
      cwd: tempDir,
      encoding: "utf-8",
    });
    expect(branches).toContain(phaseBranch);
  });

  it("should detect merge conflicts", () => {
    const featureId = "001-cli-core";
    const phaseId = "phase-01";
    const featureBranch = `feature/${featureId}-wip`;
    const phaseBranch = `phase/${featureId}-${phaseId}`;

    // Setup feature branch with a file
    execSync(`git checkout -b ${featureBranch}`, {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "feature content");
    execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Feature commit"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Create phase branch
    gitManager.createPhaseBranch(featureId, phaseId);

    // Modify file in feature branch
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "feature modified");
    execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Feature modified"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Modify same file in phase branch
    execSync(`git checkout ${phaseBranch}`, { cwd: tempDir, stdio: "ignore" });
    fs.writeFileSync(path.join(tempDir, "conflict.txt"), "phase modified");
    execSync("git add conflict.txt", { cwd: tempDir, stdio: "ignore" });
    execSync('git commit -m "Phase modified"', {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Try to merge back - should fail with conflict
    expect(() => gitManager.mergePhaseBack(featureId, phaseId)).toThrow(
      /Merge conflict detected/,
    );

    // Check we are back on the original branch or at least not in a merging state
    const status = execSync("git status", { cwd: tempDir, encoding: "utf-8" });
    expect(status).not.toContain("merge");
  });
});
