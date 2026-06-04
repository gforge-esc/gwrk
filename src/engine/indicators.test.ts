import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeLeadingIndicators } from "./indicators.js";
import { getDb } from "../db/index.js";

vi.mock("../db/index.js");
vi.mock("node:fs");

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
      { task_id: "T001", attempts: 1 },
      { task_id: "T002", attempts: 2 },
      { task_id: "T003", attempts: 1 },
    ]);

    // Mock density run stats query
    mockDb.get.mockReturnValue({ total_lines: 100, total_files: 5 });

    // Mock filesystem for spec quality
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(((dir: string) => {
      if (dir.endsWith("contracts")) return ["c1.md", "c2.md"];
      if (dir.endsWith("gates")) return ["g1.sh", "g2.sh", "g3.sh"];
      if (dir.endsWith(".runs")) return ["feat-a.log"];
      return [];
    }) as any);
    vi.mocked(fs.readFileSync).mockReturnValue("[10:00:00 +00:00]  $ ls\n[10:01:00 +00:01]  $ pnpm build");

    const forecast = {
      totalSP: 10,
      roles: [],
      estimatedHours: 50,
      estimatedDays: 6.25,
    };

    const indicators = computeLeadingIndicators("feat-a", forecast, "proj-1");

    // Convergence: 
    // tasks: T001 (1), T002 (2), T003 (1) -> 3 tasks
    // first-pass: T001, T003 -> 2/3 = 66.66% -> 67%
    // avg attempts: (1+2+1)/3 = 4/3 = 1.333 -> 1.33
    expect(indicators.convergence.firstPassRate).toBe(67);
    expect(indicators.convergence.avgAttempts).toBe(1.33);

    // Density:
    // lines: 100 / 10 = 10
    // files: 5 / 10 = 0.5
    // tool calls: 2 / 10 = 0.2
    expect(indicators.density.linesPerSP).toBe(10);
    expect(indicators.density.filesPerSP).toBe(0.5);
    expect(indicators.density.toolCallsPerSP).toBe(0.2);

    // Spec Quality:
    expect(indicators.specQuality.contractCount).toBe(2);
    expect(indicators.specQuality.gateCount).toBe(3);
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
