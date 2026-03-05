import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksCommand } from "./tasks.js";

describe("gwrk tasks generate", () => {
  const tempDir = path.join(process.cwd(), "temp-test-generate");

  beforeEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    fs.mkdirSync(tempDir, { recursive: true });

    // Create mock plan.md
    const specsDir = path.join(tempDir, "specs", "test-feature");
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, "plan.md"),
      `# Implementation Plan: test-feature

### Phase 1: Test Phase

**Files (1):**
- \`src/test.ts\` (NEW: Test file)

#### Done When
- File exists
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should generate tasks.json and gates from plan.md", async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      // Mock console.log to avoid output during tests
      vi.spyOn(console, "log").mockImplementation(() => {});

      await tasksCommand.parseAsync(["generate", "test-feature"], {
        from: "user",
      });

      const tasksPath = path.join(
        "specs",
        "test-feature",
        ".gwrk",
        "tasks.json",
      );
      expect(fs.existsSync(tasksPath)).toBe(true);

      const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
      expect(tasks.featureId).toBe("test-feature");
      expect(tasks.phases.length).toBe(1);
      expect(tasks.phases[0].tasks.length).toBe(1);
      expect(tasks.phases[0].tasks[0].id).toBe("T001");

      const gatePath = path.join(
        "specs",
        "test-feature",
        "gates",
        "T001-gate.sh",
      );
      expect(fs.existsSync(gatePath)).toBe(true);

      // Check for executable bit (on Unix)
      if (process.platform !== "win32") {
        const stats = fs.statSync(gatePath);
        expect(stats.mode & fs.constants.S_IXUSR).toBeTruthy();
      }
    } finally {
      process.chdir(originalCwd);
    }
  });
});
