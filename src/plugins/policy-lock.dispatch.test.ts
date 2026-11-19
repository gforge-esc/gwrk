/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pkg from "../../package.json" with { type: "json" };
import { dispatchToAgent } from "../utils/agent.js";
import {
  type ProjectPolicyLock,
  computePolicySkillDigest,
} from "./policy-lock.js";
import {
  formatEffectivePolicyPrompt,
  resolveEffectivePolicy,
} from "./skill-runtime.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));

describe("TR-009: FR-004 policy lock dispatch enforcement", () => {
  let root: string;

  const customManifest = {
    type: "skill" as const,
    name: "custom-policy",
    version: "1.0.0",
    description: "Custom project enforcement rule",
    tier: "enforcement" as const,
    scope: "all" as const,
  };
  const customContent = "# Custom Policy\n\n- Pinned custom rule.\n";

  const unpinnedManifest = {
    type: "skill" as const,
    name: "unpinned-policy",
    version: "1.0.0",
    description: "Unpinned policy rule",
    tier: "enforcement" as const,
    scope: "all" as const,
  };
  const unpinnedContent = "# Unpinned Policy\n\n- Unpinned rule.\n";

  const validLock: ProjectPolicyLock = {
    version: 1,
    gwrkVersion: pkg.version,
    skills: [
      {
        name: "custom-policy",
        source: "project-local",
        version: "1.0.0",
        sha256: computePolicySkillDigest(customManifest, customContent),
      },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    root = await mkdtemp(join(tmpdir(), "gwrk-policy-lock-dispatch-"));
    await mkdir(join(root, ".gwrk", "plugins", "skills", "custom-policy"), {
      recursive: true,
    });
    await mkdir(join(root, ".gwrk", "plugins", "skills", "unpinned-policy"), {
      recursive: true,
    });

    await writeFile(join(root, ".gwrk/plugins.json"), '{"inherits": false}');

    await writeFile(
      join(root, ".gwrkrc.json"),
      JSON.stringify({
        project: {
          name: "lock-dispatch-fixture",
          type: "nodejs",
          stack: { language: "TypeScript" },
        },
      }),
    );

    await writeFile(
      join(root, ".gwrk/plugins/skills/custom-policy/manifest.yaml"),
      "type: skill\nname: custom-policy\nversion: 1.0.0\ndescription: Custom project enforcement rule\ntier: enforcement\nscope: all\n",
    );
    await writeFile(
      join(root, ".gwrk/plugins/skills/custom-policy/SKILL.md"),
      customContent,
    );

    await writeFile(
      join(root, ".gwrk/plugins/skills/unpinned-policy/manifest.yaml"),
      "type: skill\nname: unpinned-policy\nversion: 1.0.0\ndescription: Unpinned policy rule\ntier: enforcement\nscope: all\n",
    );
    await writeFile(
      join(root, ".gwrk/plugins/skills/unpinned-policy/SKILL.md"),
      unpinnedContent,
    );

    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(validLock, null, 2),
    );
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("includes locked rules in captured dispatch and excludes unpinned rules", async () => {
    const template =
      "Test task\n<code_quality>\n{{enforcement}}\n</code_quality>";
    const result = await dispatchToAgent({
      workflow: "gwrk-implement",
      workDir: root,
      stdin: template,
      promptParts: {
        template,
        userInput: "test input",
      },
      dryRun: true,
      quiet: true,
      agent: "agy",
    });

    expect(result.stdout).toContain(
      "<!-- enforcement-skill: custom-policy -->",
    );
    expect(result.stdout).toContain("Pinned custom rule.");
    expect(result.stdout).not.toContain("unpinned-policy");
    expect(result.stdout).not.toContain("Unpinned rule.");
  });

  it("exercises WorkflowRuntime.executeWorkflow and includes locked payload", async () => {
    let capturedPrompt = "";
    const runtime = new WorkflowRuntime();
    await runtime.executeWorkflow("gwrk-specify", "Specify feature", {
      projectRoot: root,
      quiet: true,
      dispatcher: async (task) => {
        const result = await dispatchToAgent({
          ...task,
          agent: "codex",
          dryRun: true,
          quiet: true,
        });
        capturedPrompt = result.stdout;
        return {
          stdout: JSON.stringify({
            summary: "Captured specification",
            overview: "Test",
            requirements: [],
            intents: [],
          }),
          stderr: "",
          exitCode: 0,
          durationS: 0,
        };
      },
    });

    expect(capturedPrompt).toContain(
      "<!-- enforcement-skill: custom-policy -->",
    );
    expect(capturedPrompt).toContain("Pinned custom rule.");
    expect(capturedPrompt).not.toContain("unpinned-policy");
  });

  it("zero agent calls after lock failure due to digest mismatch in dispatchToAgent", async () => {
    const brokenLock: ProjectPolicyLock = {
      ...validLock,
      skills: [
        {
          ...validLock.skills[0],
          sha256:
            "0000000000000000000000000000000000000000000000000000000000000000",
        },
      ],
    };
    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(brokenLock, null, 2),
    );

    const template =
      "Test task\n<code_quality>\n{{enforcement}}\n</code_quality>";
    await expect(
      dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: root,
        stdin: template,
        promptParts: {
          template,
          userInput: "test input",
        },
        dryRun: false,
        quiet: true,
        agent: "agy",
      }),
    ).rejects.toThrow(
      /policy-lock\.json pin custom-policy from project-local requires/i,
    );

    expect(spawn).not.toHaveBeenCalled();
  });

  it("zero agent calls after lock failure due to version mismatch in WorkflowRuntime", async () => {
    const brokenLock: ProjectPolicyLock = {
      ...validLock,
      skills: [
        {
          ...validLock.skills[0],
          version: "2.0.0",
        },
      ],
    };
    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(brokenLock, null, 2),
    );

    const runtime = new WorkflowRuntime();

    await expect(
      runtime.executeWorkflow("gwrk-specify", "Specify feature", {
        projectRoot: root,
        quiet: true,
      }),
    ).rejects.toThrow(
      /policy-lock\.json pin custom-policy from project-local requires version 2\.0\.0/i,
    );

    expect(spawn).not.toHaveBeenCalled();
  });

  it("zero agent calls when gwrkVersion mismatches the lockfile", async () => {
    const mismatchedLock: ProjectPolicyLock = {
      ...validLock,
      gwrkVersion: "99.0.0",
    };
    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(mismatchedLock, null, 2),
    );

    const template =
      "Test task\n<code_quality>\n{{enforcement}}\n</code_quality>";
    await expect(
      dispatchToAgent({
        workflow: "gwrk-implement",
        workDir: root,
        stdin: template,
        promptParts: {
          template,
          userInput: "test input",
        },
        dryRun: false,
        quiet: true,
        agent: "agy",
      }),
    ).rejects.toThrow(/requires gwrk 99\.0\.0/i);

    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects mismatched disabled:false manifest digests against real disk manifests", async () => {
    const lockWithComputedDisabled: ProjectPolicyLock = {
      ...validLock,
      skills: [
        {
          ...validLock.skills[0],
          sha256: computePolicySkillDigest(
            { ...customManifest, disabled: false },
            customContent,
          ),
        },
      ],
    };
    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(lockWithComputedDisabled, null, 2),
    );
    await expect(resolveEffectivePolicy(root)).rejects.toThrow(
      /policy-lock\.json pin custom-policy from project-local requires/i,
    );

    await writeFile(
      join(root, ".gwrk/plugins/skills/custom-policy/manifest.yaml"),
      "type: skill\nname: custom-policy\nversion: 1.0.0\ndescription: Custom project enforcement rule\ntier: enforcement\nscope: all\ndisabled: false\n",
    );
    await writeFile(
      join(root, ".gwrk/policy-lock.json"),
      JSON.stringify(validLock, null, 2),
    );
    await expect(resolveEffectivePolicy(root)).rejects.toThrow(
      /policy-lock\.json pin custom-policy from project-local requires/i,
    );
  });

  it("resolves identical locked policy across two real isolated plugin homes and preserves legacy opt-in", async () => {
    const homesRoot = await mkdtemp(join(tmpdir(), "gwrk-policy-homes-"));
    try {
      const homeA = join(homesRoot, "home-a/.gwrk/plugins");
      const homeB = join(homesRoot, "home-b/.gwrk/plugins");
      const expressManifest = {
        type: "skill" as const,
        name: "express-standards",
        version: "1.2.0",
        description: "Express standards",
        tier: "enforcement" as const,
        scope: "all" as const,
        language: "TypeScript",
      };
      const expressYaml =
        "type: skill\nname: express-standards\nversion: 1.2.0\ndescription: Express standards\ntier: enforcement\nscope: all\nlanguage: TypeScript\n";
      const expressContent = "# Express Standards\n\n- Keep handlers thin.\n";

      for (const home of [homeA, homeB]) {
        await mkdir(join(home, "skills/express-standards"), {
          recursive: true,
        });
        await writeFile(
          join(home, "skills/express-standards/manifest.yaml"),
          expressYaml,
        );
        await writeFile(
          join(home, "skills/express-standards/SKILL.md"),
          expressContent,
        );
      }
      await mkdir(join(homeA, "skills/machine-a-extra"), { recursive: true });
      await writeFile(
        join(homeA, "skills/machine-a-extra/manifest.yaml"),
        "type: skill\nname: machine-a-extra\nversion: 1.0.0\ndescription: Machine A extra\ntier: enforcement\nscope: all\n",
      );
      await writeFile(
        join(homeA, "skills/machine-a-extra/SKILL.md"),
        "# Machine A Extra\n",
      );
      await mkdir(join(homeB, "skills/machine-b-extra"), { recursive: true });
      await writeFile(
        join(homeB, "skills/machine-b-extra/manifest.yaml"),
        "type: skill\nname: machine-b-extra\nversion: 1.0.0\ndescription: Machine B extra\ntier: enforcement\nscope: all\n",
      );
      await writeFile(
        join(homeB, "skills/machine-b-extra/SKILL.md"),
        "# Machine B Extra\n",
      );
      // Unpinned global copy on Machine B must not shadow the pinned builtin copy.
      await mkdir(join(homeB, "skills/typescript-standards"), {
        recursive: true,
      });
      await writeFile(
        join(homeB, "skills/typescript-standards/manifest.yaml"),
        "type: skill\nname: typescript-standards\nversion: 9.9.9\ndescription: Shadow\ntier: enforcement\nscope: all\nlanguage: TypeScript\n",
      );
      await writeFile(
        join(homeB, "skills/typescript-standards/SKILL.md"),
        "# Shadowed TypeScript Standards\n",
      );

      await rm(join(root, ".gwrk/plugins.json"), { force: true });
      const tsBuiltinContent = await readFile(
        "src/plugins/builtins/skills/typescript-standards/SKILL.md",
        "utf8",
      );
      const tsBuiltinManifest = {
        type: "skill" as const,
        name: "typescript-standards",
        version: "1.0.0",
        description: "TypeScript coding standards and toolchain compliance",
        tier: "enforcement" as const,
        scope: "all" as const,
        language: "TypeScript",
      };
      const twoHomeLock: ProjectPolicyLock = {
        version: 1,
        gwrkVersion: pkg.version,
        skills: [
          {
            name: "typescript-standards",
            source: "builtin",
            version: "1.0.0",
            sha256: computePolicySkillDigest(
              tsBuiltinManifest,
              tsBuiltinContent,
            ),
          },
          {
            name: "express-standards",
            source: "global",
            version: "1.2.0",
            sha256: computePolicySkillDigest(expressManifest, expressContent),
          },
        ],
      };
      await writeFile(
        join(root, ".gwrk/policy-lock.json"),
        JSON.stringify(twoHomeLock, null, 2),
      );

      const policyA = await resolveEffectivePolicy(root, { globalDir: homeA });
      const policyB = await resolveEffectivePolicy(root, { globalDir: homeB });

      expect(
        policyA.selectedSkills.map((s) => `${s.name}@${s.source}`),
      ).toEqual(["typescript-standards@builtin", "express-standards@global"]);
      expect(
        policyB.selectedSkills.map((s) => `${s.name}@${s.source}`),
      ).toEqual(["typescript-standards@builtin", "express-standards@global"]);
      expect(formatEffectivePolicyPrompt(policyA)).toBe(
        formatEffectivePolicyPrompt(policyB),
      );

      await rm(join(root, ".gwrk/policy-lock.json"), { force: true });
      const legacyA = await resolveEffectivePolicy(root, { globalDir: homeA });
      expect(legacyA.selectedSkills.map((s) => s.name)).toContain(
        "machine-a-extra",
      );
    } finally {
      await rm(homesRoot, { recursive: true, force: true });
    }
  });
});
