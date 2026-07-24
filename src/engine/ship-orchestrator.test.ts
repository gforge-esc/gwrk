/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator";
import { ShipStage } from "./ship-types";
import * as fs from "node:fs";
import * as git from "../utils/git";
import * as agent from "../utils/agent";
import * as gateRunner from "../utils/gate-runner";
import * as state from "../utils/state";
import * as reviewPlugin from "../plugins/review-plugin";
import { execSync } from "node:child_process";
import * as testActivator from "./test-activator";


vi.mock("node:fs");
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn().mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("gh pr list")) return "";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      if (typeof cmd === "string" && cmd.includes("gh pr checks")) return "";
      return "";
    }),
  };
});
vi.mock("../utils/git");
vi.mock("../utils/agent");
vi.mock("../utils/gate-runner");
vi.mock("../utils/state");
vi.mock("../plugins/review-plugin");

vi.mock("./test-activator", () => ({
  activatePhaseTests: vi.fn().mockReturnValue({ activated: 0, files: [] }),
}));
vi.mock("../utils/manifest", () => ({
  assembleDigest: vi.fn().mockReturnValue(["mock digest"]),
}));
vi.mock("./profile-detector", () => ({
  detectProfile: vi.fn().mockResolvedValue({ type: "nodejs" }),
}));
vi.mock("./prompt-conditioner", () => ({
  conditionPrompt: vi.fn().mockImplementation((prompt: string) => prompt),
}));

describe("ShipOrchestrator", () => {
  const config = {
    featureId: "004-ship-loop",
    phaseId: "phase-01",
    backend: "gemini",
    maxIterations: 3,
    ciTimeout: 30,
    cwd: "/mock/cwd",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(git.isDirty).mockResolvedValue(false);
    vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue({
      name: "review-cli",
      version: "1.0.0",
      description: "Mock Review Plugin",
      projectType: "cli",
      codeReviewWorkflow: "review-code-cli",
      uatReviewWorkflow: "review-uat-cli",
      steps: {
        code: [],
        uat: []
      }
    });

    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "Desc 1", status: "open", gateScript: "gates/T001-gate.sh" }
          ]
        }
      ]
    });
  });

  it("should initialize with BRANCH_SETUP stage", () => {
    const orchestrator = new ShipOrchestrator(config);
    expect((orchestrator as any).state.stage).toBe(ShipStage.BRANCH_SETUP);
  });

  it("should complete full lifecycle successfully", async () => {
    let callCount = 0;
    vi.mocked(state.loadTaskState).mockImplementation(() => {
      callCount++;
      return {
        featureId: "004-ship-loop",
        createdAt: new Date().toISOString(),
        phases: [{ 
          id: "phase-01", 
          title: "Phase 1", 
          tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: callCount >= 2 ? "completed" : "open", gateScript: "gates/T001-gate.sh" }] 
        }]
      };
    });

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10
    });
    vi.mocked(gateRunner.runGate)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // pre-flight: triggers implement
      .mockResolvedValue({ passed: true, exitCode: 0, output: "Pass" });      // post-flight + reviews: gates pass

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.stage).toBe(ShipStage.DONE);
    expect(git.createBranch).toHaveBeenCalledWith(config.cwd, "feat/004-ship-loop", "develop");
    expect(agent.dispatchToAgent).toHaveBeenCalledTimes(3); // IMPLEMENT + CODE_REVIEW + UAT_REVIEW
  });

  it("TEST_GATE fails (NO-GO) when phase tests execute 0 tests — liveness (ADR-005 §10)", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "implement. Tests: src/foo.test.ts", status: "open", gateScript: "gates/T001-gate.sh" },
          ],
        },
      ],
    });
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("vitest")) return "No test files found, exiting";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    const result = await (orchestrator as any).stageTestGate();
    // Liveness FAIL routes through NO-GO (retry), never advancing to review.
    expect(result.nextStage).not.toBe(ShipStage.CODE_REVIEW);
    expect((orchestrator as any).state.iteration).toBe(2);
  });

  it("TEST_GATE passes when phase tests actually run and pass — liveness", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "implement. Tests: src/foo.test.ts", status: "open", gateScript: "gates/T001-gate.sh" },
          ],
        },
      ],
    });
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("vitest")) return "Tests  5 passed (5)";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    const result = await (orchestrator as any).stageTestGate();
    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });

  it("ACTIVATE_TESTS fails when activated tests are NOT red (pass before impl) — RED evidence (ADR-005 §10.2.3)", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "implement. Tests: src/foo.test.ts", status: "open", gateScript: "gates/T001-gate.sh" },
          ],
        },
      ],
    });
    vi.mocked(testActivator.activatePhaseTests).mockReturnValue({
      activated: 1,
      files: ["src/foo.test.ts"],
    });
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("vitest")) return "Tests  3 passed (3)";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    const result = await (orchestrator as any).stageActivateTests();
    expect(result.success).toBe(false);
  });

  it("ACTIVATE_TESTS proceeds when activated tests ARE red — RED evidence", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "implement. Tests: src/foo.test.ts", status: "open", gateScript: "gates/T001-gate.sh" },
          ],
        },
      ],
    });
    vi.mocked(testActivator.activatePhaseTests).mockReturnValue({
      activated: 1,
      files: ["src/foo.test.ts"],
    });
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (typeof cmd === "string" && cmd.includes("vitest")) return "Tests  2 failed | 1 passed (3)";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    const result = await (orchestrator as any).stageActivateTests();
    expect(result.success).toBe(true);
  });

  it("ACTIVATE_TESTS fails when activated tests execute 0 tests — RED requires liveness (ADR-005 §10.2.1)", async () => {
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "implement. Tests: src/foo.test.ts", status: "open", gateScript: "gates/T001-gate.sh" },
          ],
        },
      ],
    });
    vi.mocked(testActivator.activatePhaseTests).mockReturnValue({
      activated: 1,
      files: ["src/foo.test.ts"],
    });
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      // Suite discovers/executes nothing — testsRun 0. A test that never ran
      // cannot be RED, so ACTIVATE_TESTS must NO-GO, not pass vacuously.
      if (typeof cmd === "string" && cmd.includes("vitest")) return "No test files found, exiting with code 1";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    const result = await (orchestrator as any).stageActivateTests();
    expect(result.success).toBe(false);
  });

  it("runs git + agent in config.cwd (worktree) and honors a custom branchName", async () => {
    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10,
    });
    vi.mocked(gateRunner.runGate)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" }) // pre-flight → implement
      .mockResolvedValue({ passed: true, exitCode: 0, output: "Pass" });

    const wtConfig = {
      ...config,
      cwd: "/mock/worktree",
      branchName: "feat/004-ship-loop-phase-01",
    };
    const orchestrator = new ShipOrchestrator(wtConfig);
    await orchestrator.run();

    // Branch created in the worktree, under the custom (per-phase) name.
    expect(git.createBranch).toHaveBeenCalledWith(
      "/mock/worktree",
      "feat/004-ship-loop-phase-01",
      "develop",
    );
    // The agent runs in the worktree, not process.cwd().
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workDir: "/mock/worktree" }),
    );
  });

  it("should fail-fast if working tree is dirty", async () => {
    vi.mocked(git.isDirty).mockResolvedValue(true);

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(ShipStage.BRANCH_SETUP);
    expect(git.createBranch).not.toHaveBeenCalled();
  });

  it("should skip implementation if pre-flight gate passes", async () => {
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "Pass"
    });
    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10
    });

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    // IMPLEMENT stage should have called runGate but NOT dispatchToAgent for implementation
    expect(gateRunner.runGate).toHaveBeenCalled();
    // 2 calls for reviews (dispatchToAgent), none for implementation
    expect(agent.dispatchToAgent).toHaveBeenCalledTimes(2);
  });

  it("should loop back to IMPLEMENT on NO-GO review", async () => {
    // Gate-driven verdicts: readVerdict runs gates, not agent edits.
    // Sequence: pre-flight FAIL → implement → post-flight PASS → 
    //           code review → readVerdict gate FAIL (NO-GO) → 
    //           retry → pre-flight PASS → implement skipped → post-flight PASS → 
    //           code review → readVerdict gate PASS (GO)
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [{
        id: "phase-01",
        title: "Phase 1",
        tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: "open", gateScript: "gates/T001-gate.sh" }]
      }]
    });

    vi.mocked(agent.dispatchToAgent)
      .mockResolvedValue({ exitCode: 0, stdout: "Success", stderr: "", durationS: 10 });

    vi.mocked(gateRunner.runGate)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // pre-flight iter 1
      .mockResolvedValueOnce({ passed: true, exitCode: 0, output: "Pass" })   // post-flight iter 1
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // readVerdict iter 1 → NO-GO
      .mockResolvedValue({ passed: true, exitCode: 0, output: "Pass" });      // all subsequent pass

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.iteration).toBe(2);
  });

  it("should trip circuit breaker after MAX_ITERATIONS", async () => {
    // Always open = always NO-GO
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [{ id: "phase-01", title: "Phase 1", tasks: [{ id: "T001", title: "Task 1", description: "Desc 1", status: "open", gateScript: "gates/T001-gate.sh" }] }]
    });

    vi.mocked(agent.dispatchToAgent)
      .mockResolvedValue({ exitCode: 0, stdout: "Success", stderr: "", durationS: 10 });

    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: false,
      exitCode: 1,
      output: "Fail"
    });

    const smallConfig = { ...config, maxIterations: 1 };
    const orchestrator = new ShipOrchestrator(smallConfig);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(ShipStage.CIRCUIT_BREAK);
  });

  it("should emit plan:ship:complete when stage becomes DONE", async () => {
    // Mock successful run
    vi.mocked(gateRunner.runGate).mockResolvedValue({
      passed: true,
      exitCode: 0,
      output: "Pass",
    });
    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: "Success",
      stderr: "",
      durationS: 10,
    });
    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          sp_estimate: 5,
          tasks: [
            {
              id: "T001",
              title: "Task 1",
              description: "Desc 1",
              status: "completed",
              gateScript: "gates/T001-gate.sh",
              sp: 5,
            },
          ],
        },
      ],
    });

    const orchestrator = new ShipOrchestrator(config);
    const spy = vi.fn();
    orchestrator.on("plan:ship:complete", spy);

    await orchestrator.run();
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: config.featureId,
        phaseId: config.phaseId,
        sp_actual: 5,
      }),
    );
  });

  it("BUILD_CHECK failure should retry via IMPLEMENT (not exit immediately)", async () => {
    const { execSync } = await import("node:child_process");
    const mockExecSync = vi.mocked(execSync);

    // Give the project a build script so BUILD_CHECK runs (existsSync is true
    // globally, so the pnpm-lock.yaml check resolves the command to `pnpm build`).
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { build: "tsc" } }) as unknown as Buffer,
    );

    // execSync mock: must return strings (not Buffers) because callers
    // like stagePrCi use { encoding: "utf-8" } and call .trim() on the result.
    let buildCallCount = 0;
    mockExecSync.mockImplementation((cmd: string, ..._args: unknown[]) => {
      if (typeof cmd === "string" && cmd.includes("pnpm build")) {
        buildCallCount++;
        if (buildCallCount === 1) {
          const err = new Error("tsc: error TS2345") as Error & { stderr: Buffer };
          err.stderr = Buffer.from("error TS2345: Argument of type 'string'");
          throw err;
        }
        return "";
      }
      if (typeof cmd === "string" && cmd.includes("pnpm test")) {
        return "Tests: 5 passed";
      }
      if (typeof cmd === "string" && cmd.includes("gh pr list")) return "";
      if (typeof cmd === "string" && cmd.includes("gh pr create")) return "https://github.com/mock/pull/42";
      if (typeof cmd === "string" && cmd.includes("gh pr checks")) return "";
      return "";
    });

    vi.mocked(state.loadTaskState).mockImplementation(() => ({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [{
        id: "phase-01",
        title: "Phase 1",
        tasks: [{
          id: "T001", title: "Task 1", description: "Desc 1",
          status: "open",
          gateScript: "gates/T001-gate.sh"
        }]
      }]
    }));

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0, stdout: "Success", stderr: "", durationS: 10
    });

    // Exact runGate call sequence (post-flight never fires because
    // loadTaskState mock returns status:"open", and runPostFlightGates
    // only checks tasks with status:"completed"):
    //
    // #1: pre-flight iter 1 → FAIL (task needs work, triggers dispatch)
    // --- BUILD_CHECK iter 1 fails → handleNoGo → iter 2 ---
    // #2: pre-flight iter 2 → FAIL (build was broken, agent must fix)
    // --- BUILD_CHECK iter 2 passes ---
    // --- TEST_GATE passes (pnpm test via execSync, not runGate) ---
    // #3: readVerdict in CODE_REVIEW → PASS (GO)
    // #4: readVerdict in UAT_REVIEW → PASS (GO)
    vi.mocked(gateRunner.runGate)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // #1
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // #2
      .mockResolvedValueOnce({ passed: true, exitCode: 0, output: "Pass" })   // #3
      .mockResolvedValueOnce({ passed: true, exitCode: 0, output: "Pass" });  // #4

    const orchestrator = new ShipOrchestrator(config);
    const exitCode = await orchestrator.run();

    // Key assertion: should have retried and eventually succeeded
    expect(exitCode).toBe(0);
    expect((orchestrator as any).state.stage).toBe(ShipStage.DONE);
    expect((orchestrator as any).state.iteration).toBe(2);
  });

  it("BUILD_CHECK skips when the project has no build script (cold start)", async () => {
    const { execSync } = await import("node:child_process");
    const mockExecSync = vi.mocked(execSync);

    // No build system at all (early phase of a cold-start project): no
    // package.json, and no cargo/go markers either — getBuildCommand is now
    // polyglot (ADR-005 §11), so "no build" must exclude those too.
    vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
      const s = String(p);
      return (
        !s.endsWith("package.json") &&
        !s.endsWith("Cargo.toml") &&
        !s.endsWith("go.mod")
      );
    });

    const buildCalls: string[] = [];
    mockExecSync.mockImplementation((cmd: string, ..._args: unknown[]) => {
      if (typeof cmd === "string" && cmd.includes("build")) buildCalls.push(cmd);
      if (typeof cmd === "string" && cmd.includes("gh pr create"))
        return "https://github.com/mock/pull/42";
      return "";
    });

    const orchestrator = new ShipOrchestrator(config);
    await orchestrator.run();

    // No build command was ever executed, and the run advanced past BUILD_CHECK.
    expect(buildCalls).toHaveLength(0);
    expect((orchestrator as any).state.stage).not.toBe(ShipStage.BUILD_CHECK);
  });

  it("BUILD_CHECK failure should trip circuit breaker after maxIterations", async () => {
    const { execSync } = await import("node:child_process");
    const mockExecSync = vi.mocked(execSync);

    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ scripts: { build: "tsc" } }) as unknown as Buffer,
    );

    // Build ALWAYS fails
    mockExecSync.mockImplementation((cmd: string, ..._args: unknown[]) => {
      if (typeof cmd === "string" && cmd.includes("pnpm build")) {
        const err = new Error("tsc error") as Error & { stderr: Buffer };
        err.stderr = Buffer.from("error TS2345");
        throw err;
      }
      return Buffer.from("");
    });

    vi.mocked(state.loadTaskState).mockReturnValue({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [{
        id: "phase-01",
        title: "Phase 1",
        tasks: [{
          id: "T001", title: "Task 1", description: "Desc 1",
          status: "open",
          gateScript: "gates/T001-gate.sh"
        }]
      }]
    });

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0, stdout: "Success", stderr: "", durationS: 10
    });

    // Exact runGate call sequence (maxIterations=2):
    // Post-flight never fires (loadTaskState mock returns status:"open").
    //
    // #1: pre-flight iter 1 → FAIL → dispatch agent
    // --- BUILD_CHECK iter 1 fails → handleNoGo → iter 2 ---
    // #2: pre-flight iter 2 → FAIL → dispatch agent
    // --- BUILD_CHECK iter 2 fails → handleNoGo → iter 3 > maxIterations → CIRCUIT_BREAK ---
    vi.mocked(gateRunner.runGate)
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" })  // #1
      .mockResolvedValueOnce({ passed: false, exitCode: 1, output: "Fail" }); // #2

    const smallConfig = { ...config, maxIterations: 2 };
    const orchestrator = new ShipOrchestrator(smallConfig);
    const exitCode = await orchestrator.run();

    expect(exitCode).toBe(1);
    expect((orchestrator as any).state.stage).toBe(ShipStage.CIRCUIT_BREAK);
  });

  describe("runIntegrationGate (021 FR-009 / ADR-005 §10.4)", () => {
    const phaseWithDoneWhen = (doneWhen: string[]) => ({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      phases: [
        {
          id: "phase-01",
          title: "P1",
          tasks: [{ id: "T001", title: "t", description: "", status: "open" }],
          doneWhen,
        },
      ],
    });

    it("passes (null) when an integration target runs tests that pass", async () => {
      vi.mocked(state.loadTaskState).mockReturnValue(phaseWithDoneWhen(["make test:auth"]) as any);
      vi.mocked(execSync).mockReturnValue("Tests  5 passed (5)" as any);
      const orchestrator = new ShipOrchestrator(config);
      expect(await (orchestrator as any).runIntegrationGate()).toBeNull();
    });

    it("NO-GO when the integration target executes 0 tests (opaque wrapper / hidden counts)", async () => {
      vi.mocked(state.loadTaskState).mockReturnValue(phaseWithDoneWhen(["make test:auth"]) as any);
      vi.mocked(execSync).mockReturnValue("Done. Nothing to report." as any);
      const orchestrator = new ShipOrchestrator(config);
      const iterBefore = (orchestrator as any).state.iteration;
      const result = await (orchestrator as any).runIntegrationGate();
      // Intervened (non-null), did NOT advance to review, and routed to a NO-GO
      // retry (handleNoGo bumps the iteration counter).
      expect(result).not.toBeNull();
      expect(result?.nextStage).not.toBe(ShipStage.CODE_REVIEW);
      expect((orchestrator as any).state.iteration).toBeGreaterThan(iterBefore);
    });

    it("dormant (null) when the phase has no integration Done-When target", async () => {
      vi.mocked(state.loadTaskState).mockReturnValue(
        phaseWithDoneWhen(["echo done", "test -f src/x.js"]) as any,
      );
      const orchestrator = new ShipOrchestrator(config);
      expect(await (orchestrator as any).runIntegrationGate()).toBeNull();
    });
  });
});
