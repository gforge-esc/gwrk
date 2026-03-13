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

describe("tasks-generate", () => {
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
    
    // Create a plan.md that matches the parser's expectations
    fs.writeFileSync(path.join(specDir, "plan.md"), `
### Phase 1: Core

**Files (2):**
- \`file1.ts\` (First file)
- \`file2.ts\` (Second file)

#### Done When
- \`test -f file1.ts\`
- \`test -f file2.ts\`
`);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("should preserve # AUTHORED gates even with --force", async () => {
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
