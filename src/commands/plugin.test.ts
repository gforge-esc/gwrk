import { describe, expect, it, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// @ts-ignore - Module does not exist yet (RED)
import { installPlugin, removePlugin, listPlugins } from "./plugin.js";

vi.mock("node:fs/promises");
vi.mock("node:child_process");

describe("FR-001 / FR-003 / FR-004 / US-001 / US-002 / US-003: Plugin CLI Commands", () => {
  const mockGlobalDir = path.join(os.homedir(), ".gwrk", "plugins");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("gwrk plugin install (FR-001 / US-001)", () => {
    it("successfully installs a valid skill plugin", async () => {
      // Mock manifest exists and is valid
      vi.mocked(fs.readFile).mockResolvedValue('type: skill\nname: narrative\nversion: 1.0.0\ntier: atomic\ndescription: foo\ncategory: reasoning\nprompt: bar\ninterface: { input: stdin, output: stdout, exitCodes: { 0: ok } }\nruntime: { preferredAgent: gemini, preferredModel: g-pro, maxInputTokens: 100 }');
      
      // @ts-ignore
      await installPlugin("./my-skill");

      // Verify directory was created and files copied
      expect(fs.mkdir).toHaveBeenCalledWith(path.join(mockGlobalDir, "skills", "narrative"), { recursive: true });
      expect(fs.copyFile).toHaveBeenCalled();
    });

    it("fails if manifest.yaml is missing (FR-001)", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
      
      // @ts-ignore
      await expect(installPlugin("./bad-dir")).rejects.toThrow(/No manifest.yaml found/);
    });

    it("fails if plugin already exists (FR-001)", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      
      // @ts-ignore
      await expect(installPlugin("./my-skill")).rejects.toThrow(/already installed/);
    });
  });

  describe("gwrk plugin list (FR-003 / US-002)", () => {
    it("lists installed plugins grouped by type", async () => {
      vi.mocked(fs.readdir).mockImplementation((p: any) => {
        if (p.endsWith("skills")) return Promise.resolve(["narrative"] as any);
        if (p.endsWith("agents")) return Promise.resolve(["claude"] as any);
        return Promise.resolve([]);
      });

      // @ts-ignore
      const output = await listPlugins();
      expect(output).toContain("narrative");
      expect(output).toContain("claude");
    });
  });

  describe("gwrk plugin remove (FR-004 / US-003)", () => {
    it("successfully removes an installed plugin", async () => {
      vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
      
      // @ts-ignore
      await removePlugin("narrative");
      expect(fs.rm).toHaveBeenCalledWith(path.join(mockGlobalDir, "skills", "narrative"), { recursive: true });
    });

    it("warns if dependencies exist (FR-004)", async () => {
      // Mocking dependent plugin discovery
      // This would require scanning all other plugins for 'composes'
      // For RED test, we expect it to fail or throw if dependencies exist and --force is not used
    });
  });
});
