/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLintCommand,
  getTestCommand,
  getTestExtension,
  resolveBuildCommand,
} from "../domain/toolchain.js";
import { detectProfile, resolveWorkspaceProfile } from "./profile-detector.js";
import { conditionPrompt } from "./prompt-conditioner.js";

describe("profile-detector", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("detects project type via core detection logic for pnpm monorepo", async () => {
    fs.writeFileSync(path.join(tmpDir, "pnpm-workspace.yaml"), "");
    fs.mkdirSync(path.join(tmpDir, "packages"));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("pnpm-monorepo");
    expect(profile.stack.language).toBe("TypeScript");
    expect(profile.layout).toBe("monorepo");
  });

  it("detects project type via core detection logic for rust project", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    fs.mkdirSync(path.join(tmpDir, "src"));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("rust");
    expect(profile.stack.language).toBe("Rust");
    expect(profile.layout).toBe("src-nested");
  });

  it("should perform tech stack and layout extraction for python project", async () => {
    fs.writeFileSync(path.join(tmpDir, "requirements.txt"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("python");
    expect(profile.stack.language).toBe("Python");
    expect(profile.stack.buildSystem).toBe("pip");
  });

  it("should perform tech stack and layout extraction for nodejs project with framework", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: {
        express: "^4.18.2"
      },
      devDependencies: {
        typescript: "^5.0.0"
      }
    }));
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("nodejs");
    expect(profile.stack.language).toBe("TypeScript");
    expect(profile.stack.framework).toBe("Express");
  });

  it("should detect gwrk-native via docs/architecture.md", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "docs", "architecture.md"), "# Architecture");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("gwrk-native");
  });

  it("should follow priority rules: Cargo.toml over package.json", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("rust");
  });

  it("TR-034: gwrk-native prompt assembly regression snapshot", async () => {
    const profile = { type: "gwrk-native" };
    const prompt = "Gated: [type: gwrk-native]ADR-004[/type]";
    
    const result = conditionPrompt(prompt, profile);
    expect(result).toContain("ADR-004");
    expect(result).not.toContain("[type: gwrk-native]");
  });

  it("detects polyglot-monorepo when multiple language markers are present", async () => {
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      dependencies: { express: "^4.18.2" },
      devDependencies: { typescript: "^5.0.0" }
    }));
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("polyglot-monorepo");
    expect(profile.stack?.languages).toEqual(["TypeScript", "Python", "Go"]);
    expect(profile.stack?.language).toBe("TypeScript");
    expect(profile.layout).toBe("monorepo");
  });

  it("detects Go project from go.mod", async () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/app");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("go");
    expect(profile.stack?.language).toBe("Go");
    expect(profile.stack?.buildSystem).toBe("go");
  });

  it("detects two-language polyglot (Rust + Go)", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("polyglot-monorepo");
    expect(profile.stack?.languages).toEqual(["Rust", "Go"]);
    expect(profile.layout).toBe("monorepo");
  });

  it("single language still sets languages as undefined", async () => {
    fs.writeFileSync(path.join(tmpDir, "Cargo.toml"), "");
    
    const profile = await detectProfile(tmpDir);
    expect(profile.type).toBe("rust");
    expect(profile.stack?.languages).toBeUndefined;
  });

  it("polyglot profile emits <languages> XML in prompt conditioning", async () => {
    const profile = {
      type: "polyglot-monorepo",
      stack: {
        language: "TypeScript",
        languages: ["TypeScript", "Python", "Go"],
      },
      layout: "monorepo",
    };
    
    const result = conditionPrompt("Test", profile);
    expect(result).toContain("<languages>");
    expect(result).toContain("<lang>TypeScript</lang>");
    expect(result).toContain("<lang>Python</lang>");
    expect(result).toContain("<lang>Go</lang>");
    expect(result).toContain('type="polyglot-monorepo"');
  });
});

describe("FR-002: Workspace Detection via CWD (020-polyglot-monorepo)", () => {
  it("preserves the legacy resolver shape for workspaces without a design", () => {
    const root = path.resolve("fixture-project");
    const workspace = path.join(root, "services", "api");
    expect(
      resolveWorkspaceProfile(workspace, root, {
        project: { toolchain: { test: "vitest" } },
        workspaces: { "services/api": { stack: { framework: "Django" } } },
      }),
    ).toStrictEqual({
      type: "nodejs",
      stack: { framework: "Django" },
      layout: "flat",
    });
  });

  it("US-002: detects active workspace profile based on cwd in polyglot monorepo", async () => {
    const pd = await import("./profile-detector.js" as any);
    const mockConfig = {
      project: { name: "test" },
      workspaces: {
        "apps/web": { stack: { language: "typescript" } },
        "crates/backend": { stack: { language: "rust" } }
      }
    };
    
    const resolveWorkspaceProfile = (pd as any).resolveWorkspaceProfile;
    expect(resolveWorkspaceProfile).toBeDefined();

    const webProfile = resolveWorkspaceProfile("/path/to/repo/apps/web", "/path/to/repo", mockConfig);
    expect(webProfile?.stack?.language).toBe("typescript");

    const backendProfile = resolveWorkspaceProfile("/path/to/repo/crates/backend/src", "/path/to/repo", mockConfig);
    expect(backendProfile?.stack?.language).toBe("rust");
    
    const fallbackProfile = resolveWorkspaceProfile("/path/to/repo/unknown", "/path/to/repo", mockConfig);
    expect(fallbackProfile).toBeUndefined();
  });
});

describe("TR-016: Toolchain Detection (Phase 16)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("FR-015: correctly identifies Biome/Ruff/ESLint signals", async () => {
    fs.writeFileSync(path.join(tmpDir, "biome.json"), "");
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify({
      devDependencies: { vitest: "1.0.0" }
    }));
    
    const profile = await detectProfile(tmpDir);
    expect((profile as any).toolchain).toBeDefined();
    expect((profile as any).toolchain?.primary).toBe("biome");
    expect((profile as any).toolchain?.test).toBe("vitest");
  });

  it("ADR-012: detects Python FastAPI, Go Gin, and Rust Axum frameworks", async () => {
    const pyDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-py-"));
    const goDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-go-"));
    const rsDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-rs-"));
    try {
      fs.writeFileSync(
        path.join(pyDir, "pyproject.toml"),
        '[project]\ndependencies = ["fastapi>=0.110.0"]',
      );
      const pyProfile = await detectProfile(pyDir);
      expect(pyProfile.stack?.framework).toBe("FastAPI");

      fs.writeFileSync(
        path.join(goDir, "go.mod"),
        "module example.com/api\nrequire github.com/gin-gonic/gin v1.9.1",
      );
      const goProfile = await detectProfile(goDir);
      expect(goProfile.stack?.framework).toBe("Gin");

      fs.writeFileSync(
        path.join(rsDir, "Cargo.toml"),
        '[package]\nname = "app"\n[dependencies]\naxum = "0.7"',
      );
      const rsProfile = await detectProfile(rsDir);
      expect(rsProfile.stack?.framework).toBe("Axum");
    } finally {
      fs.rmSync(pyDir, { recursive: true, force: true });
      fs.rmSync(goDir, { recursive: true, force: true });
      fs.rmSync(rsDir, { recursive: true, force: true });
    }
  });
});

describe("FR-001: architecture-aware workspace profiles (044 phase p01)", () => {
  let root: string;
  const design = {
    architecture: "hexagonal-functional",
    principles: ["functional-core", "clean-code", "tdd"],
    templateVersion: "1.0.0",
  };
  const write = (relative: string, content: string) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-044-"));
    write(".git", "gitdir: /unused/worktree-metadata\n");
    write(".gwrkrc.json", JSON.stringify({
      project: { name: "fixture", design },
      workspaces: {
        "apps/web": { toolchain: { test: "vitest" } },
        "services/api": { stack: { framework: "FastAPI" }, toolchain: { build: null } },
      },
    }));
    write("apps/web/package.json", JSON.stringify({ dependencies: { typescript: "5", react: "19" } }));
    write("services/api/pyproject.toml", '[project]\ndependencies = ["fastapi", "pytest"]\n[tool.ruff]\n');
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it.each([
    ["apps/web", "TypeScript", "React", { test: "vitest" }],
    ["services/api", "Python", "FastAPI", { primary: "ruff", test: "pytest", build: null }],
  ])("TR-001: inherits design while detecting %s stack and toolchain", async (workspace, language, framework, toolchain) => {
    const result = await detectProfile(path.join(root, workspace));
    expect(result).toMatchObject({ design, stack: { language, framework }, toolchain });
  });

  it.each(["gwrk-native", "gwrk", "unknown"])("TR-001: attaches root design for %s detection", async (kind) => {
    if (kind === "gwrk-native") write("docs/architecture.md", "# Architecture");
    if (kind === "gwrk") write("package.json", JSON.stringify({ name: "@gwrk/cli" }));
    const result = await detectProfile(root);
    expect(result).toMatchObject({ design, type: kind === "gwrk" ? "pnpm-monorepo" : kind });
  });

  it("TR-001: resolves the public two-argument workspace contract", async () => {
    const module = await import("./profile-detector.js");
    // Reflect exercises the new arity without changing the existing implementation signature.
    const result = await Reflect.apply(module.resolveWorkspaceProfile, undefined, [root, "services/api"]);
    expect(result).toMatchObject({ design, stack: { language: "Python", framework: "FastAPI" }, toolchain: { build: null } });
  });

  it("TR-001: uses the nearest config instead of a more distant ancestor", async () => {
    const localDesign = { ...design, architecture: "layered", principles: [] };
    write("services/.gwrkrc.json", JSON.stringify({ project: { name: "services", design: localDesign } }));
    const result = await detectProfile(path.join(root, "services/api"));
    expect(result).toMatchObject({ design: localDesign, stack: { language: "Python" } });
  });

  it("stops config lookup at the current Git worktree root", async () => {
    write("services/.git", "gitdir: /unused/nested-worktree\n");
    const result = await detectProfile(path.join(root, "services/api"));
    expect(result.design).toBeUndefined();
    expect(result.toolchain).toEqual({ primary: "ruff", test: "pytest" });
  });

  it.each([
    {
      registration: "unregistered",
      workspaces: { "apps/web": { toolchain: { test: "vitest" } } },
    },
    {
      registration: "registered",
      workspaces: { "services/api": { stack: { framework: "Django" } } },
    },
  ])(
    "keeps FastAPI and pytest for the $registration Python workspace under a TypeScript root without design",
    async ({ workspaces }) => {
      write("pnpm-workspace.yaml", "");
      write(
        ".gwrkrc.json",
        JSON.stringify({
          project: {
            name: "fixture",
            stack: { language: "TypeScript" },
            toolchain: { test: "vitest" },
          },
          workspaces,
        }),
      );

      const result = await detectProfile(path.join(root, "services/api"));
      expect(result).toMatchObject({
        stack: { language: "Python", framework: "FastAPI" },
        toolchain: { test: "pytest" },
      });
    },
  );

  it("applies the supplied root's design and workspace overrides when the local config only names the workspace", async () => {
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: { name: "fixture", design },
        workspaces: {
          "services/api": {
            stack: { framework: "Django" },
            toolchain: { build: null },
          },
        },
      }),
    );
    write(
      "services/api/.gwrkrc.json",
      JSON.stringify({ project: { name: "api" } }),
    );

    const result = await resolveWorkspaceProfile(root, "services/api");
    expect(result).toMatchObject({
      design,
      stack: { language: "Python", framework: "Django" },
      toolchain: { build: null },
    });
  });

  it.each([
    { toolchain: undefined, command: "python -m pytest test_api.py" },
    { toolchain: { test: "pytest" }, command: "pytest test_api.py -v" },
    {
      toolchain: { testCommand: "uv run pytest {files}" },
      command: "uv run pytest test_api.py",
    },
    { toolchain: { test: null }, command: null },
  ])(
    "uses the workspace test selection over the root command",
    async ({ toolchain, command }) => {
      write("services/api/pyproject.toml", '[project]\nname = "fixture-api"\n');
      write(
        ".gwrkrc.json",
        JSON.stringify({
          project: {
            name: "fixture",
            design,
            stack: { language: "Python" },
            toolchain: { testCommand: "python -m pytest {files}" },
          },
          workspaces: { "services/api": { toolchain } },
        }),
      );

      const result = await resolveWorkspaceProfile(root, "services/api");
      expect(getTestCommand(result, ["test_api.py"])).toBe(command);
    },
  );

  it("uses the detected workspace runner over the root command", async () => {
    write("pnpm-workspace.yaml", "");
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: {
          name: "fixture",
          design,
          toolchain: { testCommand: "pnpm exec vitest run {files}" },
        },
        workspaces: { "services/api": { toolchain: { build: null } } },
      }),
    );

    const result = await detectProfile(path.join(root, "services/api"));
    expect(result).toMatchObject({
      design,
      stack: { language: "Python" },
      toolchain: { test: "pytest", build: null },
    });
    expect(getTestCommand(result, ["test_api.py"])).toBe("pytest test_api.py -v");
  });

  it("keeps the inferred test runner when only the workspace framework is set", async () => {
    write("services/api/pyproject.toml", '[project]\nname = "fixture-api"\n');
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: { name: "fixture", toolchain: { test: "vitest" } },
        workspaces: { "services/api": { stack: { framework: "Django" } } },
      }),
    );

    const result = await resolveWorkspaceProfile(root, "services/api");
    expect(result.stack?.framework).toBe("Django");
    expect(getTestCommand(result, ["test_api.py"])).toBe("pytest test_api.py -v");
  });

  it("keeps the workspace-local runner under a TypeScript root with a design", async () => {
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: {
          name: "fixture",
          design,
          stack: { language: "TypeScript" },
          toolchain: { test: "vitest" },
        },
        workspaces: { "services/api": { toolchain: { build: null } } },
      }),
    );
    write("services/api/pyproject.toml", '[project]\ndependencies = ["fastapi"]\n');
    write(
      "services/api/.gwrkrc.json",
      JSON.stringify({ project: { name: "api", toolchain: { test: "pytest" } } }),
    );

    const result = await resolveWorkspaceProfile(root, "services/api");
    expect(result).toMatchObject({
      design,
      stack: { language: "Python" },
      toolchain: { test: "pytest", build: null },
    });
  });

  it.each([
    {
      rootStack: undefined,
      toolchain: { test: "vitest" },
      setting: "Vitest runner",
    },
    {
      rootStack: undefined,
      toolchain: { testCommand: "pnpm exec vitest run {files}" },
      setting: "custom command with detected root language",
    },
    {
      rootStack: { language: "TypeScript" },
      toolchain: { testCommand: "pnpm exec vitest run {files}" },
      setting: "custom command with configured root language",
    },
  ])(
    "uses the Python fallback through both workspace paths under a root $setting",
    async ({ rootStack, toolchain }) => {
      if (!rootStack) write("pnpm-workspace.yaml", "");
      write("services/api/pyproject.toml", '[project]\ndependencies = ["django"]\n');
      write(
        ".gwrkrc.json",
        JSON.stringify({
          project: { name: "fixture", design, stack: rootStack, toolchain },
          workspaces: { "services/api": { toolchain: { build: null } } },
        }),
      );

      const profiles = await Promise.all([
        detectProfile(path.join(root, "services/api")),
        resolveWorkspaceProfile(root, "services/api"),
      ]);
      expect(profiles).toMatchObject([
        { design, stack: { language: "Python", framework: "Django" }, toolchain: { build: null } },
        { design, stack: { language: "Python", framework: "Django" }, toolchain: { build: null } },
      ]);
      expect(profiles.map((profile) => getTestCommand(profile, ["test_api.py"])))
        .toEqual(["pytest test_api.py -v", "pytest test_api.py -v"]);
    },
  );

  it("detects local architecture and language from a registered workspace root", async () => {
    const config = {
      project: { name: "fixture" },
      workspaces: {
        "services/api": {
          stack: { framework: "Django" },
          toolchain: { build: null },
        },
      },
    };
    write(".gwrkrc.json", JSON.stringify(config));
    write(
      "services/api/.gwrkrc.json",
      JSON.stringify({ project: { name: "api", design } }),
    );
    write(
      "services/api/pyproject.toml",
      '[project]\ndependencies = ["fastapi"]\n',
    );
    write("services/api/src/api.py", "pass\n");
    const nested = "services/api/src";
    const profiles = [
      await resolveWorkspaceProfile(root, nested),
      resolveWorkspaceProfile(path.join(root, nested), root, config),
    ];
    for (const profile of profiles) {
      expect.soft(profile).toMatchObject({
        design,
        type: "python",
        stack: { language: "Python", framework: "Django" },
        toolchain: { build: null },
      });
      if (!profile) throw new Error("Expected workspace profile");
      expect.soft(getTestCommand(profile, ["test_api.py"])).toBe(
        "pytest test_api.py -v",
      );
    }
  });

  it("uses workspace lint, build and discovery across all resolver paths", async () => {
    const config = {
      project: {
        name: "fixture",
        design,
        toolchain: { primary: "biome", build: "pnpm build", testExtension: ".test.ts" },
      },
      workspaces: { "services/api": { stack: { language: "Python" } } },
    };
    write("pnpm-workspace.yaml", "");
    write(".gwrkrc.json", JSON.stringify(config));
    write("services/api/pyproject.toml", '[project]\ndependencies = ["django"]\n');
    const workspace = path.join(root, "services/api");
    const profiles = [
      await detectProfile(workspace),
      await resolveWorkspaceProfile(root, "services/api"),
      resolveWorkspaceProfile(workspace, root, config),
    ];
    for (const profile of profiles) {
      expect(profile).toMatchObject({ design, stack: { language: "Python" } });
      if (!profile) throw new Error("Expected workspace profile");
      expect.soft(getLintCommand(profile, ["api.py"])).toBe("ruff check api.py");
      expect.soft(getTestExtension(profile)).toBe(".py");
      expect.soft(profile.toolchain?.build).toBeUndefined();
      expect.soft(resolveBuildCommand(profile)).toBeNull();
    }
  });

  it("keeps the selected TypeScript runner and linter in a mixed workspace", async () => {
    const config = {
      project: { name: "fixture", design },
      workspaces: { "apps/mixed": { stack: { language: "TypeScript" } } },
    };
    write(".gwrkrc.json", JSON.stringify(config));
    write("apps/mixed/package.json", "{}");
    write("apps/mixed/jest.config.js", "");
    write("apps/mixed/eslint.config.js", "");
    write("apps/mixed/pyproject.toml", "[project]\n");
    write("apps/mixed/pytest.ini", "");
    write("apps/mixed/ruff.toml", "");
    write("apps/mixed/.gwrkrc.json", JSON.stringify({
      project: {
        name: "mixed",
        stack: { language: "Python", framework: "Django", buildSystem: "uv" },
        toolchain: { test: "pytest", primary: "ruff" },
      },
    }));
    const workspace = path.join(root, "apps/mixed");
    const profiles = [
      await detectProfile(workspace),
      await resolveWorkspaceProfile(root, "apps/mixed"),
      resolveWorkspaceProfile(workspace, root, config),
    ];
    for (const profile of profiles) {
      expect(profile).toBeDefined();
      if (!profile) throw new Error("Expected a mixed workspace profile");
      expect.soft(getTestCommand(profile, ["app.test.ts"])).toBe("npx jest app.test.ts");
      expect.soft(getLintCommand(profile, ["app.ts"])).toBe("npx eslint app.ts");
    }
  });

  it("uses the configured language to select tools in a mixed workspace", async () => {
    const config = {
      project: {
        name: "fixture",
        design,
        stack: { language: "Python", buildSystem: "Poetry" },
        toolchain: { build: "poetry build" },
      },
      workspaces: { "services/api": { stack: { language: "Python" } } },
    };
    write(".gwrkrc.json", JSON.stringify(config));
    write(
      "services/api/package.json",
      JSON.stringify({ dependencies: { next: "1.0.0" } }),
    );
    write("services/api/pyproject.toml", '[project]\ndependencies = ["django"]\n');
    write("services/api/uv.lock", "");
    write("services/api/biome.json", "{}");
    write("services/api/vitest.config.ts", "");

    const workspace = path.join(root, "services/api");
    const profiles = [
      await detectProfile(workspace),
      await resolveWorkspaceProfile(root, "services/api"),
      resolveWorkspaceProfile(workspace, root, config),
    ];
    for (const profile of profiles) {
      expect.soft(profile).toMatchObject({
        design,
        stack: { language: "Python", framework: "Django", buildSystem: "uv" },
      });
      if (!profile) throw new Error("Expected workspace profile");
      expect.soft(getTestCommand(profile, ["test_api.py"])).toBe("pytest test_api.py -v");
      expect.soft(getLintCommand(profile, ["api.py"])).toBe("ruff check api.py");
      expect.soft(profile.toolchain?.build).toBeUndefined();
    }
  });

  it("detects the selected Python runner from pyproject.toml alongside a Ruff config", async () => {
    const config = {
      project: {
        name: "fixture",
        design,
        stack: { language: "Python" },
        toolchain: { testCommand: "uv run pytest {files}" },
      },
      workspaces: { "services/api": { stack: { language: "Python" } } },
    };
    write(".gwrkrc.json", JSON.stringify(config));
    write("services/api/package.json", "{}");
    write("services/api/jest.config.js", "");
    write("services/api/pyproject.toml", "[project]\n[tool.pytest.ini_options]\n");
    write("services/api/ruff.toml", "");

    const workspace = path.join(root, "services/api");
    const profiles = [
      await detectProfile(workspace),
      await resolveWorkspaceProfile(root, "services/api"),
      resolveWorkspaceProfile(workspace, root, config),
    ];
    for (const profile of profiles) {
      if (!profile) throw new Error("Expected workspace profile");
      expect.soft(profile).toMatchObject({ design, toolchain: { test: "pytest" } });
      expect.soft(getTestCommand(profile, ["test_api.py"])).toBe("pytest test_api.py -v");
    }
  });

  it("keeps explicit workspace-local tools above filtered detection", async () => {
    write("services/api/package.json", "{}");
    write("services/api/biome.json", "{}");
    write("services/api/vitest.config.ts", "");
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: { name: "fixture", design },
        workspaces: { "services/api": { stack: { language: "Python" } } },
      }),
    );
    write(
      "services/api/.gwrkrc.json",
      JSON.stringify({
        project: { name: "api", toolchain: { primary: "biome", test: null } },
      }),
    );

    const profile = await resolveWorkspaceProfile(root, "services/api");
    expect(profile).toMatchObject({
      design,
      stack: { language: "Python" },
      toolchain: { primary: "biome", test: null },
    });
    expect(profile.toolchain?.formatter).toBeUndefined();
    expect(getTestCommand(profile, ["test_api.py"])).toBeNull();
  });

  it("detects the longest matching workspace directory for design-aware resolution", async () => {
    const config = {
      project: {
        name: "fixture",
        design,
        stack: { language: "TypeScript" },
        toolchain: { test: "vitest" },
      },
      workspaces: {
        services: { stack: { language: "TypeScript" } },
        "services/api": { stack: { framework: "Django" }, toolchain: { build: null } },
        "services/api/sr": { stack: { language: "TypeScript" } },
      },
    };
    write(".gwrkrc.json", JSON.stringify(config));
    write("services/api/pyproject.toml", '[project]\ndependencies = ["fastapi"]\n');
    write("services/api/src/api.py", "");

    const workspace = path.join(root, "services/api");
    const profiles = [
      await detectProfile(path.join(workspace, "src")),
      await resolveWorkspaceProfile(root, "services/api/src"),
      resolveWorkspaceProfile(workspace, root, config),
    ];
    for (const profile of profiles) {
      expect.soft(profile).toMatchObject({
        design,
        type: "python",
        stack: { language: "Python", framework: "Django" },
        toolchain: { build: null },
      });
      if (!profile) throw new Error("Expected workspace profile");
      expect.soft(getTestCommand(profile, ["test_api.py"])).toBe("pytest test_api.py -v");
    }
  });

  it("filters the root test runner through the configured workspace resolver", () => {
    const workspace = path.join(root, "services/api");
    const profile = resolveWorkspaceProfile(workspace, root, {
      project: { design, stack: { language: "TypeScript" }, toolchain: { test: "vitest" } },
      workspaces: { "services/api": { stack: { language: "Python" }, toolchain: { build: null } } },
    });
    expect(profile).toMatchObject({ design, toolchain: { build: null } });
    if (!profile) throw new Error("Expected workspace profile");
    expect(getTestCommand(profile, ["test_api.py"])).toBe("pytest test_api.py -v");
  });

  it("resolves a configured workspace when the root directory is unavailable", () => {
    const missingRoot = path.join(root, "missing");
    const profile = resolveWorkspaceProfile(
      path.join(missingRoot, "services/api"),
      missingRoot,
      {
        project: { design, toolchain: { test: "vitest" } },
        workspaces: {
          "services/api": {
            stack: { language: "Python" },
            toolchain: { build: null },
          },
        },
      },
    );

    expect(profile).toMatchObject({ design, toolchain: { build: null } });
    if (!profile) throw new Error("Expected workspace profile");
    expect(getTestCommand(profile, ["test_api.py"])).toBe(
      "pytest test_api.py -v",
    );
  });

  it("keeps the detected workspace language when its framework is overridden", async () => {
    const { resolveWorkspaceProfile } = await import("./profile-detector.js");
    write(
      ".gwrkrc.json",
      JSON.stringify({
        project: { name: "fixture", design, stack: { language: "TypeScript" } },
        workspaces: { "services/api": { stack: { framework: "Django" } } },
      }),
    );
    const result = await resolveWorkspaceProfile(root, "services/api");
    expect(result).toMatchObject({
      design,
      stack: { language: "Python", framework: "Django" },
      toolchain: { primary: "ruff", test: "pytest" },
    });
  });

  it("TR-001: preserves explicit workspace design through config parsing", async () => {
    const { GwrkConfigSchema } = await import("../utils/config.js");
    const localDesign = { ...design, architecture: "clean", principles: [] };
    const config = GwrkConfigSchema.parse({
      project: { name: "fixture", design },
      workspaces: { "services/api": { design: localDesign } },
    });
    expect(config.workspaces?.["services/api"]).toMatchObject({ design: localDesign });
    write(".gwrkrc.json", JSON.stringify(config));
    expect(await detectProfile(path.join(root, "services/api"))).toMatchObject({ design: localDesign });
  });

  it.each([
    { architecture: "", principles: [] },
    { architecture: "clean", principles: ["unknown-principle"] },
    { architecture: "clean", templateVersion: "99.0.0" },
  ])("TR-001: rejects invalid workspace design %j", async (invalid) => {
    const { GwrkConfigSchema } = await import("../utils/config.js");
    const parsed = GwrkConfigSchema.safeParse({
      project: { name: "fixture", design },
      workspaces: { "services/api": { design: invalid } },
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.path.slice(0, 3).join(".") === "workspaces.services/api.design")).toBe(true);
    }
  });
});
