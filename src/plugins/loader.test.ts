import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
// @ts-ignore - Module does not exist yet (RED)
import { PluginLoader } from "./loader.js";

vi.mock("node:fs");

describe("FR-003 / FR-005 / TC-009: Plugin Loader & Resolution", () => {
  const mockGlobalDir = path.join(os.homedir(), ".gwrk", "plugins");
  const mockLocalDir = ".gwrk";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-002: scans global plugin directory and resolves plugins", () => {
    // Mock directories
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation((dirPath: any) => {
      if (dirPath.includes("skills")) return ["truth-extract"] as any;
      if (dirPath.includes("agents")) return [] as any;
      if (dirPath.includes("workflows")) return [] as any;
      return [] as any;
    });

    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.includes("manifest.yaml")) {
        return `
type: skill
name: truth-extract
tier: atomic
version: 1.0.0
description: Extract truth
category: reasoning
prompt: "..."
interface: { input: stdin, output: stdout, exitCodes: {} }
runtime: { preferredAgent: gemini, preferredModel: "...", maxInputTokens: 1 }
` as any;
      }
      return "" as any;
    });

    const loader = new PluginLoader();
    const plugins = loader.listPlugins({ type: "skill" });

    expect(plugins).toHaveLength(1);
    expect(plugins[0].name).toBe("truth-extract");
  });

  it("US-004: resolution order: Global -> Local Override -> Local Disable", () => {
    // Global has 'narrative'
    // Local overrides 'narrative' with different path
    // Local disables 'domains/writing'

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation((filePath: any) => {
      if (filePath.includes("plugins.yaml")) {
        return `
disable:
  - domains/writing
override:
  narrative: ./local-skills/narrative
` as any;
      }
      return "{}" as any;
    });

    const loader = new PluginLoader({ projectRoot: "/project" });
    const resolution = loader.getResolution();

    expect(resolution.disabled).toContain("domains/writing");
    expect(resolution.overrides["narrative"]).toBe("./local-skills/narrative");
  });

  it("TC-004: Skills are global-only and reject local disable", () => {
    const loader = new PluginLoader();
    
    // We expect loader to have a method to check if a plugin can be disabled
    expect(loader.canDisable("skill", "truth-extract")).toBe(false);
    expect(loader.canDisable("domain", "writing")).toBe(true);
  });
});
