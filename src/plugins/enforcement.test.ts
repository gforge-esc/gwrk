/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader } from "./loader.js";
import { SkillManifestSchema } from "./manifest.js";
import {
  resolveEffectivePolicy,
  resolveEnforcementSkills,
} from "./skill-runtime.js";

// Mock child_process for TR-P9-005
vi.mock("node:child_process", () => {
  return {
    spawn: vi.fn(),
  };
});

// Mock config to disable throttle for TR-P9-005
vi.mock("../utils/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/config.js")>()),
  loadConfig: vi.fn().mockReturnValue({
    agents: {
      throttleMs: 0,
      define: "agy",
      implement: "agy",
    },
    project: { name: "test" },
    server: { port: 18790, host: "localhost" },
    parallelism: { local: {}, cloud: {} },
  }),
}));

// Mock DB to avoid side effects
vi.mock("../db/plugins.js", () => ({
  recordRoutingDecision: vi.fn(),
}));

describe("Phase 9: Enforcement Skills", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-enforcement-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  /**
   * TR-P9-003: tier: enforcement validates in SkillManifestSchema
   */
  describe("TR-P9-003: SkillManifestSchema enforcement tier", () => {
    it("accepts tier: enforcement with scope: implementation", () => {
      const manifest = {
        type: "skill" as const,
        name: "typescript-standards",
        tier: "enforcement" as const,
        version: "1.0.0",
        description: "TypeScript coding standards for gwrk projects",
        scope: "implementation",
        tags: [],
      };

      const result = SkillManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tier).toBe("enforcement");
        // @ts-ignore - scope exists on EnforcementSkillManifest
        expect(result.data.scope).toBe("implementation");
      }
    });

    it("accepts enforcement skill without scope", () => {
      const manifest = {
        type: "skill" as const,
        name: "optional-enforcement",
        tier: "enforcement" as const,
        version: "1.0.0",
        description: "Missing scope field is now allowed",
        tags: [],
      };

      const result = SkillManifestSchema.safeParse(manifest);
      expect(result.success).toBe(true);
    });
  });

  /**
   * TR-P9-001: resolveEnforcementSkills() returns builtin SKILL.md content
   */
  describe("TR-P9-001: resolveEnforcementSkills() builtins", () => {
    it("returns builtin enforcement skill content", async () => {
      const content = await resolveEnforcementSkills(process.cwd());
      expect(content).toContain("typescript-standards");
      expect(content).toContain("gwrk-conventions");
      expect(content.length).toBeGreaterThan(100);
    });

    it("uses JavaScript guidance in an external project named gwrk", async () => {
      const projectRoot = path.join(tmpDir, "external");
      const home = path.join(tmpDir, "home");
      await Promise.all([fs.mkdir(projectRoot), fs.mkdir(home)]);
      await fs.writeFile(
        path.join(projectRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: "gwrk" } }),
      );
      await fs.writeFile(
        path.join(projectRoot, "package.json"),
        JSON.stringify({ name: "gwrk", type: "module" }),
      );
      vi.stubEnv("HOME", home);
      try {
        const content = await resolveEnforcementSkills(
          projectRoot,
          "implementation",
        );
        expect
          .soft(content)
          .toContain("<!-- enforcement-skill: javascript-standards -->");
        expect
          .soft(content)
          .not.toContain("<!-- enforcement-skill: typescript-standards -->");
        expect
          .soft(content)
          .not.toContain("<!-- enforcement-skill: gwrk-conventions -->");
      } finally {
        vi.unstubAllEnvs();
      }
    });
  });

  /**
   * TR-P9-002: Project-local override takes precedence over builtin
   */
  describe("TR-P9-002: enforcement skill resolution order", () => {
    it("preserves a disabled local copy and an explicit project enable", async () => {
      const name = "fixture-enforcement";
      const globalDir = path.join(tmpDir, "global");
      const projectConfig = path.join(tmpDir, ".gwrk", "plugins.json");
      const layers = [
        [path.join(tmpDir, ".gwrk", "plugins"), true],
        [globalDir, false],
      ] as const;
      for (const [base, disabled] of layers) {
        const dir = path.join(base, "skills", name);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(
          path.join(dir, "manifest.yaml"),
          JSON.stringify({
            type: "skill",
            tier: "enforcement",
            name,
            version: "1.0.0",
            description: name,
            disabled,
          }),
        );
        await fs.writeFile(path.join(dir, "SKILL.md"), base);
      }
      const options = { globalDir, profile: { type: "unknown" } };
      const disabled = await resolveEffectivePolicy(tmpDir, options);
      expect(
        disabled.selectedSkills.find((skill) => skill.name === name),
      ).toBeUndefined();
      expect(disabled.excludedSkills).toContainEqual({
        name,
        source: "global",
        reason: "shadowed-by-override",
      });

      await fs.writeFile(
        projectConfig,
        JSON.stringify({ plugins: { [name]: { enabled: true } } }),
      );
      const enabled = await resolveEffectivePolicy(tmpDir, options);
      expect(enabled.selectedSkills).toContainEqual(
        expect.objectContaining({
          name,
          source: "project-local",
          content: layers[0][0],
        }),
      );
    });

    it("prefers project-local .gwrk/plugins/skills/ over builtin", async () => {
      const projectPluginDir = path.join(
        tmpDir,
        ".gwrk",
        "plugins",
        "skills",
        "typescript-standards",
      );
      await fs.mkdir(projectPluginDir, { recursive: true });

      const manifest = {
        type: "skill",
        name: "typescript-standards",
        version: "2.0.0",
        description: "Local override",
        tier: "enforcement",
        scope: "implementation",
      };
      await fs.writeFile(
        path.join(projectPluginDir, "manifest.yaml"),
        JSON.stringify(manifest),
      );
      await fs.writeFile(
        path.join(projectPluginDir, "SKILL.md"),
        "# LOCAL OVERRIDE CONTENT",
      );

      const content = await resolveEnforcementSkills(tmpDir);
      expect(content).toContain("LOCAL OVERRIDE CONTENT");
      expect(content).not.toContain(
        "Strict adherence to these standards is required",
      );
    });
  });

  /**
   * TR-P9-006: gwrk-conventions SKILL.md content validation
   */
  describe("TR-P9-006: gwrk-conventions content", () => {
    it("contains valid task status enum values and commit identity rules", async () => {
      const builtInBase = path.join(
        process.cwd(),
        "src",
        "plugins",
        "builtins",
      );
      const skillPath = path.join(
        builtInBase,
        "skills",
        "gwrk-conventions",
        "SKILL.md",
      );

      const content = await fs.readFile(skillPath, "utf-8");
      expect(content).toContain("open");
      expect(content).toContain("in_progress");
      expect(content).toContain("completed");
      expect(content).toContain("cancelled");
      expect(content).toMatch(/git.*author|commit.*identity/i);
    });
  });

  /**
   * TR-P9-004: gwrk plugin list shows enforcement skills
   */
  describe("TR-P9-004: enforcement skills in plugin listing", () => {
    it("PluginLoader includes enforcement skills from builtins", async () => {
      const loader = new PluginLoader();
      const plugins = await loader.listPlugins();

      const enforcementSkills = plugins.filter((p) => p.tier === "enforcement");
      expect(enforcementSkills.length).toBeGreaterThanOrEqual(2);
      expect(
        enforcementSkills.some((p) => p.name === "typescript-standards"),
      ).toBe(true);
      expect(enforcementSkills.some((p) => p.name === "gwrk-conventions")).toBe(
        true,
      );
    });

    it("gwrk plugin list command output contains enforcement skills with tier", async () => {
      const { listPlugins } = await import("../commands/plugin.js");
      const output = await listPlugins();

      // We expect the name and the tier to be present
      expect(output).toContain("typescript-standards");
      expect(output).toContain("gwrk-conventions");
      expect(output).toContain("[enforcement]");
    });
  });

  /**
   * TR-P9-005: dispatchToAgent() stdin includes enforcement skill content
   */
  describe("TR-P9-005: dispatch context assembly", () => {
    it("expands the trusted enforcement slot without an inference call", async () => {
      const skillRuntime = await import("./skill-runtime.js");
      const { dispatchToAgent } = await import("../utils/agent.js");
      const { spawn } = await import("node:child_process");
      const resolve = vi
        .spyOn(skillRuntime, "resolveEnforcementSkills")
        .mockResolvedValue("# MOCK ENFORCEMENT CONTENT");
      const result = await dispatchToAgent({
        type: "implement",
        agent: "agy",
        workDir: tmpDir,
        promptParts: {
          template: "Rules:\n<code_quality>\n{{enforcement}}\n</code_quality>",
          userInput: "test",
        },
        dryRun: true,
        quiet: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("MOCK ENFORCEMENT CONTENT");
      expect(result.stdout).not.toContain("{{enforcement}}");
      expect(resolve).toHaveBeenCalledOnce();
      expect(spawn).not.toHaveBeenCalled();
    });
  });
});
