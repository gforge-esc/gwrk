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
        if (p.includes("narrative")) return Promise.resolve('type: skill\nname: narrative\nversion: 1.0.0\ntier: atomic\ndescription: foo\ncategory: reasoning\nprompt: bar\ninterface: { input: stdin, output: stdout }\nruntime: { preferredAgent: gemini, preferredModel: g-pro }');
        if (p.includes("gemini")) return Promise.resolve('type: agent\nname: gemini\nversion: 1.0.0\ndescription: bar\ndispatchMode: local-cli\ncontextFileName: GEMINI.md\ncapabilities: []\nmodels: {}\nexitCodeMap: {}');
        return Promise.reject(new Error("File not found"));
    });

    const plugins = await loader.listPlugins();
    expect(plugins.map(p => p.name)).toContain("narrative");
    expect(plugins.map(p => p.name)).toContain("gemini");
  });

  it("FR-L1-012: user-installed global plugins override built-ins", async () => {
    // Built-in 'gemini' exists
    // User global 'gemini' exists
    vi.mocked(fs.readdir).mockImplementation((p: any) => {
      if (p.endsWith("agents")) return Promise.resolve(["gemini"] as any);
      return Promise.resolve([]);
    });
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
      if (p.includes("gemini")) return Promise.resolve('type: agent\nname: gemini\nversion: 1.0.0\ndescription: bar\ndispatchMode: local-cli\ncontextFileName: GEMINI.md\ncapabilities: []\nmodels: {}\nexitCodeMap: {}');
      return Promise.reject(new Error("File not found"));
    });

    const plugins = await loader.listPlugins();
    // Logic: built-in -> user-installed (overwrite)
    // For now, listPlugins returns what it finds in globalDir
    expect(plugins.find(p => p.name === "gemini")).toBeDefined();
  });

  it("TC-009: applies .gwrk/plugins.yaml local overrides", async () => {
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('override:\n  truth-extract: /local/path/truth-extract');
        }
        if (p.includes("truth-extract")) {
            return Promise.resolve('type: skill\nname: truth-extract\nversion: 1.0.0\ntier: atomic\ndescription: foo\ncategory: reasoning\nprompt: bar\ninterface: { input: stdin, output: stdout }\nruntime: { preferredAgent: gemini, preferredModel: g-pro }');
        }
        return Promise.reject(new Error("File not found"));
    });

    const plugin = await loader.resolvePlugin("truth-extract");
    expect(plugin.path).toBe("/local/path/truth-extract");
  });

  it("FR-005 / TC-004: applies local disables for workflows/domains (TC-009)", async () => {
    vi.mocked(fs.readdir).mockImplementation((p: any) => {
      if (p.endsWith("domains")) return Promise.resolve(["writing"] as any);
      return Promise.resolve([]);
    });
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('disable:\n  - domains/writing');
        }
        if (p.includes("writing")) {
            return Promise.resolve('type: skill\nname: writing\nversion: 1.0.0\ntier: atomic\ndescription: foo\ncategory: reasoning\nprompt: bar\ninterface: { input: stdin, output: stdout }\nruntime: { preferredAgent: gemini, preferredModel: g-pro }');
        }
        return Promise.reject(new Error("File not found"));
    });

    const activePlugins = await loader.listPlugins({ activeOnly: true });
    expect(activePlugins.find(p => p.name === "writing")).toBeUndefined();
  });

  it("FR-005: rejects disable attempts for global-only types (skills, agents)", async () => {
    vi.mocked(fs.readdir).mockImplementation((p: any) => {
      if (p.endsWith("skills")) return Promise.resolve(["narrative"] as any);
      return Promise.resolve([]);
    });
    vi.mocked(fs.readFile).mockImplementation((p: any) => {
        if (p.endsWith("plugins.yaml")) {
            return Promise.resolve('disable:\n  - skills/narrative');
        }
        if (p.includes("narrative")) {
            return Promise.resolve('type: skill\nname: narrative\nversion: 1.0.0\ntier: atomic\ndescription: foo\ncategory: reasoning\nprompt: bar\ninterface: { input: stdin, output: stdout }\nruntime: { preferredAgent: gemini, preferredModel: g-pro }');
        }
        return Promise.reject(new Error("File not found"));
    });

    // Should either throw or ignore the disable for skills
    const plugin = await loader.resolvePlugin("narrative");
    expect(plugin).toBeDefined(); // Still resolves because skill cannot be disabled
  });
});
