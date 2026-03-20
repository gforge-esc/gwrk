import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// @ts-ignore - Module does not exist yet (RED)
import { PluginLoader } from "./loader.js";

vi.mock("node:fs/promises");

describe("FR-003 / FR-005 / TC-004 / TC-009 / FR-L1-012: Plugin Resolution Engine", () => {
  let loader: any;
  const mockGlobalDir = path.join(os.homedir(), ".gwrk", "plugins");
  const mockProjectDir = "/work/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    // @ts-ignore
    loader = new PluginLoader({
      globalDir: mockGlobalDir,
      projectDir: mockProjectDir
    });
  });

  it("US-002: scans global plugins directory and resolves by type (FR-003)", async () => {
    vi.mocked(fs.readdir).mockImplementation((p: any) => {
      if (p.endsWith("skills")) return Promise.resolve(["narrative"] as any);
      if (p.endsWith("agents")) return Promise.resolve(["gemini"] as any);
      return Promise.resolve([]);
    });

    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.includes("narrative")) return Promise.resolve('type: skill\nname: narrative\nversion: 1.0.0\ntier: atomic\ndescription: foo');
        if (p.includes("gemini")) return Promise.resolve('type: agent\nname: gemini\nversion: 1.0.0\ndescription: bar');
        return Promise.reject(new Error("File not found"));
    });

    const plugins = await loader.listPlugins();
    expect(plugins.map(p => p.name)).toContain("narrative");
    expect(plugins.map(p => p.name)).toContain("gemini");
  });

  it("FR-L1-012: user-installed global plugins override built-ins", async () => {
    // Built-in 'gemini' exists
    // User global 'gemini' exists
    const plugins = await loader.listPlugins();
    // Logic: built-in -> user-installed (overwrite)
    // We expect the user-installed one to win
  });

  it("TC-009: applies .gwrk/plugins.yaml local overrides", async () => {
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('override:\n  truth-extract: /local/path/truth-extract');
        }
        return Promise.reject(new Error("File not found"));
    });

    const plugin = await loader.resolvePlugin("truth-extract");
    expect(plugin.path).toBe("/local/path/truth-extract");
  });

  it("FR-005 / TC-004: applies local disables for workflows/domains (TC-009)", async () => {
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('disable:\n  - domains/writing');
        }
        return Promise.reject(new Error("File not found"));
    });

    const activePlugins = await loader.listPlugins({ activeOnly: true });
    expect(activePlugins.find(p => p.name === "writing")).toBeUndefined();
  });

  it("FR-005: rejects disable attempts for global-only types (skills, agents)", async () => {
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('disable:\n  - skills/narrative');
        }
        return Promise.reject(new Error("File not found"));
    });

    // Should either throw or ignore the disable for skills
    const plugin = await loader.resolvePlugin("narrative");
    expect(plugin).toBeDefined(); // Still resolves because skill cannot be disabled
  });
});
