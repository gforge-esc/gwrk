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

const cleanupState = () => {
  const RUNS_DIR = path.join(ROOT, ".test-runs-e2e");
  if (fs.existsSync(RUNS_DIR)) fs.rmSync(RUNS_DIR, { recursive: true, force: true });
  if (fs.existsSync(SPEC_DIR)) fs.rmSync(SPEC_DIR, { recursive: true, force: true });
};

describe("work-until-done.sh execution flow", () => {
  let branchMock = "";
  let verdictMock = "";
  let agentMock = "";
  let env: Record<string, string>;

  beforeAll(() => {
    cleanupState();
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
    mockWrapper("git", [
      'if [[ "$1" == "status" && "$2" == "--porcelain" ]]; then exit 0; fi',
      'if [[ "$1" == "branch" && "$2" == "--show-current" ]]; then echo "feat/999-ship-e2e"; exit 0; fi',
      'if [[ "$1" == "show-ref" ]]; then exit 0; fi',
      'if [[ "$1" == "checkout" ]]; then exit 0; fi',
      'if [[ "$1" == "push" ]]; then exit 0; fi',
      'if [[ "$1" == "ls-remote" ]]; then exit 1; fi',
      'echo "mock git"',
    ].join("\n")); // mocked git

    env = {
      ...process.env,
      AGENT_RUNNER_BIN: agentMock,
      WUD_VERDICT_BIN: verdictMock,
      WUD_BRANCH_BIN: branchMock,
      WUD_CI_WAIT_BIN: mockWrapper("ship-ci-wait.sh", "exit 0"),
      VALIDATE_STAGING_BIN: mockWrapper("validate-staging.sh", "echo 'mock staging ok' && exit 0"),
      PATH: `${MOCKS_DIR}:${process.env.PATH}`,
      MAX_ITERATIONS: "1",
      RUNS_DIR: path.join(ROOT, ".test-runs-e2e"),
    };
  });

  it("should complete a full execution loop without unbound variables", () => {
    const wudScript = path.join(ROOT, "scripts/dev/work-until-done.sh");
    try {
      const result = execFileSync(wudScript, ["999-ship-e2e", "1"], {
        env,
        encoding: "utf-8",
      });
      expect(result).toContain("DONE in");
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      if (e.stdout) console.log(e.stdout);
      if (e.stderr) console.error(e.stderr);
      throw err;
    }
  });

  it("should fail gracefully if the agent exits non-zero", () => {
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
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      const output = `${e.stdout || ""}\n${e.stderr || ""}`;
      // WUD now retries on agent failure; with MAX_ITERATIONS=1 it hits circuit breaker
      expect(output).toContain("will retry");
      expect(e.status).not.toBe(0);
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

  // ─── Phase 1 RED tests (T002, T004) ───────────────────────────────

  it("FR-017/T002: should emit structured events to .events sidecar during run", () => {
    const wudScript = path.join(ROOT, "scripts/dev/work-until-done.sh");
    execFileSync(wudScript, ["999-ship-e2e", "1"], {
      env,
      encoding: "utf-8",
    });
    const sidecarFile = path.join(ROOT, ".test-runs-e2e/999-ship-e2e_p1.events");
    expect(fs.existsSync(sidecarFile)).toBe(true);
    const content = fs.readFileSync(sidecarFile, "utf-8");
    expect(content).toContain("BRANCH_SETUP:");
    expect(content).toContain("IMPLEMENT:");
  });

  it("FR-003/T004: should run pre-flight tasks.json gates before implementation", () => {
    // Create a mock gate script that always passes
    const gateDir = path.join(ROOT, "specs/999-ship-e2e/gates");
    fs.mkdirSync(gateDir, { recursive: true });
    const gateScript = path.join(gateDir, "T001-gate.sh");
    fs.writeFileSync(gateScript, "#!/usr/bin/env bash\nexit 0\n");
    fs.chmodSync(gateScript, "755");

    // Create a mock tasks.json with gate reference
    const gwrkDir = path.join(ROOT, "specs/999-ship-e2e/.gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.writeFileSync(path.join(gwrkDir, "tasks.json"), JSON.stringify({
      featureId: "999-ship-e2e",
      createdAt: new Date().toISOString(),
      phases: [{
        id: "phase-01",
        title: "Phase 1",
        tasks: [{
          id: "T001",
          title: "Test task",
          description: "test",
          status: "open",
          gateScript: "gates/T001-gate.sh",
        }],
      }],
    }));

    const wudScript = path.join(ROOT, "scripts/dev/work-until-done.sh");
    try {
      const result = execFileSync(wudScript, ["999-ship-e2e", "1"], {
        env,
        encoding: "utf-8",
      });
      // WUD should log that it ran the pre-flight gate
      expect(result).toContain("pre-flight");
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      const output = `${e.stdout || ""}\n${e.stderr || ""}`;
      // Even if the run fails, pre-flight should have been attempted
      expect(output).toContain("pre-flight");
    }
  });
});

// ─── Phase 2 RED tests ────────────────────────────────────────────

describe("FR-018/T007: Circuit Breaker failureContext", () => {
  let env: Record<string, string>;
  beforeAll(() => {
    cleanupState();
    fs.mkdirSync(MOCKS_DIR, { recursive: true });
    fs.mkdirSync(SPEC_DIR, { recursive: true });
    env = {
      ...process.env,
      PATH: `${MOCKS_DIR}:${process.env.PATH}`,
      MAX_ITERATIONS: "1",
      RUNS_DIR: path.join(ROOT, ".test-runs-e2e"),
      // Exit 42 (non-zero, non-130) triggers retry path in WUD → circuit break
      AGENT_RUNNER_BIN: mockWrapper("failing-agent.sh", "exit 42"),
      WUD_BRANCH_BIN: mockWrapper("ship-branch.sh", "echo 'mock branch'"),
      WUD_VERDICT_BIN: mockWrapper("ship-verdict.sh", "exit 0"),
      WUD_CI_WAIT_BIN: mockWrapper("ship-ci-wait.sh", "exit 0"),
      VALIDATE_STAGING_BIN: mockWrapper("validate-staging.sh", "exit 0"),
    };
    mockWrapper("gh", "echo '1234'");
    mockWrapper("gwrk", "exit 0");
    mockWrapper("git", [
      'if [[ "$1" == "status" && "$2" == "--porcelain" ]]; then exit 0; fi',
      'if [[ "$1" == "branch" ]]; then echo "feat/999-ship-e2e"; exit 0; fi',
      'echo "mock git"',
    ].join("\n"));
  });

  it("produces failureContext in the JSON state file on CIRCUIT_BREAK", () => {
    try {
      execFileSync(
        path.join(ROOT, "scripts/dev/work-until-done.sh"),
        ["999-ship-e2e", "1"],
        { env, encoding: "utf-8", stdio: "pipe" },
      );
    } catch {
      // Expected to fail with circuit break
    }
    const stateFile = path.join(ROOT, ".test-runs-e2e/999-ship-e2e_p1.state");
    expect(fs.existsSync(stateFile)).toBe(true);
    const state = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    expect(state.stage).toBe("CIRCUIT_BREAK");
    expect(state.failureContext).toBeDefined();
    expect(state.failureContext.digest).toBeDefined();
    expect(state.failureContext.lastVerdict).toBeDefined();
  });
});

describe("FR-002/T005: wud-branch.sh dirty-tree guard", () => {
  beforeAll(() => {
    cleanupState();
    fs.mkdirSync(MOCKS_DIR, { recursive: true });
  });

  it("exits 1 if the working tree is dirty", () => {
    // Mock git to report dirty tree
    const gitContent = [
      '#!/usr/bin/env bash',
      'if [[ "$1" == "status" && "$2" == "--porcelain" ]]; then',
      '  echo " M some-file"',
      '  exit 0',
      'fi',
      'if [[ "$1" == "rev-parse" ]]; then',
      '  echo "/tmp/fake-repo"',
      '  exit 0',
      'fi',
      'echo "mock git"',
      'exit 0',
    ].join('\n');
    mockWrapper("git", gitContent);

    const env = {
      ...process.env,
      PATH: `${MOCKS_DIR}:${process.env.PATH}`,
    };

    try {
      execFileSync(
        path.join(ROOT, "scripts/dev/wud-branch.sh"),
        ["999-ship-e2e"],
        { env, encoding: "utf-8", stdio: "pipe" },
      );
      expect.fail("Should have failed due to dirty tree");
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      expect(e.status).not.toBe(0);
      const out = (e.stderr || "") + (e.stdout || "");
      expect(out).toContain("Dirty working tree");
    }
  });
});

describe("FR-016/T006: validate-staging.sh integration with WUD", () => {
  it("WUD calls validate-staging.sh before push", () => {
    // Read WUD source and check it references validate-staging
    const wudContent = fs.readFileSync(
      path.join(ROOT, "scripts/dev/work-until-done.sh"),
      "utf-8",
    );
    expect(wudContent).toContain("validate-staging");
  });
});
