/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { DesignSchema } from "./architecture-context.js";
import {
  mergeProfileOverrides,
  resolveWorkspacePolicyProfile,
} from "./profile-policy.js";
import {
  getSourceExtension,
  getTestCommand,
  getTestExtension,
  resolveBuildCommand,
} from "./toolchain.js";
import type { ProjectProfile, WorkspaceProfileConfig } from "./types.js";

const design = DesignSchema.parse({
  architecture: "hexagonal-functional",
  principles: ["functional-core", "clean-code", "tdd"],
});
const detected: ProjectProfile = {
  type: "python",
  stack: { language: "Python", framework: "FastAPI", buildSystem: "uv" },
  layout: "src-nested",
  toolchain: { primary: "ruff", test: "pytest", build: "uv build" },
};

describe("FR-001: profile design inheritance (044 phase p01)", () => {
  it("TR-005: attaches the complete project design without changing detected fields", () => {
    const result = mergeProfileOverrides({ detected, projectDesign: design });
    expect(result).toEqual({ ...detected, design });
    expect(DesignSchema.parse(result.design)).toEqual(design);
  });

  it("TR-005: preserves the complete legacy profile when design is missing", () => {
    expect(mergeProfileOverrides({ detected })).toEqual(detected);
    expect(mergeProfileOverrides({ detected }).design).toBeUndefined();
  });

  it("TR-005: merges partial overrides in detected, project, workspace order", () => {
    const workspaceDesign = DesignSchema.parse({
      architecture: "layered",
      principles: [],
    });
    expect(
      mergeProfileOverrides({
        detected,
        projectDesign: design,
        projectType: "service",
        projectStack: { framework: "Django" },
        projectLayout: "flat",
        projectToolchain: { test: "pytest", formatter: "black" },
        workspaceConfig: {
          type: "api",
          stack: { framework: "FastAPI" },
          layout: "src-nested",
          toolchain: { build: null, test: null },
          design: workspaceDesign,
        },
      }),
    ).toEqual({
      type: "api",
      stack: { language: "Python", framework: "FastAPI", buildSystem: "uv" },
      layout: "src-nested",
      toolchain: {
        primary: "ruff",
        formatter: "black",
        test: null,
        build: null,
      },
      design: workspaceDesign,
    });
  });

  it("TR-005: leaves frozen inputs unchanged across repeated calls", () => {
    const input = {
      detected: structuredClone(detected),
      projectDesign: structuredClone(design),
    };
    Object.freeze(input.detected.stack);
    Object.freeze(input.detected.toolchain);
    Object.freeze(input.detected);
    Object.freeze(input.projectDesign.principles);
    Object.freeze(input.projectDesign);
    Object.freeze(input);
    const before = structuredClone(input);
    const first = mergeProfileOverrides(input);
    expect(mergeProfileOverrides(input)).toEqual(first);
    expect(input).toEqual(before);
    expect(first).toEqual({ ...detected, design });
  });

  it("TR-005: preserves an unknown profile without inventing design or stack", () => {
    expect(mergeProfileOverrides({ detected: { type: "unknown" } })).toEqual({
      type: "unknown",
    });
  });

  it("TR-005: inherits root design and toolchain with workspace field overrides", () => {
    expect(
      resolveWorkspacePolicyProfile("services/api", detected, {
        project: {
          design,
          stack: { language: "TypeScript" },
          toolchain: { test: "vitest", formatter: "black" },
        },
        workspaces: { "services/api": { toolchain: { build: null } } },
      }),
    ).toEqual({
      ...detected,
      design,
      toolchain: {
        primary: "ruff",
        test: "pytest",
        formatter: "black",
        build: null,
      },
    });
  });

  it("uses the Python fallback when the root runner is incompatible", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api",
      { type: "python", stack: { language: "Python" } },
      {
        project: { design, toolchain: { test: "vitest" } },
        workspaces: { "services/api": { toolchain: { build: null } } },
      },
    );

    expect(result).toMatchObject({ design, toolchain: { build: null } });
    expect(getTestCommand(result, ["test_api.py"])).toBe(
      "pytest test_api.py -v",
    );
  });

  it("checks root test defaults against the workspace language override", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api",
      { type: "unknown", stack: { language: "TypeScript" } },
      {
        project: {
          design,
          stack: { language: "TypeScript" },
          toolchain: { testCommand: "pnpm exec vitest run {files}" },
        },
        workspaces: { "services/api": { stack: { language: "Python" } } },
      },
    );

    expect(getTestCommand(result, ["test_api.py"])).toBe(
      "pytest test_api.py -v",
    );
  });

  it.each([
    {
      scenario: "different language family",
      language: "Python",
      overrides: {},
      expected: { language: "Python" },
    },
    {
      scenario: "explicit workspace metadata",
      language: "Python",
      overrides: { framework: "Django", buildSystem: "uv" },
      expected: { language: "Python", framework: "Django", buildSystem: "uv" },
    },
    {
      scenario: "same language family",
      language: "TypeScript",
      overrides: {},
      expected: {
        language: "TypeScript",
        framework: "Next.js",
        buildSystem: "npm",
      },
    },
  ])(
    "resolves stack metadata with $scenario",
    ({ language, overrides, expected }) => {
      const result = resolveWorkspacePolicyProfile(
        "services/api",
        {
          type: "nodejs",
          stack: {
            language: "JavaScript",
            framework: "Next.js",
            buildSystem: "npm",
          },
        },
        {
          project: { design },
          workspaces: { "services/api": { stack: { language, ...overrides } } },
        },
      );

      expect(result.design).toEqual(design);
      expect(result.stack).toStrictEqual(expected);
    },
  );

  it("keeps a compatible detected runner while filtering build and discovery for a language override", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api",
      {
        type: "polyglot-monorepo",
        stack: { language: "TypeScript", languages: ["TypeScript", "Python"] },
        toolchain: {
          test: "pytest",
          build: "pnpm build",
          testExtension: ".test.ts",
        },
      },
      {
        project: { design },
        workspaces: { "services/api": { stack: { language: "Python" } } },
      },
    );

    expect(result.toolchain).toEqual({ test: "pytest" });
    expect(getTestExtension(result)).toBe(".py");
  });

  it("filters root build and discovery defaults when only the root tools identify the language", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api",
      { type: "python", stack: { language: "Python" } },
      {
        project: {
          design,
          toolchain: {
            test: "vitest",
            build: "pnpm build",
            testExtension: ".test.ts",
            sourceExtension: ".ts",
          },
        },
      },
    );

    expect(result.design).toEqual(design);
    expect.soft(result.toolchain?.build).toBeUndefined();
    expect.soft(getTestExtension(result)).toBe(".py");
    expect.soft(getSourceExtension(result)).toBe(".py");
    expect(getTestCommand(result, ["test_api.py"])).toBe(
      "pytest test_api.py -v",
    );
  });

  it("shares test defaults between JavaScript and TypeScript", () => {
    const result = resolveWorkspacePolicyProfile(
      "apps/web",
      { type: "nodejs", stack: { language: "JavaScript" } },
      {
        project: {
          design,
          stack: { language: "TypeScript" },
          toolchain: { test: "jest", testCommand: "pnpm exec jest {files}" },
        },
      },
    );

    expect(getTestCommand(result, ["app.test.js"])).toBe(
      "pnpm exec jest app.test.js",
    );
  });

  it("prefers detected Jest over a compatible root Vitest runner", () => {
    const result = resolveWorkspacePolicyProfile(
      "apps/web",
      {
        type: "nodejs",
        stack: { language: "JavaScript" },
        toolchain: { test: "jest" },
      },
      {
        project: {
          design,
          stack: { language: "TypeScript" },
          toolchain: { test: "vitest" },
        },
        workspaces: { "apps/web": { toolchain: { build: null } } },
      },
    );

    expect(result).toMatchObject({
      design,
      toolchain: { test: "jest", build: null },
    });
    expect(getTestCommand(result, ["app.test.js"])).toBe(
      "npx jest app.test.js",
    );
  });

  it("keeps npm build selection under a pnpm root with the same language family", () => {
    const result = resolveWorkspacePolicyProfile(
      "apps/web",
      { type: "nodejs", stack: { language: "JavaScript", buildSystem: "npm" } },
      {
        project: {
          design,
          stack: { language: "TypeScript", buildSystem: "pnpm" },
          toolchain: { build: "pnpm build" },
        },
      },
    );
    expect(result.design).toEqual(design);
    expect(
      resolveBuildCommand(result, {
        hasPackageJson: true,
        hasPackageBuildScript: true,
      }),
    ).toBe("npm run build");
  });

  it.each([
    { toolchain: undefined, command: "npm run build" },
    { toolchain: { build: "npm run bundle" }, command: "npm run bundle" },
    { toolchain: { build: null }, command: null },
  ])(
    "resolves build to $command when the workspace only identifies its build system",
    ({ toolchain, command }) => {
      const result = resolveWorkspacePolicyProfile(
        "apps/web",
        { type: "nodejs", stack: { buildSystem: "npm" } },
        {
          project: {
            design,
            stack: { language: "TypeScript", buildSystem: "pnpm" },
            toolchain: { build: "pnpm build" },
          },
          workspaces: { "apps/web": { toolchain } },
        },
      );

      expect(result.design).toEqual(design);
      expect(
        resolveBuildCommand(result, {
          hasPackageJson: true,
          hasPackageBuildScript: true,
        }),
      ).toBe(command);
    },
  );

  it.each([
    {
      localToolchain: {
        test: "jest",
        build: "npm run build",
        testCommand: "npm test -- {files}",
      },
      entryToolchain: undefined,
      buildCommand: "pnpm build",
      testCommand: "npx jest app.test.js",
    },
    {
      localToolchain: { test: null, build: null },
      entryToolchain: undefined,
      buildCommand: null,
      testCommand: null,
    },
    {
      localToolchain: {
        test: "jest",
        build: "npm run build",
        testCommand: "npm test -- {files}",
      },
      entryToolchain: {
        build: "pnpm bundle",
        testCommand: "pnpm test -- {files}",
      },
      buildCommand: "pnpm bundle",
      testCommand: "pnpm test -- app.test.js",
    },
  ] satisfies {
    localToolchain: WorkspaceProfileConfig["toolchain"];
    entryToolchain: WorkspaceProfileConfig["toolchain"];
    buildCommand: string | null;
    testCommand: string | null;
  }[])(
    "resolves local commands with an implicit npm stack: $buildCommand",
    ({ localToolchain, entryToolchain, buildCommand, testCommand }) => {
      const profile = resolveWorkspacePolicyProfile(
        "apps/web",
        {
          type: "nodejs",
          stack: { language: "JavaScript", buildSystem: "npm" },
        },
        {
          project: { design },
          workspaces: {
            "apps/web": {
              stack: { buildSystem: "pnpm" },
              toolchain: entryToolchain,
            },
          },
        },
        {
          localProject: {
            toolchain: localToolchain,
          },
        },
      );
      expect(profile.stack?.buildSystem).toBe("pnpm");
      expect
        .soft(
          resolveBuildCommand(profile, {
            hasPackageJson: true,
            hasPackageBuildScript: true,
            hasPnpmLock: true,
          }),
        )
        .toBe(buildCommand);
      expect(getTestCommand(profile, ["app.test.js"])).toBe(testCommand);
    },
  );

  it.each([
    {
      localStack: { language: "TypeScript" },
      entryToolchain: undefined,
      source: ".js",
      test: ".test.js",
    },
    {
      localStack: undefined,
      entryToolchain: undefined,
      source: ".js",
      test: ".test.js",
    },
    {
      localStack: { language: "TypeScript" },
      entryToolchain: { sourceExtension: ".mjs", testExtension: ".spec.mjs" },
      source: ".mjs",
      test: ".spec.mjs",
    },
  ])(
    "uses $source and $test when a workspace entry selects JavaScript",
    ({ localStack, entryToolchain, source, test }) => {
      const profile = resolveWorkspacePolicyProfile(
        "apps/web",
        { type: "nodejs", stack: { language: "TypeScript" } },
        {
          project: { design },
          workspaces: {
            "apps/web": {
              stack: { language: "JavaScript" },
              toolchain: entryToolchain,
            },
          },
        },
        {
          localProject: {
            stack: localStack,
            toolchain: {
              test: "jest",
              sourceExtension: ".ts",
              testExtension: ".test.ts",
            },
          },
        },
      );

      expect(profile.design).toEqual(design);
      expect.soft(getSourceExtension(profile)).toBe(source);
      expect.soft(getTestExtension(profile)).toBe(test);
      expect(getTestCommand(profile, [`app${test}`])).toBe(
        `npx jest app${test}`,
      );
    },
  );

  it.each([
    {
      localToolchain: {
        test: "jest",
        build: "npm run build",
        testCommand: "npm test -- {files}",
      },
      entryToolchain: undefined,
      buildCommand: "pnpm build",
      testCommand: "npx jest app.test.ts",
    },
    {
      localToolchain: { test: null, build: null },
      entryToolchain: undefined,
      buildCommand: null,
      testCommand: null,
    },
    {
      localToolchain: {
        test: "jest",
        build: "npm run build",
        testCommand: "npm test -- {files}",
      },
      entryToolchain: {
        build: "pnpm bundle",
        testCommand: "pnpm test -- {files}",
      },
      buildCommand: "pnpm bundle",
      testCommand: "pnpm test -- app.test.ts",
    },
  ] satisfies {
    localToolchain: WorkspaceProfileConfig["toolchain"];
    entryToolchain: WorkspaceProfileConfig["toolchain"];
    buildCommand: string | null;
    testCommand: string | null;
  }[])(
    "resolves local npm overrides under a workspace entry selecting pnpm: $buildCommand",
    ({ localToolchain, entryToolchain, buildCommand, testCommand }) => {
      const profile = resolveWorkspacePolicyProfile(
        "apps/web",
        {
          type: "nodejs",
          stack: { language: "TypeScript", buildSystem: "pnpm" },
        },
        {
          project: { design },
          workspaces: {
            "apps/web": {
              stack: { buildSystem: "pnpm" },
              toolchain: entryToolchain,
            },
          },
        },
        {
          localProject: {
            stack: { language: "TypeScript", buildSystem: "npm" },
            toolchain: localToolchain,
          },
        },
      );

      expect(profile).toMatchObject({ design, stack: { buildSystem: "pnpm" } });
      expect
        .soft(
          resolveBuildCommand(profile, {
            hasPackageJson: true,
            hasPackageBuildScript: true,
            hasPnpmLock: true,
          }),
        )
        .toBe(buildCommand);
      expect(getTestCommand(profile, ["app.test.ts"])).toBe(testCommand);
    },
  );

  it("drops local stack and tools when the registered workspace selects a different language", () => {
    const local = {
      stack: {
        language: "TypeScript",
        framework: "Next.js",
        buildSystem: "pnpm",
      },
      toolchain: { test: "jest", build: "pnpm build" },
    } satisfies WorkspaceProfileConfig;
    const profile = resolveWorkspacePolicyProfile(
      "services/api",
      { type: "polyglot-monorepo", stack: local.stack },
      {
        project: { design },
        workspaces: { "services/api": { stack: { language: "Python" } } },
      },
      {
        localProject: local,
        detectedStacks: [
          local.stack,
          { language: "Python", framework: "Django", buildSystem: "uv" },
        ],
      },
    );
    expect.soft(profile.stack).toMatchObject({
      language: "Python",
      framework: "Django",
      buildSystem: "uv",
    });
    expect.soft(resolveBuildCommand(profile)).toBeNull();
    expect(getTestCommand(profile, ["test_api.py"])).toBe(
      "pytest test_api.py -v",
    );
  });

  it.each([
    { test: "pytest" as const, command: "pytest test_api.py -v" },
    { test: null, command: null },
  ])(
    "keeps a compatible local runner or explicit disablement ($test) across a language override",
    ({ test, command }) => {
      const profile = resolveWorkspacePolicyProfile(
        "services/api",
        { type: "nodejs", stack: { language: "TypeScript" } },
        {
          project: {
            design,
            stack: { language: "Python", buildSystem: "uv" },
            toolchain: {
              testCommand: "uv run pytest {files}",
              build: "uv build",
            },
          },
          workspaces: {
            "services/api": {
              stack: { language: "Python", buildSystem: "uv" },
            },
          },
        },
        {
          localProject: {
            stack: { language: "TypeScript" },
            toolchain: { test, build: null },
          },
        },
      );

      expect.soft(profile.toolchain).toEqual({ test, build: null });
      expect(getTestCommand(profile, ["test_api.py"])).toBe(command);
    },
  );

  it("TR-005: selects the longest workspace ancestor for a nested path", () => {
    const nestedDesign = DesignSchema.parse({
      architecture: "clean",
      principles: ["tdd"],
    });
    const result = resolveWorkspacePolicyProfile(
      "services/api/admin/src",
      detected,
      {
        project: { design },
        workspaces: {
          "services/api": { stack: { framework: "Django" } },
          "services/api/admin": {
            design: nestedDesign,
            stack: { framework: "FastAPI" },
          },
        },
      },
    );
    expect(result.design).toEqual(nestedDesign);
    expect(result.stack).toEqual(detected.stack);
  });

  it("TR-005: does not apply a sibling workspace with a shared path prefix", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api-other",
      detected,
      {
        project: { design },
        workspaces: {
          "services/api": {
            type: "wrong",
            design: DesignSchema.parse({ architecture: "layered" }),
          },
        },
      },
    );
    expect(result).toEqual({ ...detected, design });
  });

  it("TR-005: resolves a workspace without any root config", () => {
    expect(resolveWorkspacePolicyProfile("services/api", detected)).toEqual(
      detected,
    );
  });
});
