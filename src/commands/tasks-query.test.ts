import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksCommand } from "./tasks.js";

describe("gwrk tasks query", () => {
  const tempDir = path.join(process.cwd(), "temp-test-query");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Create mock tasks.json
    const featureDir = path.join(tempDir, "specs", "test-feature");
    const gwrkDir = path.join(featureDir, ".gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });

    fs.writeFileSync(
      path.join(gwrkDir, "tasks.json"),
      JSON.stringify(
        {
          featureId: "test-feature",
          createdAt: new Date().toISOString(),
          phases: [
            {
              id: "phase-01",
              title: "Phase 1",
              tasks: [
                {
                  id: "T001",
                  title: "Task 1",
                  description: "Desc 1",
                  status: "completed",
                  gateScript: "gates/T001-gate.sh",
                },
                {
                  id: "T002",
                  title: "Task 2",
                  description: "Desc 2",
                  status: "open",
                  gateScript: "gates/T002-gate.sh",
                },
              ],
            },
          ],
        },
        null,
        2,
      ),
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should list tasks", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["list", "test-feature"], { from: "user" });

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("T001"));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("T002"));
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should list tasks as JSON", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["list", "test-feature", "--json"], {
        from: "user",
      });

      const lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed.tasks.length).toBe(2);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should show next task", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["next", "test-feature", "1"], {
        from: "user",
      });

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Next task: T002"),
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should show next task as JSON", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["next", "test-feature", "1", "--json"], {
        from: "user",
      });

      const lastCall = logSpy.mock.calls[logSpy.mock.calls.length - 1][0];
      const parsed = JSON.parse(lastCall);
      expect(parsed.id).toBe("T002");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
