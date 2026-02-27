// src/commands/wud.test.ts
// RED tests — Phase 2: WUD state machine
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runWudLoop } from "./wud.js"; // RED — module does not exist yet
import type { GwrkConfig } from "../utils/config.js";

// Mock all dependencies
vi.mock("./implement.js", () => ({
  executePhase: vi.fn(),
}));

vi.mock("../utils/agent.js", () => ({
  dispatchAgent: vi.fn(),
}));

vi.mock("../utils/verdict.js", () => ({
  checkPhaseVerdict: vi.fn(),
}));

vi.mock("../utils/pr.js", () => ({
  createPR: vi.fn(),
  waitForCI: vi.fn(),
}));

vi.mock("../utils/wud-state.js", () => ({
  saveWudState: vi.fn(),
  loadWudState: vi.fn(),
}));

vi.mock("../utils/branch.js", () => ({
  ensureBranch: vi.fn().mockResolvedValue("feat/test"),
  pushBranch: vi.fn(),
}));

vi.mock("../utils/log.js", () => ({
  createWudLogger: vi.fn().mockReturnValue({
    log: vi.fn(),
    banner: vi.fn(),
    close: vi.fn(),
    logPath: "/tmp/test.log",
  }),
}));

import { executePhase } from "./implement.js";
import { dispatchAgent } from "../utils/agent.js";
import { checkPhaseVerdict } from "../utils/verdict.js";
import { createPR, waitForCI } from "../utils/pr.js";
import { saveWudState, loadWudState } from "../utils/wud-state.js";

const mockExecutePhase = vi.mocked(executePhase);
const mockDispatchAgent = vi.mocked(dispatchAgent);
const mockCheckPhaseVerdict = vi.mocked(checkPhaseVerdict);
const mockCreatePR = vi.mocked(createPR);
const mockWaitForCI = vi.mocked(waitForCI);
const mockSaveWudState = vi.mocked(saveWudState);
const mockLoadWudState = vi.mocked(loadWudState);

const testConfig: GwrkConfig = {
  project: { name: "test-project" },
  agents: { define: "gemini", implement: "gemini" },
};

const RUNS_DIR = "/tmp/wud-test-runs";

beforeEach(() => {
  vi.clearAllMocks();
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  mockLoadWudState.mockReturnValue(null); // No prior state
});

afterEach(() => {
  fs.rmSync(RUNS_DIR, { recursive: true, force: true });
});

describe("FR-004: WUD state machine — full lifecycle", () => {
  it("US-003 #1: walks BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE", async () => {
    // Happy path — all stages succeed
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
    });
    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.stage).toBe("DONE");
    expect(result.iteration).toBe(1);
    expect(result.prNumber).toBe(42);

    // Verify state was saved at each transition
    expect(mockSaveWudState).toHaveBeenCalled();
  });

  it("rejects: dry-run mode prints plan without executing", async () => {
    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
      dryRun: true,
    });

    // Should not call any execution functions
    expect(mockExecutePhase).not.toHaveBeenCalled();
    expect(mockDispatchAgent).not.toHaveBeenCalled();
  });
});

describe("FR-005: Review dispatch and NO-GO loop", () => {
  it("US-003 #2: loops back to IMPLEMENTING on code review NO-GO", async () => {
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    // Code review: NO-GO first time, GO second time
    mockCheckPhaseVerdict
      .mockReturnValueOnce({
        verdict: "NO-GO", totalTasks: 3, completedTasks: 2,
        openTasks: [{ id: "T003", title: "Incomplete", status: "open" as const }],
      })
      .mockReturnValueOnce({
        verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
      })
      .mockReturnValue({
        verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
      });

    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
      maxIterations: 3,
    });

    expect(result.stage).toBe("DONE");
    expect(result.iteration).toBeGreaterThanOrEqual(2);
    // executePhase should be called at least twice (re-implement)
    expect(mockExecutePhase).toHaveBeenCalledTimes(2);
  });

  it("US-003 #3: loops back to IMPLEMENTING on UAT review NO-GO", async () => {
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });

    // Code review: always GO
    // UAT review: NO-GO first, GO second
    let verdictCallCount = 0;
    mockCheckPhaseVerdict.mockImplementation(() => {
      verdictCallCount++;
      // Calls 1 (code review GO), 2 (UAT NO-GO), 3 (code review GO), 4 (UAT GO)
      if (verdictCallCount === 2) {
        return {
          verdict: "NO-GO" as const, totalTasks: 3, completedTasks: 2,
          openTasks: [{ id: "T003", title: "UAT fail", status: "open" as const }],
        };
      }
      return {
        verdict: "GO" as const, totalTasks: 3, completedTasks: 3, openTasks: [],
      };
    });

    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
      maxIterations: 3,
    });

    expect(result.stage).toBe("DONE");
    expect(result.iteration).toBeGreaterThanOrEqual(2);
  });
});

describe("FR-006: PR creation and CI gate", () => {
  it("US-006: creates PR via gh pr create --base develop", async () => {
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
    });
    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(mockCreatePR).toHaveBeenCalledWith(
      expect.objectContaining({
        featureName: "004-wud-loop",
        phaseNumber: 1,
      })
    );
    expect(mockWaitForCI).toHaveBeenCalledWith(42, expect.any(Number));
  });
});

describe("FR-007: Circuit breaker", () => {
  it("US-004 #1: exits with CIRCUIT_BREAK after MAX_ITERATIONS exceeded", async () => {
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    // Always NO-GO — forces infinite loop that circuit breaker must catch
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "NO-GO", totalTasks: 3, completedTasks: 1,
      openTasks: [{ id: "T002", title: "Never passes", status: "open" as const }],
    });

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
      maxIterations: 2,
    });

    expect(result.stage).toBe("CIRCUIT_BREAK");
    // State file should record CIRCUIT_BREAK
    expect(mockSaveWudState).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ stage: "CIRCUIT_BREAK" })
    );
  });
});

describe("FR-008: Crash recovery", () => {
  it("US-005 #1: resumes from saved stage on restart", async () => {
    // Simulate: crashed during CODE_REVIEW
    mockLoadWudState.mockReturnValue({
      stage: "CODE_REVIEW",
      iteration: 1,
      feature: "004-wud-loop",
      phase: "1",
      updatedAt: new Date().toISOString(),
    });

    // Code review succeeds this time
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
    });
    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.stage).toBe("DONE");
    // Should NOT have called executePhase — resumed past IMPLEMENTING
    expect(mockExecutePhase).not.toHaveBeenCalled();
  });

  it("US-005 #2: resets terminal states to BRANCH_SETUP on restart", async () => {
    // Previous run ended in DONE — should reset
    mockLoadWudState.mockReturnValue({
      stage: "DONE",
      iteration: 3,
      feature: "004-wud-loop",
      phase: "1",
      updatedAt: new Date().toISOString(),
    });

    // Full happy path
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 3, tasksSkipped: 0, totalTasks: 3, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "GO", totalTasks: 3, completedTasks: 3, openTasks: [],
    });
    mockCreatePR.mockResolvedValue(42);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.stage).toBe("DONE");
    // Should have started fresh — executePhase called
    expect(mockExecutePhase).toHaveBeenCalled();
  });
});

describe("FR-010: WUD run logging", () => {
  it("US-009: run produces log entries", async () => {
    mockExecutePhase.mockResolvedValue({
      tasksCompleted: 1, tasksSkipped: 0, totalTasks: 1, branch: "feat/test",
    });
    mockDispatchAgent.mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" });
    mockCheckPhaseVerdict.mockReturnValue({
      verdict: "GO", totalTasks: 1, completedTasks: 1, openTasks: [],
    });
    mockCreatePR.mockResolvedValue(1);
    mockWaitForCI.mockResolvedValue(true);

    const result = await runWudLoop({
      featureDir: "specs/004-wud-loop",
      phaseNumber: 1,
      config: testConfig,
    });

    expect(result.stage).toBe("DONE");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
