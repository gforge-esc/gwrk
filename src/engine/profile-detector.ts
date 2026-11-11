/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { DesignSchema } from "../domain/architecture-context.js";
import {
  matchWorkspacePath,
  mergeProfileOverrides,
  resolveWorkspacePolicyProfile,
} from "../domain/profile-policy.js";
import type { WorkspaceProfileConfig } from "../domain/types.js";
import { GwrkConfigSchema, ToolchainConfigSchema } from "../utils/config.js";
import type { ProjectProfile } from "./prompt-conditioner.js";

export type { ProjectProfile };

/**
 * Language signal detected from filesystem markers
 */
interface LanguageSignal {
  language: string;
  type: string;
  framework?: string;
  buildSystem?: string;
}

interface FilesystemProfile {
  profile: ProjectProfile;
  signals: readonly LanguageSignal[];
}

/**
 * Auto-detect project type, stack, and layout from filesystem signals.
 * Scans for ALL language markers to support polyglot monorepos.
 */
export async function detectProfile(
  projectRoot: string,
): Promise<ProjectProfile> {
  return detectProfileInDirectory(projectRoot, true);
}

function detectProfileInDirectory(
  projectRoot: string,
  searchAncestors: boolean,
  explicitRoot?: { directory: string; config: WorkspaceRootConfig },
): ProjectProfile {
  const detected = detectFilesystemProfile(projectRoot);
  const localProject = readLocalProject(projectRoot);
  if (explicitRoot) {
    return applyWorkspaceConfig(
      explicitRoot.directory,
      projectRoot,
      detected,
      explicitRoot.config,
      { localProject },
    );
  }

  if (localProject) return mergeLocalProject(detected.profile, localProject);

  return (
    resolveDetectedProfile(projectRoot, detected, searchAncestors) ??
    detected.profile
  );
}

function detectFilesystemProfile(projectRoot: string): FilesystemProfile {
  const profile: ProjectProfile & {
    stack: NonNullable<ProjectProfile["stack"]>;
  } = {
    type: "unknown",
    stack: {},
    layout: "flat",
  };

  const files = fs.readdirSync(projectRoot);

  // 1. Self-detection: is this the gwrk project itself?
  let isGwrk = false;
  try {
    const pkgPath = path.join(projectRoot, "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.name === "@gwrk/cli") {
        isGwrk = true;
      }
    }
  } catch {
    /* no package.json */
  }

  // gwrk-native detection via docs/architecture.md
  if (
    !isGwrk &&
    fs.existsSync(path.join(projectRoot, "docs", "architecture.md"))
  ) {
    profile.type = "gwrk-native";
    profile.stack.language = "TypeScript";
    profile.layout = "src-nested";
    return { profile, signals: [] };
  }

  // 2. Scan ALL language markers (not first-match-wins)
  const signals: LanguageSignal[] = [];

  if (isGwrk) {
    profile.type = "pnpm-monorepo";
    profile.stack.language = "TypeScript";
    profile.stack.buildSystem = "pnpm";
    profile.layout = "monorepo";
    profile._isGwrk = true;
    profile.toolchain = {
      primary: "biome",
      formatter: "biome",
      test: "vitest",
    };
    return { profile, signals };
  }

  // pnpm workspace / lockfile or package.json detection
  if (
    files.includes("pnpm-workspace.yaml") ||
    files.includes("pnpm-lock.yaml") ||
    files.includes("package.json")
  ) {
    const isPnpm =
      files.includes("pnpm-workspace.yaml") || files.includes("pnpm-lock.yaml");
    const signal: LanguageSignal = {
      language: isPnpm ? "TypeScript" : "JavaScript",
      type: isPnpm ? "pnpm-monorepo" : "nodejs",
      buildSystem: isPnpm ? "pnpm" : "npm",
    };

    try {
      const pkgPath = path.join(projectRoot, "package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.typescript) {
          signal.language = "TypeScript";
        }
        if (deps.next) signal.framework = "Next.js";
        else if (deps.react) signal.framework = "React";
        else if (deps.fastify) signal.framework = "Fastify";
        else if (deps.express) signal.framework = "Express";
        else if (deps["@nestjs/core"]) signal.framework = "NestJS";
        else if (deps.hono) signal.framework = "Hono";
      }
    } catch {
      // Ignore parse errors
    }

    signals.push(signal);
  }

  // Rust detection
  if (files.includes("Cargo.toml")) {
    const rustSignal: LanguageSignal = {
      language: "Rust",
      type: "rust",
      buildSystem: "cargo",
    };
    try {
      const cargoContent = fs.readFileSync(
        path.join(projectRoot, "Cargo.toml"),
        "utf-8",
      );
      if (/\baxum\b/.test(cargoContent)) rustSignal.framework = "Axum";
      else if (/\bactix-web\b/.test(cargoContent))
        rustSignal.framework = "Actix";
      else if (/\bclap\b/.test(cargoContent)) rustSignal.framework = "Clap";
    } catch {}
    signals.push(rustSignal);
  }

  // Python detection
  if (
    files.includes("pyproject.toml") ||
    files.includes("requirements.txt") ||
    files.includes("setup.py")
  ) {
    const signal: LanguageSignal = {
      language: "Python",
      type: "python",
    };
    if (files.includes("poetry.lock")) signal.buildSystem = "Poetry";
    else if (files.includes("uv.lock")) signal.buildSystem = "uv";
    else if (files.includes("requirements.txt")) signal.buildSystem = "pip";

    try {
      const pyManifest = files.includes("pyproject.toml")
        ? fs.readFileSync(path.join(projectRoot, "pyproject.toml"), "utf-8")
        : files.includes("requirements.txt")
          ? fs.readFileSync(path.join(projectRoot, "requirements.txt"), "utf-8")
          : "";
      if (/\bfastapi\b/i.test(pyManifest)) signal.framework = "FastAPI";
      else if (/\bdjango\b/i.test(pyManifest)) signal.framework = "Django";
      else if (/\bflask\b/i.test(pyManifest)) signal.framework = "Flask";
    } catch {}
    signals.push(signal);
  }

  // Go detection
  if (files.includes("go.mod")) {
    const goSignal: LanguageSignal = {
      language: "Go",
      type: "go",
      buildSystem: "go",
    };
    try {
      const goMod = fs.readFileSync(path.join(projectRoot, "go.mod"), "utf-8");
      if (goMod.includes("github.com/gin-gonic/gin"))
        goSignal.framework = "Gin";
      else if (goMod.includes("github.com/go-chi/chi"))
        goSignal.framework = "Chi";
      else if (goMod.includes("github.com/labstack/echo"))
        goSignal.framework = "Echo";
      else if (goMod.includes("github.com/gofiber/fiber"))
        goSignal.framework = "Fiber";
    } catch {}
    signals.push(goSignal);
  }

  // 3. Resolve profile from collected signals
  if (signals.length > 1) {
    // Priority: Cargo.toml over package.json for single projects (backward compat with test)
    if (
      signals.length === 2 &&
      signals.some((s) => s.type === "rust") &&
      signals.some((s) => s.type === "nodejs")
    ) {
      const rustSignal = signals.find((s) => s.type === "rust") ?? signals[0];
      profile.type = rustSignal.type;
      profile.stack.language = rustSignal.language;
      profile.stack.buildSystem = rustSignal.buildSystem;
    } else {
      // Polyglot monorepo: multiple languages detected
      profile.type = "polyglot-monorepo";
      profile.stack.languages = signals.map((s) => s.language);
      profile.stack.language = signals[0].language; // primary language (backwards compat)
      profile.layout = "monorepo";
    }
  } else if (signals.length === 1) {
    // Single language project
    const signal = signals[0];
    profile.type = signal.type;
    profile.stack.language = signal.language;
    if (signal.framework) profile.stack.framework = signal.framework;
    if (signal.buildSystem) profile.stack.buildSystem = signal.buildSystem;
    // Preserve monorepo layout for single-language monorepo types
    if (signal.type.includes("monorepo")) profile.layout = "monorepo";
  }

  // 4. Toolchain Detection (Phase 16)
  const toolchain: NonNullable<ProjectProfile["toolchain"]> = {};

  // Formatter & Linter
  if (files.includes("biome.json") || files.includes("biome.jsonc")) {
    toolchain.primary = "biome";
    toolchain.formatter = "biome";
  } else {
    if (
      files.includes(".eslintrc") ||
      files.includes(".eslintrc.json") ||
      files.includes(".eslintrc.js") ||
      files.includes("eslint.config.js") ||
      files.includes("eslint.config.mjs")
    ) {
      toolchain.primary = "eslint";
    }
    if (
      files.includes(".prettierrc") ||
      files.includes(".prettierrc.json") ||
      files.includes(".prettierrc.js") ||
      files.includes("prettier.config.js")
    ) {
      toolchain.formatter = "prettier";
    }
  }

  if (files.includes("ruff.toml") || files.includes(".ruff.toml")) {
    toolchain.primary = "ruff";
  } else if (files.includes(".black") || files.includes("pyproject.toml")) {
    if (files.includes("pyproject.toml")) {
      try {
        const content = fs.readFileSync(
          path.join(projectRoot, "pyproject.toml"),
          "utf-8",
        );
        if (content.includes("[tool.black]")) toolchain.formatter = "black";
        if (content.includes("[tool.ruff]")) toolchain.primary = "ruff";
        if (content.includes("[tool.pytest") || /\bpytest\b/.test(content)) {
          toolchain.test = "pytest";
        }
      } catch {}
    }
  }

  if (
    files.includes(".golangci.yml") ||
    files.includes(".golangci.yaml") ||
    files.includes(".golangci.toml") ||
    files.includes(".golangci.json")
  ) {
    toolchain.primary = "golangci-lint";
  }

  if (files.includes("clippy.toml") || files.includes(".clippy.toml")) {
    toolchain.primary = "clippy";
  } else if (files.includes("Cargo.toml") && !toolchain.primary) {
    try {
      const cargoContent = fs.readFileSync(
        path.join(projectRoot, "Cargo.toml"),
        "utf-8",
      );
      if (
        cargoContent.includes("[lints.clippy]") ||
        cargoContent.includes("clippy")
      ) {
        toolchain.primary = "clippy";
      }
    } catch {}
  }

  // Test Runner
  if (
    files.includes("vitest.config.ts") ||
    files.includes("vitest.config.js") ||
    files.includes("vitest.config.mts") ||
    files.includes("vitest.config.mjs")
  ) {
    toolchain.test = "vitest";
  } else if (
    files.includes("jest.config.js") ||
    files.includes("jest.config.ts") ||
    files.includes("jest.config.mjs")
  ) {
    toolchain.test = "jest";
  } else if (files.includes("Cargo.toml")) {
    toolchain.test = "cargo-test";
  } else if (files.includes("go.mod")) {
    toolchain.test = "go-test";
  }

  // Also check package.json for test and linter signals
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
      );
      if (!toolchain.test) {
        if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest)
          toolchain.test = "vitest";
        else if (pkg.devDependencies?.jest || pkg.dependencies?.jest)
          toolchain.test = "jest";
      }
      if (!toolchain.primary) {
        if (
          pkg.devDependencies?.["@biomejs/biome"] ||
          pkg.dependencies?.["@biomejs/biome"]
        ) {
          toolchain.primary = "biome";
        } else if (pkg.devDependencies?.eslint || pkg.dependencies?.eslint) {
          toolchain.primary = "eslint";
        }
      }
    } catch {}
  }

  if (files.includes("pytest.ini") || files.includes("conftest.py")) {
    toolchain.test = "pytest";
  }

  if (Object.keys(toolchain).length > 0) {
    profile.toolchain = toolchain;
  }

  // 5. Refine Layout (only if not already set to monorepo)
  if (profile.layout !== "monorepo") {
    if (
      files.includes("src") &&
      fs.statSync(path.join(projectRoot, "src")).isDirectory()
    ) {
      profile.layout = "src-nested";
    } else if (
      files.includes("lib") &&
      fs.statSync(path.join(projectRoot, "lib")).isDirectory()
    ) {
      profile.layout = "lib-nested";
    } else {
      profile.layout = "flat";
    }
  }

  return { profile, signals };
}

function readLocalProject(
  directory: string,
): WorkspaceProfileConfig | undefined {
  try {
    const rcPath = path.join(directory, ".gwrkrc.json");
    if (!fs.existsSync(rcPath)) return undefined;
    const rc = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
    if (!rc.project) return undefined;
    return {
      type: rc.project.type || undefined,
      stack: rc.project.stack,
      toolchain: ToolchainConfigSchema.safeParse(rc.project.toolchain).data,
      design: DesignSchema.safeParse(rc.project.design).data,
    };
  } catch {
    return undefined;
  }
}

function mergeLocalProject(
  detected: ProjectProfile,
  localProject: WorkspaceProfileConfig,
): ProjectProfile {
  if (detected._isGwrk || detected.type === "gwrk-native") {
    return mergeProfileOverrides({
      detected,
      projectDesign: localProject.design,
    });
  }
  return mergeProfileOverrides({
    detected: localProject.toolchain
      ? {
          ...detected,
          toolchain: { ...detected.toolchain, ...localProject.toolchain },
        }
      : detected,
    projectType: localProject.type,
    projectStack: localProject.stack,
    projectDesign: localProject.design,
  });
}

function resolveDetectedProfile(
  detectedRoot: string,
  detected: FilesystemProfile,
  searchAncestors: boolean,
): ProjectProfile | undefined {
  const start = path.resolve(detectedRoot);
  let directory = start;
  while (true) {
    const configPath = path.join(directory, ".gwrkrc.json");
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        if (directory === start) {
          return mergeProfileOverrides({
            detected: detected.profile,
            projectDesign: DesignSchema.safeParse(config?.project?.design).data,
          });
        }

        return applyWorkspaceConfig(directory, start, detected, config, {
          requireDesign: true,
        });
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(directory);
    if (
      !searchAncestors ||
      directory === parent ||
      fs.existsSync(path.join(directory, ".git"))
    ) {
      return undefined;
    }
    directory = parent;
  }
}

type WorkspaceRootConfig = {
  project?: { design?: unknown; stack?: unknown; toolchain?: unknown };
  workspaces?: Record<string, unknown>;
} | null;

function relativeWorkspacePath(root: string, workspace: string): string {
  return path.relative(root, workspace).split(path.sep).join("/");
}

function applyWorkspaceConfig(
  root: string,
  workspace: string,
  initialDetection: FilesystemProfile,
  config: WorkspaceRootConfig,
  options?: {
    requireDesign?: boolean;
    detectMatchedWorkspace?: boolean;
    localProject?: WorkspaceProfileConfig;
  },
): ProjectProfile {
  const workspaceSchema =
    GwrkConfigSchema.shape.workspaces.unwrap().valueSchema;
  const workspaces: Record<string, WorkspaceProfileConfig> =
    Object.create(null);
  for (const [workspacePath, entry] of Object.entries(
    config?.workspaces ?? {},
  )) {
    const parsed = workspaceSchema.safeParse(entry);
    if (parsed.success) workspaces[workspacePath] = parsed.data;
  }

  const relativePath = relativeWorkspacePath(root, workspace);
  const matchedPath = matchWorkspacePath(relativePath, Object.keys(workspaces));
  const design = DesignSchema.safeParse(config?.project?.design).data;
  let detected = initialDetection;
  const matchedRoot = matchedPath ? path.resolve(root, matchedPath) : undefined;
  const detectMatched =
    matchedRoot &&
    (options?.detectMatchedWorkspace || matchedPath !== relativePath);
  const localProject =
    (detectMatched ? readLocalProject(matchedRoot) : undefined) ??
    options?.localProject;
  const hasDesign =
    design ||
    (matchedPath && workspaces[matchedPath].design) ||
    localProject?.design;
  if (!hasDesign) {
    if (options?.requireDesign) return detected.profile;
    return resolveWorkspacePolicyProfile(
      relativePath,
      options?.localProject
        ? mergeLocalProject(detected.profile, options.localProject)
        : detected.profile,
      { workspaces },
    );
  }

  if (detectMatched) {
    try {
      detected = detectFilesystemProfile(matchedRoot);
    } catch {
      // Keep the supplied profile when the workspace directory is unavailable.
    }
  }

  const toolchain = ToolchainConfigSchema.safeParse(
    config?.project?.toolchain,
  ).data;
  let stack = GwrkConfigSchema.shape.project.shape.stack.safeParse(
    config?.project?.stack,
  ).data;
  if (
    toolchain &&
    (!stack?.buildSystem || (!stack.language && !stack.languages?.[0]))
  ) {
    try {
      stack = { ...detectFilesystemProfile(root).profile.stack, ...stack };
    } catch {
      // The configured resolver also accepts paths that are unavailable on disk.
    }
  }

  return resolveWorkspacePolicyProfile(
    relativePath,
    detected.profile,
    {
      project: {
        design,
        stack,
        toolchain,
      },
      workspaces,
    },
    {
      requireDesign: options?.requireDesign,
      localProject,
      detectedStacks: detected.signals,
    },
  );
}

async function detectWorkspaceProfile(
  root: string,
  workspacePath: string,
): Promise<ProjectProfile> {
  const workspace = path.resolve(root, workspacePath);
  let config: WorkspaceRootConfig;
  try {
    config = JSON.parse(
      fs.readFileSync(path.join(root, ".gwrkrc.json"), "utf-8"),
    );
  } catch {
    return detectProfileInDirectory(workspace, false);
  }
  return detectProfileInDirectory(workspace, false, {
    directory: root,
    config,
  });
}

/**
 * US-002: Resolve the specific profile for a workspace subdirectory.
 * Checks if the current path is within a defined workspace in .gwrkrc.json.
 */
export function resolveWorkspaceProfile(
  projectRoot: string,
  workspacePath: string,
): Promise<ProjectProfile>;
export function resolveWorkspaceProfile(
  cwd: string,
  projectRoot: string,
  config: unknown,
): ProjectProfile | undefined;
export function resolveWorkspaceProfile(
  cwd: string,
  projectRoot: string,
  // biome-ignore lint/suspicious/noExplicitAny: workspace config object
  config?: any,
): ProjectProfile | undefined | Promise<ProjectProfile> {
  if (config === undefined) {
    return detectWorkspaceProfile(cwd, projectRoot);
  }
  if (!config.workspaces) return undefined;

  const bestMatch = matchWorkspacePath(
    relativeWorkspacePath(projectRoot, cwd),
    Object.keys(config.workspaces),
  );

  if (bestMatch) {
    const wsConfig = config.workspaces[bestMatch];
    const workspace: ProjectProfile = {
      type: wsConfig.type || "nodejs",
      stack: wsConfig.stack || {},
      layout: wsConfig.layout || "flat",
    };
    return applyWorkspaceConfig(
      projectRoot,
      cwd,
      { profile: workspace, signals: [] },
      config,
      { requireDesign: true, detectMatchedWorkspace: true },
    );
  }

  return undefined;
}
