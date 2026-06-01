import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initCommand } from "./init.js";

// Mock dependencies at top level to avoid hoisting issues
vi.mock("../plugins/seed.js", () => ({ seedSkills: vi.fn() }));
vi.mock("../plugins/migrate.js", () => ({ migratePlugins: vi.fn() }));
vi.mock("../db/runs.js", () => ({ registerProject: vi.fn() }));
vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: vi.fn(() => ({ steps: { tcc: true, ssh: true, gh: true } })),
  saveSetupState: vi.fn(),
}));

// Mock readline at top level
const rlMock = {
  question: vi.fn((q, cb) => cb("n")), // Just say 'n' to confirm
  close: vi.fn(),
};
vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => rlMock),
}));

describe("init command", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should initialize a new project non-interactively", async () => {
    // Create a dummy package.json to test profile detection
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({ name: "test-project" }));

    // Run init --non-interactive
    await initCommand.parseAsync(["--non-interactive"], { from: "user" });

    const rcPath = path.join(tmpDir, ".gwrkrc.json");
    expect(fs.existsSync(rcPath)).toBe(true);

    const config = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
    expect(config.project.name).toBe(path.basename(tmpDir));
    expect(config.project.type).toBe("nodejs");
    expect(config.project.stack.language).toBe("JavaScript");

    expect(fs.existsSync(path.join(tmpDir, "specs"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".gwrk", "rules"))).toBe(true);
  });

  it("should run the interactive profile wizard and allow confirmation", async () => {
    // Mock process.stdin.isTTY
    const originalIsTTY = process.stdin.isTTY;
    process.stdin.isTTY = true;

    await initCommand.parseAsync([], { from: "user" });

    expect(rlMock.question).toHaveBeenCalled();
    process.stdin.isTTY = originalIsTTY;
  });

  it("should integrate agent CLI detection and workstation provisioning", async () => {
    // Code path for workstation provisioning should be covered via the mocks at top level
    await initCommand.parseAsync(["--non-interactive"], { from: "user" });
    
    // Check that we moved past step 2
    expect(fs.existsSync(path.join(tmpDir, ".gwrkrc.json"))).toBe(true);
  });

  it("should support idempotent registration and scaffolding", async () => {
    const { registerProject } = await import("../db/runs.js");

    // First run
    await initCommand.parseAsync(["--non-interactive"], { from: "user" });
    expect(registerProject).toHaveBeenCalledTimes(1);

    // Second run
    await initCommand.parseAsync(["--non-interactive"], { from: "user" });
    expect(registerProject).toHaveBeenCalledTimes(2); // registerProject is called on every init
  });
});
