/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import type { ProjectProfile } from "../domain/types.js";
import { detectProfile } from "../engine/profile-detector.js";
import { type LoadedEnforcementCandidate, PluginLoader } from "./loader.js";
import {
  computePolicySkillDigest,
  readProjectPolicyLock,
} from "./policy-lock.js";
import {
  formatEffectivePolicyPrompt,
  resolveEffectivePolicy,
  resolveEnforcementSkills,
} from "./skill-runtime.js";

vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("./loader.js");
vi.mock("../engine/profile-detector.js");
vi.mock("../adapters/agents/index.js");
vi.mock("./policy-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./policy-lock.js")>();
  return {
    ...actual,
    readProjectPolicyLock: vi.fn().mockResolvedValue(undefined),
  };
});

function candidate(
  name: string,
  source: LoadedEnforcementCandidate["source"],
  selectors: Partial<LoadedEnforcementCandidate["manifest"]> = {},
): LoadedEnforcementCandidate {
  return {
    name,
    source,
    path: `/fake/${source}/${name}`,
    content: selectors.disabled
      ? undefined
      : `/fake/${source}/${name}/SKILL.md`,
    manifest: {
      type: "skill",
      tier: "enforcement",
      name,
      version: "1.0.0",
      description: name,
      scope: "all",
      ...selectors,
    },
  };
}

const profile: ProjectProfile = {
  type: "nodejs",
  stack: { language: "TypeScript", framework: "Express" },
  design: {
    architecture: "hexagonal-functional",
    principles: ["functional-core", "tdd"],
    templateVersion: "1.0.0",
  },
};

describe("FR-014: resolveEnforcementSkills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectProfile).mockResolvedValue(profile);
  });

  it("detects the profile and composes compatible architecture, language and framework rules", async () => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      candidate("typescript-standards", "builtin", { language: "TypeScript" }),
      candidate("express-standards", "global", {
        language: "TypeScript",
        framework: "Express",
        architectures: ["hexagonal-functional"],
        principles: ["functional-core"],
      }),
      candidate("fastify-standards", "global", {
        language: "TypeScript",
        framework: "Fastify",
      }),
      candidate("python-standards", "builtin", { language: "Python" }),
    ]);

    const policy = await resolveEffectivePolicy("/fake/root", {
      scope: "implementation",
    });

    expect(detectProfile).toHaveBeenCalledWith("/fake/root");
    expect(policy.design).toEqual(profile.design);
    expect(policy.architectureRules).not.toHaveLength(0);
    expect(policy.languageGuidance).toContain("interfaces");
    expect(policy.frameworkGuidance).toBeDefined();
    expect(policy.checksStatus).toBe("inactive");
    expect(policy.gaps).toEqual([]);
    expect(policy.selectedSkills.map(({ name }) => name)).toEqual([
      "typescript-standards",
      "express-standards",
    ]);
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("uses the highest compatible override and keeps the legacy prompt headers", async () => {
    const local = candidate("typescript-standards", "project-local", {
      language: "TypeScript",
    });
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      local,
      candidate("typescript-standards", "global", { language: "TypeScript" }),
      candidate("typescript-standards", "builtin", { language: "TypeScript" }),
    ]);

    const rendered = await resolveEnforcementSkills("/fake/root");
    expect(rendered).toContain(
      "<!-- enforcement-skill: typescript-standards -->",
    );
    expect(rendered).toContain(local.path);
    expect(rendered).not.toContain("/fake/global/typescript-standards");
    expect(rendered).not.toContain("/fake/builtin/typescript-standards");
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("suppresses lower copies when the local override is disabled", async () => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      candidate("typescript-standards", "project-local", { disabled: true }),
      candidate("typescript-standards", "builtin", { language: "TypeScript" }),
    ]);

    const policy = await resolveEffectivePolicy("/fake/root");
    expect(policy.selectedSkills).toEqual([]);
    expect(policy.excludedSkills).toEqual([
      {
        name: "typescript-standards",
        source: "project-local",
        reason: "disabled",
      },
      {
        name: "typescript-standards",
        source: "builtin",
        reason: "shadowed-by-override",
      },
    ]);
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("loads global standards without selectors and limits gwrk rules to verified projects", async () => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      candidate("custom-standards", "global"),
      candidate("gwrk-conventions", "builtin", { projectScope: "gwrk" }),
    ]);

    const external = await resolveEffectivePolicy("/fake/root", { profile });
    expect(external.selectedSkills.map(({ name }) => name)).toEqual([
      "custom-standards",
    ]);
    expect(external.excludedSkills).toContainEqual({
      name: "gwrk-conventions",
      source: "builtin",
      reason: "project-scope-mismatch",
    });

    const self = await resolveEffectivePolicy("/fake/root", {
      profile: { ...profile, _isGwrk: true },
      checksConfigured: true,
    });
    expect(self.selectedSkills.map(({ name }) => name)).toContain(
      "gwrk-conventions",
    );
    expect(self.checksStatus).toBe("configured");
  });

  it("reports a gap when the installed framework policy requires a different architecture", async () => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      candidate("custom-framework-standards", "project-local", {
        language: "TypeScript",
        framework: "Custom",
        architectures: ["layered"],
      }),
    ]);
    const policy = await resolveEffectivePolicy("/fake/root", {
      profile: { ...profile, stack: { ...profile.stack, framework: "Custom" } },
    });
    expect(policy.selectedSkills).toEqual([]);
    expect(policy.gaps).toContainEqual(
      expect.objectContaining({
        kind: "incompatible-framework-policy",
        subject: "Custom",
      }),
    );
    expect(formatEffectivePolicyPrompt(policy)).toContain(
      "No compatible policy found for framework Custom.",
    );
    expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("TR-P10-003: contains no legacy .agents/ path references", async () => {
    const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const source = realFs.readFileSync("src/plugins/skill-runtime.ts", "utf8");
    expect(source).not.toContain(".agents/skills/");
    expect(source.match(/\.agents\//g)).toBeNull();
  });

  it("FR-006: executeSkill passes preferredAgent and preferredModel to router and agent", async () => {
    const { executeSkill } = await import("./skill-runtime.js");
    const { createAgentPortAdapter } = await import(
      "../adapters/agents/index.js"
    );

    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: {
        name: "test-skill",
        type: "skill",
        tier: "atomic",
        version: "1.0.0",
        description: "desc",
        prompt: "test prompt",
        runtime: {
          preferredAgent: "claude",
          preferredModel: "claude-3-opus",
        },
      },
      path: "/fake/path/test-skill",
      status: "active",
    });

    const selectRoute = vi.fn().mockResolvedValue({
      backend: "claude",
      model: "claude-3-opus",
      effort: "high",
    });
    const execute = vi.fn().mockResolvedValue({
      stdout: "done",
      stderr: "",
      exitCode: 0,
      durationS: 1,
    });
    vi.mocked(createAgentPortAdapter).mockReturnValue({ selectRoute, execute });

    await executeSkill("test-skill");

    expect(selectRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredAgent: "claude",
        explicitModel: "claude-3-opus",
      }),
    );
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "claude",
        model: "claude-3-opus",
        env: { GWRK_EFFORT: "high" },
        stdin: expect.stringContaining("test prompt"),
      }),
    );
    expect(execute.mock.calls[0][0]).not.toHaveProperty("prompt");
  });

  describe("TR-008: FR-004 project policy lock resolution", () => {
    const tsManifest = {
      type: "skill" as const,
      tier: "enforcement" as const,
      name: "typescript-standards",
      version: "1.0.0",
      description: "TypeScript standards",
      scope: "all" as const,
      language: "TypeScript",
    };
    const tsContent = "# TypeScript Standards\n- Strict typing\n";
    const tsCandidate = {
      name: "typescript-standards",
      source: "global" as const,
      path: "/fake/global/typescript-standards",
      content: tsContent,
      manifest: tsManifest,
    };
    const extraCandidate1 = candidate("extra-skill-1", "global", {
      description: "User 1 extra skill",
    });
    const extraCandidate2 = candidate("extra-skill-2", "global", {
      description: "User 2 extra skill",
    });

    const testLock = {
      version: 1 as const,
      gwrkVersion: pkg.version,
      skills: [
        {
          name: "typescript-standards",
          source: "global" as const,
          version: "1.0.0",
          sha256: computePolicySkillDigest(tsManifest, tsContent),
        },
      ],
    };

    it("resolves the exact same effective policy across two isolated homes with unrelated installed skills", async () => {
      vi.mocked(readProjectPolicyLock).mockResolvedValue(testLock);

      vi.mocked(
        PluginLoader.prototype.listEnforcementCandidates,
      ).mockResolvedValueOnce([tsCandidate, extraCandidate1]);

      const policy1 = await resolveEffectivePolicy("/fake/root", {
        globalDir: "/home/user1/.gwrk/plugins",
      });

      vi.mocked(
        PluginLoader.prototype.listEnforcementCandidates,
      ).mockResolvedValueOnce([tsCandidate, extraCandidate2]);

      const policy2 = await resolveEffectivePolicy("/fake/root", {
        globalDir: "/home/user2/.gwrk/plugins",
      });

      expect(policy1.selectedSkills.map((s) => s.name)).toEqual([
        "typescript-standards",
      ]);
      expect(policy2.selectedSkills.map((s) => s.name)).toEqual([
        "typescript-standards",
      ]);
      expect(formatEffectivePolicyPrompt(policy1)).toBe(
        formatEffectivePolicyPrompt(policy2),
      );
    });

    it("preserves legacy resolution when the lock is absent", async () => {
      vi.mocked(readProjectPolicyLock).mockResolvedValue(undefined);

      vi.mocked(
        PluginLoader.prototype.listEnforcementCandidates,
      ).mockResolvedValueOnce([tsCandidate, extraCandidate1]);

      const legacy1 = await resolveEffectivePolicy("/fake/root", {
        globalDir: "/home/user1/.gwrk/plugins",
      });

      expect(legacy1.selectedSkills.map((s) => s.name)).toContain(
        "extra-skill-1",
      );
      expect(legacy1.selectedSkills.map((s) => s.name)).toContain(
        "typescript-standards",
      );
    });
  });
});
