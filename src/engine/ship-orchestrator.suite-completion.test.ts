/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchToAgent } from "../utils/agent.js";
import { loadTaskState } from "../utils/state.js";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import { ShipStage } from "./ship-types.js";
import { hasRecognizedTestSummary, parseTestOutput } from "./test-runner.js";

vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  execSync: vi.fn(),
}));
vi.mock("./profile-detector.js", () => ({ detectProfile: vi.fn().mockResolvedValue({ type: "nodejs" }) }));
vi.mock("../utils/toolchain-mapper.js", async (original) => ({
  ...await original<typeof import("../utils/toolchain-mapper.js")>(),
  getTestCommand: vi.fn().mockReturnValue("fixture-suite"),
  getBuildCommand: vi.fn().mockReturnValue(null),
}));
vi.mock("../utils/state.js", () => ({ loadTaskState: vi.fn(), saveTaskState: vi.fn() }));
vi.mock("../utils/agent.js", () => ({ dispatchToAgent: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }) }));

const noise = "stdout | harvest fixture\nGate reconciliation: 2/5 passed (3 failed)";
const partial = `${noise}\nfixture still running`;
const failure = (fields: Record<string, unknown> = {}) => Object.assign(new Error("fixture suite did not complete"), {
  status: null,
  signal: "SIGTERM",
  code: "ETIMEDOUT",
  stdout: Buffer.from(partial),
  stderr: Buffer.from("runner diagnostic on stderr"),
  ...fields,
});

type Suite = { failCount: number; testsRun: number; passed: number; output: string; executionError?: string };
type Driver = {
  state: { testBaseline?: number; fullSuiteBaseline?: number; testExecutionFailure?: string };
  runTestSuite(files?: string[]): Promise<Suite>;
  captureTestBaseline(): Promise<void>;
  checkFullSuiteRegression(): Promise<{ nextStage?: ShipStage } | null>;
  stageTestGate(): Promise<{ nextStage?: ShipStage }>;
  stageDiagnose(): Promise<unknown>;
  getPhaseTestFiles(): Promise<string[]>;
  getPhaseGate(): string | null;
  runPhaseGate(): Promise<{ passed: boolean }>;
  runIntegrationGate(): Promise<unknown>;
};

function orchestrator(): Driver {
  const runner = new ShipOrchestrator({ cwd: "/suite-fixture", featureId: "suite-completion", phaseId: "phase-01", backend: "claude", maxIterations: 3, ciTimeout: 30 }) as unknown as Driver;
  runner.getPhaseTestFiles = vi.fn().mockResolvedValue([]);
  runner.getPhaseGate = vi.fn().mockReturnValue(null);
  return runner;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(execSync).mockReturnValue(Buffer.from("Tests 16 passed (16)"));
  vi.mocked(loadTaskState).mockReturnValue({ featureId: "suite-completion", createdAt: "2026-11-23T00:00:00Z", phases: [{ id: "phase-01", title: "Existing phase", tasks: [{ id: "T001", title: "Completed gate", status: "completed", description: "Gate passed", gateScript: "true" }] }] });
});

describe("suite execution completion", () => {
  it("does not interpret fixture gate logs as a test summary", () => {
    expect(parseTestOutput(partial)).toEqual({ testsRun: 0, passed: 0, failed: 0 });
    expect(hasRecognizedTestSummary(partial)).toBe(false);
  });

  it.each([
    ["timeout", failure()],
    ["cancellation after a summary", failure({ code: "ABORT_ERR", stdout: Buffer.from(`${noise}\nTests 16 passed (16)`) })],
    ["nonzero partial output", failure({ status: 1, signal: null, code: undefined })],
    ["crash after a passing summary", failure({ status: 2, signal: null, code: undefined, stdout: Buffer.from("Tests 16 passed (16)") })],
    ["output buffer exhaustion", failure({ code: "ENOBUFS", signal: "SIGTERM" })],
    ["shell-encoded signal", failure({ status: 137, code: undefined, signal: null, stdout: Buffer.from("Tests 1 failed | 15 passed (16)") })],
  ])("keeps %s separate from assertion counts", async (_label, error) => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw error; });
    const result = await orchestrator().runTestSuite([]);
    expect(result.executionError).toBeTruthy();
    expect(result.output).toContain("runner diagnostic on stderr");
    expect(result.output).toContain(error.stdout.toString());
    expect(result.failCount).toBe(0);
  });

  it.each([false, true])("never grandfathers incomplete execution under an old baseline, scoped=%s", async (scoped) => {
    const runner = orchestrator();
    runner.state.testBaseline = 8;
    runner.state.fullSuiteBaseline = 8;
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(scoped ? ["phase.test.ts"] : []);
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure(); });
    const result = await runner.stageTestGate();
    expect(result.nextStage).toBe(ShipStage.DIAGNOSE);
    expect(runner.state.testExecutionFailure).toContain(partial);
  });

  it("blocks repo-wide comparison after interruption even with a passing partial summary", async () => {
    const runner = orchestrator();
    runner.state.fullSuiteBaseline = 8;
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure({ stdout: Buffer.from("Tests 16 passed (16)") }); });
    expect((await runner.checkFullSuiteRegression())?.nextStage).toBe(ShipStage.DIAGNOSE);
  });

  it("does not publish an interrupted baseline", async () => {
    const runner = orchestrator();
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure(); });
    await expect(runner.captureTestBaseline()).rejects.toThrow(/suite|test/i);
    expect(runner.state.testBaseline).toBeUndefined();
    expect(runner.state.fullSuiteBaseline).toBeUndefined();
  });

  it("retains runner diagnostics for DIAGNOSE when every task gate already passed", async () => {
    const runner = orchestrator();
    runner.state.fullSuiteBaseline = 8;
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure(); });
    await runner.checkFullSuiteRegression();
    await runner.stageDiagnose();
    expect(dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining(partial) }));
    expect(dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({ prompt: expect.stringContaining("runner diagnostic on stderr") }));
    expect(loadTaskState().phases[0].tasks[0].status).toBe("completed");
  });

  it("does not use a passing authored gate to override an interrupted scoped runner", async () => {
    const runner = orchestrator();
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(["phase.test.ts"]);
    runner.getPhaseGate = vi.fn().mockReturnValue("gates/phase-01.sh");
    runner.runPhaseGate = vi.fn().mockResolvedValue({ passed: true });
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure(); });
    expect((await runner.stageTestGate()).nextStage).toBe(ShipStage.DIAGNOSE);
    expect(runner.runPhaseGate).not.toHaveBeenCalled();
  });

  it("does not publish either baseline when the full run is interrupted after scoped completion", async () => {
    const runner = orchestrator();
    runner.state.testBaseline = 8;
    runner.state.fullSuiteBaseline = 8;
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(["phase.test.ts"]);
    vi.mocked(execSync).mockReturnValueOnce(Buffer.from("Tests 16 passed (16)"));
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure(); });
    await expect(runner.captureTestBaseline()).rejects.toThrow(/suite|test/i);
    expect(runner.state.testBaseline).toBeUndefined();
    expect(runner.state.fullSuiteBaseline).toBeUndefined();
  });

  it("rejects an interrupted integration command despite passing counts", async () => {
    const runner = orchestrator();
    const tasks = vi.mocked(loadTaskState).mock.results[0]?.value ?? loadTaskState("/suite-fixture");
    tasks.phases[0].doneWhen = ["pnpm test"];
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure({ stdout: Buffer.from("Tests 16 passed (16)") }); });
    expect((await runner.runIntegrationGate() as { nextStage?: ShipStage })?.nextStage).toBe(ShipStage.DIAGNOSE);
  });

  it("keeps complete assertion failures available for baseline comparison", async () => {
    vi.mocked(execSync).mockImplementationOnce(() => { throw failure({ status: 1, code: undefined, signal: null, stdout: Buffer.from(`${noise}\nTests 2 failed | 14 passed (16)`) }); });
    const result = await orchestrator().runTestSuite([]);
    expect(result.executionError).toBeUndefined();
    expect(result).toMatchObject({ testsRun: 16, passed: 14, failCount: 2 });
  });

  it("gives a whole suite more time than a scoped run while keeping both bounded", async () => {
    const runner = orchestrator();
    await runner.runTestSuite([]);
    await runner.runTestSuite(["phase.test.ts"]);
    const whole = vi.mocked(execSync).mock.calls[0][1]?.timeout;
    const scoped = vi.mocked(execSync).mock.calls[1][1]?.timeout;
    expect(whole).toBeGreaterThan(300_000 + 156_000);
    expect(whole).toBeLessThanOrEqual(600_000);
    expect(scoped).toBeGreaterThan(300_000);
    expect(scoped).toBeLessThan(whole!);
  });
});

const completedLoadFailure = [
  " RUN v3.2.4 /suite-fixture", "⎯⎯ Failed Suites 3 ⎯⎯", "Error: module missing",
  " Test Files 3 failed | 1 passed (4)", " Tests 2 passed (2)",
  " Start at 19:04:22", " Duration 1.06s (tests 725ms)",
].join("\n");
function loadFailure(output = completedLoadFailure) {
  return failure({ status: 1, signal: null, code: undefined, stdout: Buffer.from(output), stderr: Buffer.from("") });
}

describe("initial baseline suite-load evidence", () => {
  it("records three completed failed suites before implementation without inventing failed assertions", async () => {
    const runner = orchestrator();
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(["new.test.ts"]);
    vi.mocked(execSync).mockImplementation(() => { throw loadFailure(); });
    await runner.captureTestBaseline();
    expect(runner.state.testBaseline).toBe(3);
    expect(runner.state.fullSuiteBaseline).toBe(3);
    expect(runner.state.testExecutionFailure).toBeUndefined();
  });
  it.each([false, true])("never grandfathers failed suites at verification, scoped=%s", async (scoped) => {
    const runner = orchestrator();
    runner.state.testBaseline = 99; runner.state.fullSuiteBaseline = 99;
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(scoped ? ["new.test.ts"] : []);
    vi.mocked(execSync).mockImplementationOnce(() => { throw loadFailure(); });
    expect((await runner.stageTestGate()).nextStage).toBe(ShipStage.DIAGNOSE);
    expect(runner.state.testExecutionFailure).toContain("Failed Suites 3");
  });
  it("blocks repo-wide failed suites even under a larger baseline", async () => {
    const runner = orchestrator(); runner.state.fullSuiteBaseline = 99;
    vi.mocked(execSync).mockImplementationOnce(() => { throw loadFailure(); });
    expect((await runner.checkFullSuiteRegression())?.nextStage).toBe(ShipStage.DIAGNOSE);
  });
  it("clears both baselines when a complete scoped load failure is followed by truncated whole-suite output", async () => {
    const runner = orchestrator();
    runner.getPhaseTestFiles = vi.fn().mockResolvedValue(["new.test.ts"]);
    vi.mocked(execSync).mockImplementationOnce(() => { throw loadFailure(); });
    vi.mocked(execSync).mockImplementationOnce(() => { throw loadFailure(completedLoadFailure.split(" Duration")[0]); });
    await expect(runner.captureTestBaseline()).rejects.toThrow();
    expect(runner.state.testBaseline).toBeUndefined();
    expect(runner.state.fullSuiteBaseline).toBeUndefined();
  });
});
