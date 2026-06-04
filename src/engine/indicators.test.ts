import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { computeLeadingIndicators } from "./indicators.js";
import { getDb } from "../db/index.js";

vi.mock("../db/index.js");
vi.mock("node:fs");
vi.mock("node:child_process");

describe("FR-014: computeLeadingIndicators", () => {
  it("TR-015: computes convergence, density, and spec quality metrics correctly", () => {
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      all: vi.fn(),
      get: vi.fn(),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);

    // Mock convergence query
    mockDb.all.mockReturnValue([
      { task_id: "T001", attempts: 1, is_completed: 1 },
      { task_id: "T002", attempts: 2, is_completed: 1 },
      { task_id: "T003", attempts: 1, is_completed: 1 },
      { task_id: "T004", attempts: 3, is_completed: 0 }, // Failed task
    ]);

    // Mock density run stats query
    mockDb.get.mockReturnValue({ total_lines: 100, total_files: 5 });

    // Mock filesystem for spec quality
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(((dir: string) => {
      if (dir.endsWith("contracts")) return ["c1.md", "c2.md", "README.md"];
      if (dir.endsWith("gates")) return ["T001-gate.sh", "T002-gate.sh", "T003-gate.sh", "run-all.sh"];
      if (dir.endsWith(".runs")) return ["feat-a.log"];
      return [];
    }) as any);
    vi.mocked(fs.readFileSync).mockReturnValue("[10:00:00] $ ls\n[10:01:00] > pnpm build");

    const forecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const indicators = computeLeadingIndicators("feat-a", forecast, "proj-1");

    // Convergence: 
    // tasks: T001 (1,C), T002 (2,C), T003 (1,C), T004 (3,NC) -> 4 tasks
    // first-pass: T001, T003 -> 2/4 = 50%
    // avg attempts: (1+2+1+3)/4 = 7/4 = 1.75
    expect(indicators.convergence.firstPassRate).toBe(50);
    expect(indicators.convergence.avgAttempts).toBe(1.75);

    // Density:
    // lines: 100 / 10 = 10
    // files: 5 / 10 = 0.5
    // tool calls: 2 / 10 = 0.2
    expect(indicators.density.linesPerSP).toBe(10);
    expect(indicators.density.filesPerSP).toBe(0.5);
    expect(indicators.density.toolCallsPerSP).toBe(0.2);

    // Spec Quality:
    // contracts: 3 files, but README.md is filtered out -> 2
    // gates: 4 files, but only T###-gate.sh match -> 3
    expect(indicators.specQuality.contractCount).toBe(2);
    expect(indicators.specQuality.gateCount).toBe(3);
  });

  it("falls back to Git for density if DB stats are missing", () => {
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue({ total_lines: 0, total_files: 0 }),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(execFileSync).mockReturnValue("10\t5\tfile1.ts\n2\t1\tfile2.ts\n");

    const forecast = {
      totalSP: 1,
      roles: [],
      estimatedHours: 10,
      estimatedDays: 1,
    };

    const indicators = computeLeadingIndicators("feat-a", forecast, "proj-1");

    expect(indicators.density.linesPerSP).toBe(18); // (10+5) + (2+1) = 18
    expect(indicators.density.filesPerSP).toBe(2);
    expect(execFileSync).toHaveBeenCalledWith("git", expect.arrayContaining(["log", "--numstat"]), expect.anything());
  });

  it("handles zero values gracefully", () => {
    const mockDb = {
      prepare: vi.fn().mockReturnThis(),
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(null),
    };

    vi.mocked(getDb).mockReturnValue(mockDb as any);
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const forecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const indicators = computeLeadingIndicators("feat-b", forecast, "proj-1");

    expect(indicators.convergence.firstPassRate).toBe(0);
    expect(indicators.convergence.avgAttempts).toBe(0);
    expect(indicators.density.linesPerSP).toBe(0);
    expect(indicators.specQuality.contractCount).toBe(0);
  });
});

