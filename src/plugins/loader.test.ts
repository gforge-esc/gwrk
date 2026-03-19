import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PluginLoader } from "./loader";

vi.mock("node:fs");

describe("FR-003, FR-005: Plugin Resolution and Loading", () => {
  const globalPath = "/Users/test/.gwrk/plugins";
  const projectRoot = "/Users/test/Code/project";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("TR-002: should resolve from global plugins directory", async () => {
    const loader = new PluginLoader({ globalPath });
    
    // Mock existence of a global skill
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== "string") return false;
      return p.includes(globalPath) && p.includes("skills/truth-extract");
    });

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      type: "skill",
      name: "truth-extract",
      tier: "atomic",
      version: "1.0.0",
      description: "Extract truth"
    }));

    const plugin = await loader.getPlugin("truth-extract", { projectRoot });
    expect(plugin.name).toBe("truth-extract");
    expect(fs.existsSync).toHaveBeenCalledWith(
      expect.stringContaining(path.join(globalPath, "skills/truth-extract"))
    );
  });

  it("US-004: should resolve local overrides from .gwrk/plugins.yaml", async () => {
    const loader = new PluginLoader({ globalPath });
    
    // Mock .gwrk/plugins.yaml with an override
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== "string") return false;
      return p.includes(".gwrk/plugins.yaml") || p.includes("local-skills/my-skill");
    });

    vi.mocked(fs.readFileSync).mockImplementation((p) => {
      if (typeof p !== "string") return "";
      if (p.includes(".gwrk/plugins.yaml")) {
        return "override:\n  my-skill: ../local-skills/my-skill";
      }
      return JSON.stringify({
        type: "skill",
        name: "my-skill",
        tier: "atomic",
        version: "1.0.0",
        description: "Local override"
      });
    });

    const plugin = await loader.getPlugin("my-skill", { projectRoot });
    expect(plugin.description).toBe("Local override");
  });

  it("TC-009: should reject disabled plugins", async () => {
    const loader = new PluginLoader({ globalPath });

    // Mock .gwrk/plugins.yaml with a disable
    vi.mocked(fs.existsSync).mockImplementation((p) => {
      if (typeof p !== "string") return false;
      return p.includes(".gwrk/plugins.yaml");
    });

    vi.mocked(fs.readFileSync).mockReturnValue("disable:\n  - domains/writing");

    await expect(loader.getPlugin("domains/writing", { projectRoot }))
      .rejects.toThrow("Plugin 'domains/writing' is disabled in this project");
  });

  it("should scan both built-ins and user plugins in listPlugins()", async () => {
    const loader = new PluginLoader({ globalPath });

    vi.mocked(fs.readdirSync).mockImplementation((p) => {
      if (typeof p !== "string") return [];
      if (p.includes("skills")) return ["truth-extract"] as unknown as fs.Dirent[];
      return [] as unknown as fs.Dirent[];
    });

    const plugins = await loader.listPlugins();
    // Assuming 'truth-extract' is found in global skills
    expect(plugins.some(p => p.name === "truth-extract")).toBe(true);
  });
});
