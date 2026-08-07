/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { planCommand } from "./plan.js";

const mockReadyQueue = [
  { id: "F01-P1", name: "Mock ready phase", sp_estimate: 2, status: "PLANNED" }
];
const mockCriticalPath = {
  path: [{ id: "F01-P1", name: "Mock phase", sp_estimate: 2, status: "PLANNED" }],
  warnings: ["⚠️ F02-P1 has no SP estimate"]
};
// Remaining-work waves (the `plan waves` default) vs. the plan of record
// including shipped history (`--all`). Distinct contents so the command's
// routing is observable: swapping the two calls must fail a test.
const mockRemainingWaves = [
  [{ id: "F01-P1", name: "Wave 1 phase", sp_estimate: 2, status: "PLANNED" }]
];
const mockWaves = [
  [{ id: "F00-P1", name: "Already shipped phase", sp_estimate: 2, status: "SHIPPED" }],
  ...mockRemainingWaves
];

vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    isEmpty: () => false,
    getSolver: async () => ({
      getReadyQueue: () => mockReadyQueue,
      getCriticalPath: () => mockCriticalPath,
      getTopologicalWaves: () => mockWaves,
      getRemainingWaves: () => mockRemainingWaves
    })
  }))
}));

describe("gwrk plan subcommands (Phase 2)", () => {
  let program: Command;
  let logSpy: any;
  let warnSpy: any;

  beforeEach(() => {
    program = new Command();
    program.addCommand(planCommand);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it("US-001: gwrk plan next should show ready work items", async () => {
    await program.parseAsync(['node', 'test', 'plan', 'next']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Ready Work Items"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("F01-P1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Mock ready phase"));
  });

  it("US-002: gwrk plan critical should show the critical path", async () => {
    await program.parseAsync(['node', 'test', 'plan', 'critical']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Critical Path"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("F01-P1"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("⚠️ F02-P1 has no SP estimate"));
  });

  it("US-015: gwrk plan waves should show parallel waves", async () => {
    await program.parseAsync(['node', 'test', 'plan', 'waves']);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Parallel Execution Waves"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Wave 1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("F01-P1"));
  });

  it("US-015: plan waves defaults to remaining work, omitting shipped phases", async () => {
    await program.parseAsync(['node', 'test', 'plan', 'waves']);
    const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(out).not.toContain("Already shipped phase");
  });

  it("US-015: plan waves --all shows the plan of record including shipped history", async () => {
    await program.parseAsync(['node', 'test', 'plan', 'waves', '--all']);
    const out = logSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(out).toContain("Already shipped phase");
  });
});
