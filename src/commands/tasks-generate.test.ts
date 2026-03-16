import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { tasksGenerateCommand } from "./tasks-generate.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Command } from "commander";

// Mock format.js to avoid messy output
vi.mock("../utils/format.js", () => ({
  banner: vi.fn(),
  blocked: vi.fn(),
  fail: vi.fn(),
  success: vi.fn(),
}));

describe("tasks-generate (FR-002, US-002, ADR-005)", () => {
  let tempDir: string;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = process.cwd();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tasks-generate-test-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    
    // Create necessary structure
    const specDir = path.join(tempDir, "specs", "001-cli-core");
    fs.mkdirSync(path.join(specDir, ".gwrk"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "gates"), { recursive: true });
    fs.mkdirSync(path.join(specDir, "contracts"), { recursive: true });
    
    // Create a plan.md
    fs.writeFileSync(path.join(specDir, "plan.md"), `
# Plan: 001-cli-core

### Phase 1: Core

**Files (1):**
- \`file1.ts\` (First file)

#### Tasks
- Task 1: Create file1.ts

#### Done When
- \`test -f file1.ts\`
`);
    
    // Create a contract to pass the guard
    fs.writeFileSync(path.join(specDir, "contracts", "file1.md"), "# Contract: file1");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("FR-002, US-002: should fail if contracts are missing and --no-llm is not used", async () => {
    const specDir = path.join(tempDir, "specs", "001-cli-core");
    fs.rmSync(path.join(specDir, "contracts"), { recursive: true, force: true });
    
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    process.exitCode = 0;
    
    try {
      await program.parseAsync(["node", "test", "tasks", "001-cli-core", "--force"]);
    } catch {
      // Expected
    }
    
    expect(process.exitCode).toBe(1);
  });

  it("FR-002, US-002: should succeed if contracts are missing but --no-llm is used", async () => {
    const specDir = path.join(tempDir, "specs", "001-cli-core");
    fs.rmSync(path.join(specDir, "contracts"), { recursive: true, force: true });
    
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    process.exitCode = 0;
    
    await program.parseAsync(["node", "test", "tasks", "001-cli-core", "--force", "--no-llm"]);
    
    expect(process.exitCode).toBe(0);
    expect(fs.existsSync(path.join(specDir, ".gwrk", "tasks.json"))).toBe(true);
  });

  it("TR-010: should preserve # AUTHORED gates even with --force", async () => {
    const specDir = path.join(tempDir, "specs", "001-cli-core");
    const gatesDir = path.join(specDir, "gates");
    
    // Pre-create an AUTHORED gate
    const gatePath = path.join(gatesDir, "T001-gate.sh");
    const customContent = "#!/bin/bash\n# AUTHORED\n# My custom logic\n";
    fs.writeFileSync(gatePath, customContent);
    
    // Run define tasks --force
    const program = new Command();
    program.addCommand(tasksGenerateCommand);
    await program.parseAsync(["node", "test", "tasks", "001-cli-core", "--force"]);
    
    // Check if it's still there
    expect(fs.existsSync(gatePath)).toBe(true);
    const content = fs.readFileSync(gatePath, "utf-8");
    expect(content).toBe(customContent);
  });
});
