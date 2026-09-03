/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A phase can pass its own gate while the branch is red.
 *
 * TEST_GATE runs the suites a phase maps to. CI runs everything. So a phase
 * that breaks a file outside its own scope is green at the gate and red on the
 * PR, and the run only finds out after PR_CI has pushed and waited.
 *
 * 029 phase-02 did exactly that. It added `todayLocal` to adr-scaffold.ts and
 * imported it in adr.ts, which broke the factory mock in adr-dispatch.test.ts.
 * That file belongs to phase-03, so the phase-02 gate never ran it:
 *
 *   TEST_GATE  scoped to: adr-scaffold, adr, cli.ux, cli.e2e, …  -> 69 passed
 *   CI         everything                                        -> 1 failed
 *
 * The full suite takes seconds against a phase that takes twenty minutes, so
 * the gate can afford to run it. Only failures the phase INTRODUCED count: a
 * suite that was already red stays the branch's problem, not this phase's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import { ShipStage } from "./ship-types.js";

const config = {
  cwd: "/repo",
  featureId: "029-decision-records",
  phaseId: "phase-02",
  backend: "claude",
  maxIterations: 3,
};

type Suite = {
  failCount: number;
  testsRun: number;
  passed: number;
  output: string;
  skipped?: boolean;
};

const suite = (failCount: number, testsRun = 60): Suite => ({
  failCount,
  testsRun,
  passed: testsRun - failCount,
  output: "",
});

/**
 * Drive TEST_GATE with scripted suite results.
 *
 * @param scoped what the phase's own mapped suites report
 * @param full what the whole repo reports
 * @param phaseFiles the phase's mapped test files
 */
async function runTestGate(opts: {
  scoped: Suite;
  full: Suite;
  phaseFiles?: string[];
  baseline?: number;
  fullBaseline?: number;
}) {
  const o = new ShipOrchestrator(config as never);
  const state = (o as unknown as { state: Record<string, unknown> }).state;
  state.testBaseline = opts.baseline ?? 0;
  state.fullSuiteBaseline = opts.fullBaseline ?? 0;

  const phaseFiles = opts.phaseFiles ?? ["src/engine/adr-scaffold.test.ts"];
  const calls: string[] = [];

  const priv = o as unknown as {
    getPhaseTestFiles: () => Promise<string[]>;
    runTestSuite: (files?: string[]) => Promise<Suite>;
    runIntegrationGate: () => Promise<null>;
    stageTestGate: () => Promise<{ success: boolean; nextStage?: ShipStage }>;
  };

  priv.getPhaseTestFiles = async () => phaseFiles;
  priv.runIntegrationGate = async () => null;
  priv.runTestSuite = async (files?: string[]) => {
    const whole = !files || files.length === 0;
    calls.push(whole ? "full" : "scoped");
    return whole ? opts.full : opts.scoped;
  };

  const result = await priv.stageTestGate();
  return { result, calls };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("TEST_GATE full-suite regression check", () => {
  it("fails the phase when the full suite gains a failure the scoped suite cannot see", async () => {
    const { result } = await runTestGate({
      scoped: suite(0),
      full: suite(1, 1600),
      fullBaseline: 0,
    });

    // A NO-GO routes to DIAGNOSE while iterations remain; `success` stays true
    // until the circuit breaker trips, so the stage is the assertion that means
    // "this phase did not pass".
    expect(result.nextStage).toBe(ShipStage.DIAGNOSE);
  });

  it("passes when the full suite matches its pre-existing baseline", async () => {
    // A suite already red before this phase started is the branch's problem.
    const { result } = await runTestGate({
      scoped: suite(0),
      full: suite(3, 1600),
      fullBaseline: 3,
    });

    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });

  it("passes when the phase repaired a pre-existing failure", async () => {
    const { result } = await runTestGate({
      scoped: suite(0),
      full: suite(1, 1600),
      fullBaseline: 3,
    });

    expect(result.success).toBe(true);
  });

  it("does not run the full suite when the scoped suite already failed", async () => {
    // The phase's own tests are the sharper signal and the cheaper run. No
    // point paying for the whole repo to restate a failure already found.
    const { result, calls } = await runTestGate({
      scoped: suite(2),
      full: suite(2, 1600),
      fullBaseline: 0,
    });

    expect(result.nextStage).toBe(ShipStage.DIAGNOSE);
    expect(calls).not.toContain("full");
  });

  it("does not run the suite twice when the phase maps no test files", async () => {
    // With no scope, the phase suite IS the full suite. Running it again would
    // double a phase's test time for nothing.
    const { calls } = await runTestGate({
      scoped: suite(0),
      full: suite(0, 1600),
      phaseFiles: [],
      fullBaseline: 0,
    });

    expect(calls.filter((c) => c === "full")).toHaveLength(1);
  });
});
