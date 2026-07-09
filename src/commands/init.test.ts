import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initAction } from "./init.js";
import readline from "node:readline/promises";

vi.mock("node:readline/promises");
vi.mock("../engine/registry.js", () => ({
  syncRegistry: vi.fn().mockResolvedValue(undefined),
}));

describe("Init Command Tests", () => {
  let tempDir: string;
  let oldCwd: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    oldCwd = process.cwd();
    process.chdir(tempDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("FR-001: Unified Init Wizard", () => {
    it("US-001: should run interactive wizard when no flags provided", async () => {
      const mockRl = {
        question: vi.fn()
          .mockResolvedValueOnce("my-project") // Project name
          .mockResolvedValueOnce("y")          // Profile correct
          .mockResolvedValueOnce("flat")       // Layout
          .mockResolvedValueOnce("Layered")    // Architecture
          .mockResolvedValueOnce("TDD")        // Conventions
          .mockResolvedValueOnce("y"),         // Provision workstation
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      await initAction({});

      expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.name).toBe("my-project");
      expect(config.project.architecture).toBe("Layered");
    });

    it("US-001: should auto-detect project type and present for confirmation", async () => {
      // Create package.json to trigger nodejs detection
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      const mockRl = {
        question: vi.fn()
          .mockResolvedValueOnce("my-node-project") // Project name
          .mockResolvedValueOnce("y")               // Profile correct (nodejs)
          .mockResolvedValueOnce("src-nested")      // Layout
          .mockResolvedValueOnce("Hexagonal")       // Architecture
          .mockResolvedValueOnce("Functional")      // Conventions
          .mockResolvedValueOnce("n"),              // Skip workstation
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      await initAction({});

      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.type).toBe("nodejs");
      expect(config.project.architecture).toBe("Hexagonal");
    });

    it("US-001: should be idempotent and offer to update existing config", async () => {
      // Setup fake root config to trigger idempotency
      fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "root" } }));
      
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await initAction({});
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("gwrk already initialized"));
      stdoutSpy.mockRestore();
    });
  });

  describe("FR-001: --non-interactive mode", () => {
    it("should use auto-detection with zero prompts and write .gwrkrc.json", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));
      
      await initAction({ nonInteractive: true });

      expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.type).toBe("nodejs");
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });

  describe("FR-046: --agent mode", () => {
    it("should output structured JSON and exit 0", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      
      await initAction({ agent: true });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "success"'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"profile":'));
      stdoutSpy.mockRestore();
    });

    it("should skip human-dependent steps (TCC, SSH, Slack)", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      
      await initAction({ agent: true });

      expect(readline.createInterface).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });
  });

  describe("US-004: Workspace Append (020-polyglot-monorepo)", () => {
    it("should append workspace to existing config if in a subdirectory", async () => {
      // Setup root project
      const rootConfig = { project: { name: "root" } };
      fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify(rootConfig, null, 2));

      // Setup workspace subdirectory
      const wsDir = path.join(tempDir, "packages/web");
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, "package.json"), JSON.stringify({ name: "web" }));
      
      process.chdir(wsDir);

      await initAction({ workspace: "web" });

      // Verify root config was updated
      const updatedConfig = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(updatedConfig.workspaces).toBeDefined();
      expect(updatedConfig.workspaces["packages/web"]).toBeDefined();
      expect(updatedConfig.workspaces["packages/web"].type).toBe("nodejs");
    });
  });
});
