/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPulseGitFixture,
  stubPulseGitEnv,
} from "../tests/helpers/pulse-git-fixture.js";
import { runCli as runScopedCli } from "./cli.js";

const execFileAsync = promisify(execFile);
const childTimeoutMs = 10_000;
const CLI_PATH = path.resolve(process.cwd(), "dist/cli.js");

async function runCli(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [CLI_PATH, ...args],
      {
        cwd,
        timeout: childTimeoutMs,
        killSignal: "SIGKILL",
        env: { ...env, GWRK_HOME: path.join(cwd, "gwrk-home") },
      },
    );
    return { stdout, stderr, exitCode: 0 };
  } catch (error) {
    const childError = error as {
      code?: number;
      stdout: string;
      stderr: string;
    };
    if (typeof childError.code !== "number") throw error;
    return {
      stdout: childError.stdout,
      stderr: childError.stderr,
      exitCode: childError.code,
    };
  }
}

async function captureScan(repoDir: string, ...flags: string[]) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runScopedCli(
    ["measure", "pulse", "scan", repoDir, ...flags],
    {
      stdout: (chunk) => {
        stdout += chunk;
      },
      stderr: (chunk) => {
        stderr += chunk;
      },
    },
  );
  return { stdout, stderr, exitCode };
}

describe("Pulse E2E", () => {
  let fixture: Awaited<ReturnType<typeof createPulseGitFixture>>;

  beforeAll(async () => {
    fixture = await createPulseGitFixture("branches");
    stubPulseGitEnv(fixture.env);
    vi.stubEnv("GWRK_HOME", path.join(fixture.repoDir, "gwrk-home"));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fixture?.cleanup();
  });

  it("VR-001: gwrk measure pulse scan <path> --json outputs valid JSON", async () => {
    const { stdout, stderr, exitCode } = await captureScan(
      fixture.repoDir,
      "--json",
    );
    expect(exitCode, stderr).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);

    const snapshot = JSON.parse(stdout);
    expect(snapshot.repoName).toBe(path.basename(fixture.repoDir));
    expect(snapshot.mainLoc).toBe(5);
    expect(snapshot.draftLoc).toBe(2);
    expect(snapshot.weeklyBuckets).toHaveLength(3);
  });

  it("VR-001: gwrk measure pulse scan <path> outputs terminal table", async () => {
    const { stdout, stderr, exitCode } = await captureScan(fixture.repoDir);
    expect(exitCode, stderr).toBe(0);
    expect(stdout).toContain("Repository:");
    expect(stdout).toContain("Branch: main");
    expect(stdout).toContain("LOC:");
    expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);
  });

  it("VR-004: determinism — two runs produce identical JSON output", async () => {
    const first = await captureScan(fixture.repoDir, "--json");
    const second = await captureScan(fixture.repoDir, "--json");
    expect(first.exitCode, first.stderr).toBe(0);
    expect(second.exitCode, second.stderr).toBe(0);

    const { scannedAt: firstScannedAt, ...firstSnapshot } = JSON.parse(
      first.stdout,
    );
    const { scannedAt: secondScannedAt, ...secondSnapshot } = JSON.parse(
      second.stdout,
    );
    expect(firstScannedAt).toEqual(expect.any(String));
    expect(secondScannedAt).toEqual(expect.any(String));
    expect(firstSnapshot).toEqual(secondSnapshot);
  });

  it("gwrk measure pulse (multi-repo) reads from config", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-project-"));
    try {
      const config = {
        project: { name: "test-project" },
        pulse: { repos: [fixture.repoDir] },
      };
      fs.writeFileSync(
        path.join(projectDir, ".gwrkrc.json"),
        JSON.stringify(config),
      );

      const { stdout, stderr, exitCode } = await runCli(
        ["measure", "pulse"],
        projectDir,
        fixture.env,
      );
      expect(exitCode, stderr).toBe(0);
      expect(stdout).toContain("GWRK PULSE SNAPSHOT");
      expect(stdout).toContain(path.basename(fixture.repoDir));
      expect(stdout).toContain("LOC: 5 (Main) / 2 (Draft)");
      expect(stderr).toMatch(/\[exit:0 \| [^\]]+\]/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it("VR-002: non-git-repo path returns exit code 1", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-not-git-"));
    try {
      const { stdout, stderr, exitCode } = await captureScan(tempDir);
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/\[exit:1 \| [^\]]+\].*Not a git repository/);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("VR-003: missing pulse.repos returns exit code 1", async () => {
    const projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-no-config-"),
    );
    try {
      const config = { project: { name: "test-project" } };
      fs.writeFileSync(
        path.join(projectDir, ".gwrkrc.json"),
        JSON.stringify(config),
      );

      const { stdout, stderr, exitCode } = await runCli(
        ["measure", "pulse"],
        projectDir,
        fixture.env,
      );
      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/\[exit:1 \| [^\]]+\].*No repositories tracked/);
    } finally {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
