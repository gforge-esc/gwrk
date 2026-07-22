/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
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
  let tempDir: string;
  let featureDir: string;
  let gwrkDir: string;
  let tasksJson: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create isolated temp directory — NEVER operate on real project specs
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-cmd-"));
    featureDir = path.join(tempDir, "specs", FEATURE);
    gwrkDir = path.join(featureDir, ".gwrk");
    tasksJson = path.join(gwrkDir, "tasks.json");

    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.writeFileSync(tasksJson, JSON.stringify(SAMPLE_TASKS, null, 2));

    // Create test file stubs inside the temp project so existsSync checks pass
    const testFiles = [
      "src/commands/init.test.ts",
      "src/db/db.test.ts",
      "src/db/runs.test.ts",
    ];
    for (const f of testFiles) {
      const abs = path.join(tempDir, f);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, "// stub");
    }

    // Redirect process.cwd() to temp directory so testCommand operates there
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("feature-level run (all phases)", () => {
    it("scopes vitest to test files extracted from all task descriptions", async () => {
      // FR-009: gwrk test <feature> runs pnpm vitest run scoped to feature test paths
      mockExecSync.mockReturnValue(Buffer.from(""));

      await testCommand.parseAsync([FEATURE], { from: "user" });

      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining("pnpm vitest run"),
        expect.objectContaining({ stdio: "inherit" }),
      );

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain("src/commands/init.test.ts");
      expect(call).toContain("src/db/db.test.ts");
      expect(call).toContain("src/db/runs.test.ts");
    });

    it("exits 0 when vitest passes", async () => {
      // FR-009: exits 0 only if all tests pass
      mockExecSync.mockReturnValue(Buffer.from("Tests passed"));

      process.exitCode = 0;
      await testCommand.parseAsync([FEATURE], { from: "user" });
      expect(process.exitCode).toBe(0);
    });

    it("exits 1 when vitest fails", async () => {
      // FR-009: exit code 1 on test failures
      const err = Object.assign(new Error("vitest failure"), { status: 1 });
      mockExecSync.mockImplementation(() => {
        throw err;
      });

      process.exitCode = 0;
      await testCommand.parseAsync([FEATURE], { from: "user" });

      expect(process.exitCode).toBe(1);
    });
  });

  describe("--phase scoping", () => {
    it("restricts test files to the specified phase only", async () => {
      // FR-009: --phase <N> scopes to that phase's tasks
      mockExecSync.mockReturnValue(Buffer.from(""));

      await testCommand.parseAsync([FEATURE, "--phase", "01"], { from: "user" });

      const call = mockExecSync.mock.calls[0][0] as string;
      expect(call).toContain("src/commands/init.test.ts");
      expect(call).not.toContain("src/db/db.test.ts");
    });
  });

  describe("edge cases", () => {
    it("exits 1 if feature directory does not exist", async () => {
      // FR-009: error handled gracefully
      process.exitCode = 0;
      await testCommand.parseAsync(["999-nonexistent"], { from: "user" });

      expect(process.exitCode).toBe(1);
      expect(mockExecSync).not.toHaveBeenCalled();
    });

    it("prints 'No tests found' and exits 1 when phase has no test files", async () => {
      // FR-009 / liveness (ADR-005 §10): nothing verified is NOT success.
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
      fs.writeFileSync(tasksJson, JSON.stringify(noTestTasks, null, 2));

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      process.exitCode = 0;
      await testCommand.parseAsync([FEATURE], { from: "user" });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("No tests found"),
      );
      expect(mockExecSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    });
  });
});
