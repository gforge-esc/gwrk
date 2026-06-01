import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader } from "./loader.js";
import { resolveEnforcementSkills } from "./skill-runtime.js";

vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("./loader.js");

describe("FR-014: resolveEnforcementSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("TR-P9-001: returns builtin enforcement skill content", async () => {
    // Setup: mock PluginLoader to return an enforcement skill
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      {
        name: "gwrk-conventions",
        type: "skill",
        tier: "enforcement",
        version: "1.0.0",
        description: "desc",
        status: "active",
      },
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: {
        name: "gwrk-conventions",
        type: "skill",
        tier: "enforcement",
        version: "1.0.0",
        description: "desc",
      },
      path: "/fake/path/gwrk-conventions",
      status: "active",
    });

    const builtinContent = "# GWRK Conventions\n- No .agents/ directory";
    vi.mocked(fsp.readFile).mockResolvedValue(builtinContent);

    const skills = await resolveEnforcementSkills("/fake/root");
    expect(skills).toContain("GWRK Conventions");
  });

  it("TR-P9-002 / ADR-007: project-local skill overrides builtin", async () => {
    // Setup: mock PluginLoader to return an enforcement skill
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      {
        name: "typescript-standards",
        type: "skill",
        tier: "enforcement",
        version: "1.0.0",
        description: "desc",
        status: "active",
      },
    ]);

    // resolvePlugin should return the local one if available (PluginLoader handles this, so we just mock its return)
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: {
        name: "typescript-standards",
        type: "skill",
        tier: "enforcement",
        version: "1.0.0",
        description: "desc",
      },
      path: "/project/local/path/typescript-standards",
      status: "active",
    });

    const localContent = "# Local Standards\n- Use Biome";
    vi.mocked(fsp.readFile).mockResolvedValue(localContent);

    const skills = await resolveEnforcementSkills("/fake/root");
    expect(skills).toContain("Local Standards");
  });

  it("TR-P10-003: contains no legacy .agents/ path references", async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const source = realFs.readFileSync("src/plugins/skill-runtime.ts", "utf8");
    expect(source).not.toContain(".agents/skills/");
    expect(source.match(/\.agents\//g)).toBeNull();
  });
});
