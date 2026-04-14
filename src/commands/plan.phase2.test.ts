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
const mockWaves = [
  [{ id: "F01-P1", name: "Wave 1 phase", sp_estimate: 2, status: "PLANNED" }]
];

vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    isEmpty: () => false,
    getSolver: async () => ({
      getReadyQueue: () => mockReadyQueue,
      getCriticalPath: () => mockCriticalPath,
      getTopologicalWaves: () => mockWaves
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
});
