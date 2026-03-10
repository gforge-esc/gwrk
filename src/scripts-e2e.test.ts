import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MOCKS_DIR = path.join(ROOT, ".test-mocks-ship");
const SPEC_DIR = path.join(ROOT, "specs/999-ship-e2e");

const mockWrapper = (scriptName: string, content: string) => {
  const file = path.join(MOCKS_DIR, scriptName);
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${content}\n`);
  fs.chmodSync(file, "755");
  return file;
};

describe("work-until-done.sh execution flow", () => {
  let branchMock = "";
  let verdictMock = "";
  let agentMock = "";
  let env: Record<string, string>;

  beforeAll(() => {
    fs.mkdirSync(MOCKS_DIR, { recursive: true });
    fs.mkdirSync(SPEC_DIR, { recursive: true });

    branchMock = mockWrapper("ship-branch.sh", "echo 'mock branch'");
    verdictMock = mockWrapper(
      "ship-verdict.sh",
      "echo 'mock verdict' && exit 0",
    );
    agentMock = mockWrapper("agent-run.sh", "echo 'mock agent' && exit 0");
    mockWrapper("gh", "echo '1234'"); // mocked gh pr
    mockWrapper("gwrk", "exit 0"); // mocked gwrk db
    mockWrapper("git", "echo 'mock git'"); // mocked git

    env = {
      ...process.env,
      AGENT_RUNNER_BIN: agentMock,
      WUD_VERDICT_BIN: verdictMock,
      WUD_BRANCH_BIN: branchMock,
      WUD_CI_WAIT_BIN: mockWrapper("ship-ci-wait.sh", "exit 0"),
      PATH: `${MOCKS_DIR}:${process.env.PATH}`,
      MAX_ITERATIONS: "1",
      RUNS_DIR: path.join(ROOT, ".test-runs-e2e"),
    };
  });

  const cleanupState = () => {
    fs.rmSync(path.join(ROOT, ".test-runs-e2e"), {
      recursive: true,
      force: true,
    });
  };

  beforeAll(() => {
    cleanupState();
  });

  afterAll(() => {
    fs.rmSync(MOCKS_DIR, { recursive: true, force: true });
    fs.rmSync(SPEC_DIR, { recursive: true, force: true });
    cleanupState();
  });

  it("should complete a full execution loop without unbound variables", () => {
    // Run the actual target script with mocked tools
    const wudScript = path.join(ROOT, "scripts/dev/work-until-done.sh");
    try {
      const result = execFileSync(wudScript, ["999-ship-e2e", "1"], {
        env,
        encoding: "utf-8",
      });
      expect(result).toContain("DONE in");
    } catch (err: any) {
      if (err.stdout) console.log(err.stdout);
      if (err.stderr) console.error(err.stderr);
      throw err;
    }
  });

  it("should fail gracefully if the agent exits non-zero", () => {
    // override the agent mock to fail
    const failingAgent = mockWrapper("failing-agent.sh", "exit 1");
    try {
      execFileSync(
        path.join(ROOT, "scripts/dev/work-until-done.sh"),
        ["999-ship-e2e", "1"],
        {
          env: { ...env, AGENT_RUNNER_BIN: failingAgent },
          encoding: "utf-8",
        },
      );
      expect.fail("Should have thrown");
    } catch (err: any) {
      const output = `${err.stdout || ""}\n${err.stderr || ""}`;
      expect(output).toContain("✗ WORK UNTIL DONE — FAILED");
      expect(err.status).toBe(1);
    }
  });

  it("should handle dry-run gracefully", () => {
    const result = execFileSync(
      path.join(ROOT, "scripts/dev/work-until-done.sh"),
      ["999-ship-e2e", "1"],
      {
        env: { ...env, DRY_RUN: "true" },
        encoding: "utf-8",
      },
    );
    expect(result).toContain("[DRY RUN]");
    expect(result).toContain("1. Branch setup");
  });
});
