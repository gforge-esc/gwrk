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
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await tasksCommand.parseAsync(["list", "test-feature"], { from: "user" });

      const output = stdoutSpy.mock.calls.map(c => String(c[0])).join("") + 
                     logSpy.mock.calls.map(c => String(c[0])).join("\n");
      
      expect(output).toContain("T001");
      expect(output).toContain("T002");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should list tasks as JSON", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await tasksCommand.parseAsync(["list", "test-feature", "--json"], {
        from: "user",
      });

      const output = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
      const parsed = JSON.parse(output);
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
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await tasksCommand.parseAsync(["next", "test-feature", "1"], {
        from: "user",
      });

      const output = stdoutSpy.mock.calls.map(c => String(c[0])).join("") + 
                     logSpy.mock.calls.map(c => String(c[0])).join("\n");

      expect(output).toContain("Next task: T002");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should show next task as JSON", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await tasksCommand.parseAsync(["next", "test-feature", "1", "--json"], {
        from: "user",
      });

      const output = stdoutSpy.mock.calls.map(c => String(c[0])).join("");
      const parsed = JSON.parse(output);
      expect(parsed.task.id).toBe("T002");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
