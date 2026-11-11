import { describe, expect, it } from "vitest";
import { DesignSchema } from "./architecture-context.js";
import { mergeProfileOverrides, resolveWorkspacePolicyProfile } from "./profile-policy.js";
import {
  getSourceExtension,
  getTestCommand,
  getTestExtension,
} from "./toolchain.js";
import type { ProjectProfile } from "./types.js";

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
    const workspaceDesign = DesignSchema.parse({ architecture: "layered", principles: [] });
    expect(mergeProfileOverrides({
      detected,
      projectDesign: design,
      projectType: "service",
      projectStack: { framework: "Django" },
      projectLayout: "flat",
      projectToolchain: { test: "pytest", formatter: "black" },
      workspaceConfig: {
        type: "api", stack: { framework: "FastAPI" }, layout: "src-nested",
        toolchain: { build: null, test: null }, design: workspaceDesign,
      },
    })).toEqual({
      type: "api",
      stack: { language: "Python", framework: "FastAPI", buildSystem: "uv" },
      layout: "src-nested",
      toolchain: { primary: "ruff", formatter: "black", test: null, build: null },
      design: workspaceDesign,
    });
  });

  it("TR-005: leaves frozen inputs unchanged across repeated calls", () => {
    const input = { detected: structuredClone(detected), projectDesign: structuredClone(design) };
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
    expect(mergeProfileOverrides({ detected: { type: "unknown" } })).toEqual({ type: "unknown" });
  });

  it("TR-005: inherits root design and toolchain with workspace field overrides", () => {
    expect(resolveWorkspacePolicyProfile("services/api", detected, {
      project: {
        design,
        stack: { language: "TypeScript" },
        toolchain: { test: "vitest", formatter: "black" },
      },
      workspaces: { "services/api": { toolchain: { build: null } } },
    })).toEqual({
      ...detected,
      design,
      toolchain: { primary: "ruff", test: "pytest", formatter: "black", build: null },
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
    expect(getTestCommand(result, ["test_api.py"])).toBe("pytest test_api.py -v");
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

    expect(getTestCommand(result, ["test_api.py"])).toBe("pytest test_api.py -v");
  });

  it("keeps a compatible detected runner while filtering build and discovery for a language override", () => {
    const result = resolveWorkspacePolicyProfile(
      "services/api",
      {
        type: "polyglot-monorepo",
        stack: { language: "TypeScript", languages: ["TypeScript", "Python"] },
        toolchain: { test: "pytest", build: "pnpm build", testExtension: ".test.ts" },
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

    expect(result).toMatchObject({ design, toolchain: { test: "jest", build: null } });
    expect(getTestCommand(result, ["app.test.js"])).toBe("npx jest app.test.js");
  });

  it("TR-005: selects the longest workspace ancestor for a nested path", () => {
    const nestedDesign = DesignSchema.parse({ architecture: "clean", principles: ["tdd"] });
    const result = resolveWorkspacePolicyProfile("services/api/admin/src", detected, {
      project: { design },
      workspaces: {
        "services/api": { stack: { framework: "Django" } },
        "services/api/admin": { design: nestedDesign, stack: { framework: "FastAPI" } },
      },
    });
    expect(result.design).toEqual(nestedDesign);
    expect(result.stack).toEqual(detected.stack);
  });

  it("TR-005: does not apply a sibling workspace with a shared path prefix", () => {
    const result = resolveWorkspacePolicyProfile("services/api-other", detected, {
      project: { design },
      workspaces: { "services/api": { type: "wrong", design: DesignSchema.parse({ architecture: "layered" }) } },
    });
    expect(result).toEqual({ ...detected, design });
  });

  it("TR-005: resolves a workspace without any root config", () => {
    expect(resolveWorkspacePolicyProfile("services/api", detected)).toEqual(detected);
  });
});
