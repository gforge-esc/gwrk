/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execAsync = promisify(exec);
const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

async function runCli(
  args: string,
  cwd?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execAsync(`node ${CLI_PATH} ${args}`, {
      cwd,
    });
    return { stdout, stderr, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout || "",
      stderr: e.stderr || "",
      exitCode: e.code || 1,
    };
  }
}

describe("Pulse E2E", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-e2e-"));
    execSync("git init", { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, "file1.ts"), "content1\n");
    execSync("git add -A", { cwd: repoDir });
    execSync('git commit -m "initial"', { cwd: repoDir });

    fs.writeFileSync(path.join(repoDir, "file2.ts"), "content2\n");
    execSync("git add -A", { cwd: repoDir });
    execSync('git commit -m "second"', { cwd: repoDir });
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("VR-001: gwrk measure pulse scan <path> --json outputs valid JSON", async () => {
    const { stdout, exitCode } = await runCli(
      `measure pulse scan ${repoDir} --json`,
    );
    expect(exitCode).toBe(0);

    const snapshot = JSON.parse(stdout);
    expect(snapshot.repoName).toBe(path.basename(repoDir));
    expect(snapshot.mainLoc).toBeGreaterThan(0);
    expect(Array.isArray(snapshot.weeklyBuckets)).toBe(true);
  });

  it("VR-001: gwrk measure pulse scan <path> outputs terminal table", async () => {
    const { stdout, exitCode } = await runCli(`measure pulse scan ${repoDir}`);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Repository:");
    expect(stdout).toContain("Branch:");
    expect(stdout).toContain("LOC:");
  });

  it("VR-004: determinism — two runs produce identical JSON output", async () => {
    const { stdout: out1 } = await runCli(
      `measure pulse scan ${repoDir} --json`,
    );
    const { stdout: out2 } = await runCli(
      `measure pulse scan ${repoDir} --json`,
    );

    const s1 = JSON.parse(out1);
    const s2 = JSON.parse(out2);

    s1.scannedAt = undefined;
    s2.scannedAt = undefined;

    expect(s1).toEqual(s2);
  });

  it("gwrk measure pulse (multi-repo) reads from config", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-project-"));
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
      pulse: { repos: [repoDir] },
    };
    fs.writeFileSync(
      path.join(projectDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    // We need to be in the projectDir so it finds the config
    const { stdout, exitCode } = await runCli("measure pulse", projectDir);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("GWRK PULSE SNAPSHOT");
    expect(stdout).toContain(path.basename(repoDir));

    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("VR-002: negative test — non-git-repo path returns exit code 1", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-not-git-"));
    try {
      const { stderr, exitCode } = await runCli(
        `measure pulse scan ${tempDir}`,
      );
      expect(exitCode).toBe(1);
      expect(stderr).toContain("Not a git repository");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("VR-003: negative test — missing pulse.repos returns exit code 1", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-no-config-"),
    );
    const config = {
      project: { name: "test-project" },
      agents: { define: "gemini", implement: "codex-cloud" },
      // missing pulse key
    };
    fs.writeFileSync(
      path.join(projectDir, ".gwrkrc.json"),
      JSON.stringify(config),
    );

    const { stderr, exitCode } = await runCli("measure pulse", projectDir);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("No repositories tracked");

    fs.rmSync(projectDir, { recursive: true, force: true });
  });
});
