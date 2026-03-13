import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testCommand } from "./test.js";

// Mock external dependencies
vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

// Fixtures
const FEATURE = "001-cli-core";
const SPECS_DIR = path.join(process.cwd(), "specs");
const FEATURE_DIR = path.join(SPECS_DIR, FEATURE);
const GWRK_DIR = path.join(FEATURE_DIR, ".gwrk");
const TASKS_JSON = path.join(GWRK_DIR, "tasks.json");

const SAMPLE_TASKS = {
  featureId: FEATURE,
  createdAt: "2026-03-12T00:00:00.000Z",
  phases: [
    {
      id: "phase-01",
      title: "Phase 1",
      tasks: [
        {
          id: "T001",
          title: "Implement src/commands/init.ts",
          description:
            "MODIFY: Add scaffold logic. Tests: src/commands/init.test.ts",
          status: "open",
          gateScript: "gates/T001-gate.sh",
        },
        {
          id: "T002",
          title: "Implement src/utils/config.ts",
          description: "MODIFY: Zod validation.",
          status: "open",
          gateScript: "gates/T002-gate.sh",
        },
      ],
    },
    {
      id: "phase-02",
      title: "Phase 2",
      tasks: [
        {
          id: "T003",
          title: "Implement src/db/db.ts",
          description:
            "NEW: SQLite schema. Tests: src/db/db.test.ts, src/db/runs.test.ts",
          status: "open",
          gateScript: "gates/T003-gate.sh",
        },
      ],
    },
  ],
};

describe("testCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fs.mkdirSync(GWRK_DIR, { recursive: true });
    fs.writeFileSync(TASKS_JSON, JSON.stringify(SAMPLE_TASKS, null, 2));
    // Create the test files referenced in task descriptions so gwrk test can find them
    const testFiles = [
      "src/commands/init.test.ts",
      "src/db/db.test.ts",
      "src/db/runs.test.ts",
    ];
    for (const f of testFiles) {
      const abs = path.join(process.cwd(), f);
      if (!fs.existsSync(abs)) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "// stub");
      }
    }
  });

  afterEach(() => {
    fs.rmSync(FEATURE_DIR, { recursive: true, force: true });
  });

  describe("feature-level run (all phases)", () => {
    it("scopes vitest to test files extracted from all task descriptions", () => {
      // FR-009: gwrk test <feature> runs pnpm vitest run scoped to feature test paths
      mockExecSync.mockReturnValue(Buffer.from(""));

      testCommand.parse([FEATURE], { from: "user" });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("pnpm vitest run"),
        expect.objectContaining({ stdio: "inherit" }),
      );

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain("src/commands/init.test.ts");
      expect(call).toContain("src/db/db.test.ts");
      expect(call).toContain("src/db/runs.test.ts");
    });

    it("exits 0 when vitest passes", () => {
      // FR-009: exits 0 only if all tests pass
      mockExecSync.mockReturnValue(Buffer.from("Tests passed"));

      const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      expect(() => testCommand.parse([FEATURE], { from: "user" })).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 1 when vitest fails", () => {
      // FR-009: exit code 1 on test failures
      const err = Object.assign(new Error("vitest failure"), { status: 1 });
      mockExecSync.mockImplementation(() => {
        throw err;
      });

      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      testCommand.parse([FEATURE], { from: "user" });

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe("--phase scoping", () => {
    it("restricts test files to the specified phase only", () => {
      // FR-009: --phase <N> scopes to that phase's tasks
      mockExecSync.mockReturnValue(Buffer.from(""));

      testCommand.parse([FEATURE, "--phase", "01"], { from: "user" });

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain("src/commands/init.test.ts");
      expect(call).not.toContain("src/db/db.test.ts");
    });
  });

  describe("edge cases", () => {
    it("exits 1 if feature directory does not exist", () => {
      // FR-009: error handled gracefully
      const exitSpy = vi
        .spyOn(process, "exit")
        .mockImplementation(() => undefined as never);

      testCommand.parse(["999-nonexistent"], { from: "user" });

      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("prints 'No tests found' and exits 0 when phase has no test files", () => {
      // FR-009: no-test-file case — exits 0 with message, no vitest invocation
      mockExecSync.mockReturnValue(Buffer.from(""));

      const noTestTasks = {
        ...SAMPLE_TASKS,
        phases: [
          {
            id: "phase-01",
            title: "Phase 1",
            tasks: [
              {
                id: "T001",
                title: "Implement README.md",
                description: "Write documentation.",
                status: "open",
                gateScript: "gates/T001-gate.sh",
              },
            ],
          },
        ],
      };
      fs.writeFileSync(TASKS_JSON, JSON.stringify(noTestTasks, null, 2));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      testCommand.parse([FEATURE], { from: "user" });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No tests found"),
      );
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });
});
