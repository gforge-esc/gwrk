import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { migratePlugins } from "./migrate.js";
import { parse } from "yaml";

vi.mock("node:fs/promises");
vi.mock("node:os");

describe("TR-005: migrate()", () => {
  const mockHome = "/mock/home";
  const mockCwd = "/mock/project";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(os.homedir).mockReturnValue(mockHome);
    vi.spyOn(process, "cwd").mockReturnValue(mockCwd);
  });

  it("generates valid manifest.yaml from frontmatter in skills", async () => {
    const skillContent = `---
name: test-skill
description: A test skill
category: reasoning
---
# Test Skill
Test content`;

    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      if (dir === path.join(mockCwd, ".agents", "skills")) {
        return [{ name: "test-skill", isDirectory: () => true }] as any;
      }
      if (dir === path.join(mockCwd, ".agents", "workflows")) {
        return [] as any;
      }
      return [];
    });

    vi.mocked(fs.readFile).mockResolvedValue(skillContent);
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    await migratePlugins();

    const manifestPath = path.join(mockHome, ".gwrk", "plugins", "skills", "test-skill", "manifest.yaml");
    const manifestCall = vi.mocked(fs.writeFile).mock.calls.find(call => call[0] === manifestPath);
    
    expect(manifestCall).toBeDefined();
    const manifest = parse(manifestCall![1] as string);
    expect(manifest.name).toBe("test-skill");
    expect(manifest.description).toBe("A test skill");
    expect(manifest.category).toBe("reasoning");
    expect(manifest.type).toBe("skill");
  });

  it("migrates workflows and generates manifest.yaml", async () => {
    const workflowContent = `---
description: A test workflow
---
# Test Workflow
Test content`;

    vi.mocked(fs.readdir).mockImplementation(async (dir) => {
      if (dir === path.join(mockCwd, ".agents", "skills")) {
        return [] as any;
      }
      if (dir === path.join(mockCwd, ".agents", "workflows")) {
        return [{ name: "test-workflow.md", isFile: () => true, isDirectory: () => false }] as any;
      }
      return [];
    });

    vi.mocked(fs.readFile).mockResolvedValue(workflowContent);
    vi.mocked(fs.stat).mockRejectedValue(new Error("Not found"));

    await migratePlugins();

    const manifestPath = path.join(mockHome, ".gwrk", "plugins", "workflows", "test-workflow", "manifest.yaml");
    const manifestCall = vi.mocked(fs.writeFile).mock.calls.find(call => call[0] === manifestPath);
    
    expect(manifestCall).toBeDefined();
    const manifest = parse(manifestCall![1] as string);
    expect(manifest.name).toBe("test-workflow");
    expect(manifest.description).toBe("A test workflow");
    expect(manifest.type).toBe("workflow");
  });

  it("TR-P11-003: warns when .agents/ exists in target project", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    
    vi.mocked(fs.stat).mockImplementation(async (p) => {
      if (p === path.join(mockCwd, ".agents")) {
        return { isDirectory: () => true } as any;
      }
      throw new Error("Not found");
    });
    
    vi.mocked(fs.readdir).mockResolvedValue([]);

    await migratePlugins();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("[DEPRECATED] Legacy '.agents/' directory detected"),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Please run 'gwrk init'"),
    );

    warnSpy.mockRestore();
  });
});
