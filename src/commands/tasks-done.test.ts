import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksCommand } from "./tasks.js";

describe("gwrk tasks done", () => {
  const tempDir = path.join(process.cwd(), "temp-test-done");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Create mock tasks.json
    const featureDir = path.join(tempDir, "specs", "test-feature");
    const gwrkDir = path.join(featureDir, ".gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.mkdirSync(path.join(featureDir, "gates"), { recursive: true });

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
                  status: "open",
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

    // Create a passing gate script
    const passingGate = path.join(featureDir, "gates", "T001-gate.sh");
    fs.writeFileSync(passingGate, "#!/bin/bash\nexit 0", { mode: 0o755 });

    // Create a failing gate script
    const failingGate = path.join(featureDir, "gates", "T002-gate.sh");
    fs.writeFileSync(failingGate, "#!/bin/bash\nexit 1", { mode: 0o755 });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should complete a task when gate passes", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["done", "test-feature", "T001"], {
        from: "user",
      });

      const tasksPath = path.join(
        "specs",
        "test-feature",
        ".gwrk",
        "tasks.json",
      );
      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
      expect(tasks.phases[0].tasks[0].status).toBe("completed");

      // FR-021: history.jsonl is deprecated.
      // US-019: Should write execution manifest instead.
      const runsDir = path.join("specs", "test-feature", ".gwrk", "runs");
      expect(fs.existsSync(runsDir)).toBe(true);
      const manifests = fs.readdirSync(runsDir);
      expect(manifests.length).toBeGreaterThan(0);
      expect(manifests[0]).toContain("tasks-done");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should fail and keep status open when gate fails", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      process.exitCode = 0;

      await tasksCommand.parseAsync(["done", "test-feature", "T002"], {
        from: "user",
      });

      expect(process.exitCode).toBe(1);
      
      const tasksPath = path.join(
        "specs",
        "test-feature",
        ".gwrk",
        "tasks.json",
      );
      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
      expect(tasks.phases[0].tasks[1].status).toBe("open");
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should fail when gate script is missing", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      process.exitCode = 0;

      // Delete tasks.json and recreate with missing gate
      const tasksPath = path.join(
        "specs",
        "test-feature",
        ".gwrk",
        "tasks.json",
      );
      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
      tasks.phases[0].tasks[0].gateScript = "gates/MISSING-gate.sh";
      fs.writeFileSync(tasksPath, JSON.stringify(tasks));

      await tasksCommand.parseAsync(["done", "test-feature", "T001"], {
        from: "user",
      });

      expect(process.exitCode).toBe(1);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it("should fail and block when gate contains only test -f (FR-001)", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.exitCode = 0;

      // Create a gate that only contains test -f
      const featureDir = path.join(tempDir, "specs", "test-feature");
      const testFGate = path.join(featureDir, "gates", "T001-gate.sh");
      
      // Create the file so the gate itself WOULD pass (exit 0)
      const targetFile = path.join(tempDir, "some-file.ts");
      fs.writeFileSync(targetFile, "// exists");
      
      fs.writeFileSync(testFGate, `#!/bin/bash\ntest -f ${targetFile}`, { mode: 0o755 });

      await tasksCommand.parseAsync(["done", "test-feature", "T001"], {
        from: "user",
      });

      // FR-001: MUST be treated as a build failure (exit 1) because it only has test -f
      expect(process.exitCode).toBe(1);

      const tasksPath = path.join(
        "specs",
        "test-feature",
        ".gwrk",
        "tasks.json",
      );
      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
      expect(tasks.phases[0].tasks[0].status).toBe("open");
    } finally {
      process.chdir(originalCwd);
    }
  });
});
