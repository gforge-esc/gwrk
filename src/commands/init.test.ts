import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initCommand } from "./init.js";

describe("init command", () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should initialize a new project non-interactively", async () => {
    // Mock imports that might fail or do too much
    vi.mock("../plugins/seed.js", () => ({ seedSkills: vi.fn() }));
    vi.mock("../plugins/migrate.js", () => ({ migratePlugins: vi.fn() }));
    vi.mock("../db/runs.js", () => ({ registerProject: vi.fn() }));
    
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

  it("should update an existing project profile", async () => {
    vi.mock("../plugins/seed.js", () => ({ seedSkills: vi.fn() }));
    vi.mock("../plugins/migrate.js", () => ({ migratePlugins: vi.fn() }));
    vi.mock("../db/runs.js", () => ({ registerProject: vi.fn() }));

    const rcPath = path.join(tmpDir, ".gwrkrc.json");
    const gwrkDir = path.join(tmpDir, ".gwrk");
    fs.mkdirSync(gwrkDir);
    fs.writeFileSync(rcPath, JSON.stringify({ project: { name: "old-name" } }));

    // Run init --non-interactive --type custom-type
    await initCommand.parseAsync(["--non-interactive", "--type", "custom-type"], { from: "user" });

    const config = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
    expect(config.project.name).toBe("old-name");
    expect(config.project.type).toBe("custom-type");
  });
});
