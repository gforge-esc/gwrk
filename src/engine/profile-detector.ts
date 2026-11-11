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
  resolveProfileStack,
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
  toolchains?: Readonly<
    Record<string, NonNullable<ProjectProfile["toolchain"]>>
  >;
}

/**
 * Auto-detect project type, stack, and layout from filesystem signals.
 * Scans for ALL language markers to support polyglot monorepos.
 */
export async function detectProfile(
  projectRoot: string,
): Promise<ProjectProfile> {
  return detectProfileInDirectory(projectRoot);
}

function detectProfileInDirectory(
  projectRoot: string,
  workspaceRoot?: { directory: string; config?: WorkspaceRootConfig },
): ProjectProfile {
  const detected = detectFilesystemProfile(projectRoot);
  const localProject = readLocalProject(projectRoot);
  const scoped = resolveDetectedProfile(
    projectRoot,
    detected,
    localProject,
    workspaceRoot,
  );
  if (scoped) return scoped;
  if (
    localProject?.design &&
    !detected.profile._isGwrk &&
    detected.profile.type !== "gwrk-native"
  ) {
    return resolveWorkspacePolicyProfile("", detected.profile, undefined, {
      localProject,
      detectedStacks: detected.signals,
      detectedToolchains: detected.toolchains,
    });
  }
  return localProject
    ? mergeLocalProject(detected.profile, localProject)
    : detected.profile;
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
      buildSystem: isPnpm
        ? "pnpm"
        : files.includes("yarn.lock")
          ? "yarn"
          : "npm",
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
    if (signal.buildSystem) {
      // Legacy profiles report npm for Yarn projects.
      profile.stack.buildSystem =
        signal.buildSystem === "yarn" ? "npm" : signal.buildSystem;
    }
    // Preserve monorepo layout for single-language monorepo types
    if (signal.type.includes("monorepo")) profile.layout = "monorepo";
  }

  // 4. Toolchain Detection (Phase 16)
  type Toolchain = NonNullable<ProjectProfile["toolchain"]>;
  const toolchain: Toolchain = {};
  const javascript: Toolchain = {};
  const python: Toolchain = {};
  const rust: Toolchain = {};
  const go: Toolchain = {};

  // Formatter & Linter
  if (files.includes("biome.json") || files.includes("biome.jsonc")) {
    toolchain.primary = javascript.primary = "biome";
    toolchain.formatter = javascript.formatter = "biome";
  } else {
    if (
      files.includes(".eslintrc") ||
      files.includes(".eslintrc.json") ||
      files.includes(".eslintrc.js") ||
      files.includes("eslint.config.js") ||
      files.includes("eslint.config.mjs")
    ) {
      toolchain.primary = javascript.primary = "eslint";
    }
    if (
      files.includes(".prettierrc") ||
      files.includes(".prettierrc.json") ||
      files.includes(".prettierrc.js") ||
      files.includes("prettier.config.js")
    ) {
      toolchain.formatter = javascript.formatter = "prettier";
    }
  }

  const hasRuffConfig =
    files.includes("ruff.toml") || files.includes(".ruff.toml");
  if (hasRuffConfig) {
    toolchain.primary = python.primary = "ruff";
  }
  if (files.includes("pyproject.toml")) {
    try {
      const content = fs.readFileSync(
        path.join(projectRoot, "pyproject.toml"),
        "utf-8",
      );
      if (content.includes("[tool.pytest") || /\bpytest\b/.test(content)) {
        python.test = "pytest";
        // Keep legacy aggregate detection when a standalone Ruff config exists.
        if (!hasRuffConfig) toolchain.test = python.test;
      }
      if (content.includes("[tool.black]")) {
        python.formatter = "black";
        if (!hasRuffConfig) toolchain.formatter = python.formatter;
      }
      if (!hasRuffConfig && content.includes("[tool.ruff]")) {
        toolchain.primary = python.primary = "ruff";
      }
    } catch {}
  }

  if (
    files.includes(".golangci.yml") ||
    files.includes(".golangci.yaml") ||
    files.includes(".golangci.toml") ||
    files.includes(".golangci.json")
  ) {
    toolchain.primary = go.primary = "golangci-lint";
  }

  if (files.includes("clippy.toml") || files.includes(".clippy.toml")) {
    toolchain.primary = rust.primary = "clippy";
  } else if (files.includes("Cargo.toml")) {
    try {
      const cargoContent = fs.readFileSync(
        path.join(projectRoot, "Cargo.toml"),
        "utf-8",
      );
      if (
        cargoContent.includes("[lints.clippy]") ||
        cargoContent.includes("clippy")
      ) {
        rust.primary = "clippy";
        toolchain.primary ??= rust.primary;
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
    toolchain.test = javascript.test = "vitest";
  } else if (
    files.includes("jest.config.js") ||
    files.includes("jest.config.ts") ||
    files.includes("jest.config.mjs")
  ) {
    toolchain.test = javascript.test = "jest";
  }
  if (files.includes("Cargo.toml")) rust.test = "cargo-test";
  if (files.includes("go.mod")) go.test = "go-test";
  const configuredTest = javascript.test ?? rust.test ?? go.test;
  if (configuredTest) toolchain.test = configuredTest;

  // Also check package.json for test and linter signals
  if (files.includes("package.json")) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
      );
      if (!javascript.test) {
        if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest)
          javascript.test = "vitest";
        else if (pkg.devDependencies?.jest || pkg.dependencies?.jest)
          javascript.test = "jest";
      }
      if (!javascript.primary) {
        if (
          pkg.devDependencies?.["@biomejs/biome"] ||
          pkg.dependencies?.["@biomejs/biome"]
        ) {
          javascript.primary = "biome";
        } else if (pkg.devDependencies?.eslint || pkg.dependencies?.eslint) {
          javascript.primary = "eslint";
        }
      }
    } catch {}
  }

  if (javascript.test) toolchain.test ??= javascript.test;
  if (javascript.primary) toolchain.primary ??= javascript.primary;
  if (files.includes("pytest.ini") || files.includes("conftest.py")) {
    toolchain.test = python.test = "pytest";
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

  return { profile, signals, toolchains: { javascript, python, rust, go } };
}

function readLocalProject(
  directory: string,
): WorkspaceProfileConfig | undefined {
  try {
    const rcPath = path.join(directory, ".gwrkrc.json");
    if (!fs.existsSync(rcPath)) return undefined;
    const rc = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
    if (!rc.project) return undefined;
    const projectSchema = GwrkConfigSchema.shape.project.shape;
    return {
      type: projectSchema.type.safeParse(rc.project.type).data || undefined,
      stack: projectSchema.stack.safeParse(rc.project.stack).data,
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
  localProject?: WorkspaceProfileConfig,
  workspaceRoot?: {
    directory: string;
    config?: WorkspaceRootConfig;
    configuredLookup?: boolean;
  },
): ProjectProfile | undefined {
  const start = path.resolve(detectedRoot);
  const ancestors =
    workspaceRoot?.configuredLookup &&
    crossesGitWorktreeBoundary(workspaceRoot.directory, start)
      ? []
      : [...ancestorWorkspaceConfigs(start, workspaceRoot?.directory)];
  const suppliedRoot =
    workspaceRoot?.config === undefined
      ? undefined
      : { directory: workspaceRoot.directory, config: workspaceRoot.config };
  const designSource = findNearestAncestorDesign(
    suppliedRoot ? [...ancestors, suppliedRoot] : ancestors,
    start,
  );
  const ancestorDesign = designSource?.design;
  for (const { directory, config } of ancestors) {
    const workspaces = validateWorkspaceEntries(config);
    const relativePath = relativeWorkspacePath(directory, start);
    if (!matchWorkspacePath(relativePath, Object.keys(workspaces))) continue;

    const scoped = applyWorkspaceConfig(directory, start, detected, config, {
      requireDesign: true,
      configuredLookup: workspaceRoot?.configuredLookup,
      localProject,
      ancestorDesign,
      workspaces,
    });
    if (scoped !== detected.profile) return scoped;
  }

  if (suppliedRoot) {
    const workspaces = validateWorkspaceEntries(suppliedRoot.config);
    const relativePath = relativeWorkspacePath(suppliedRoot.directory, start);
    if (
      workspaceRoot?.configuredLookup ||
      matchWorkspacePath(relativePath, Object.keys(workspaces))
    ) {
      return applyWorkspaceConfig(
        suppliedRoot.directory,
        start,
        detected,
        suppliedRoot.config,
        {
          localProject,
          ancestorDesign,
          requireDesign: workspaceRoot?.configuredLookup,
          configuredLookup: workspaceRoot?.configuredLookup,
          workspaces,
        },
      );
    }
  }

  const policySource =
    ancestors.find(
      ({ directory, config }) =>
        directory === designSource?.directory ||
        GwrkConfigSchema.shape.project.shape.stack.safeParse(
          config?.project?.stack,
        ).data ||
        ToolchainConfigSchema.safeParse(config?.project?.toolchain).data,
    ) ??
    designSource ??
    suppliedRoot;
  if (!policySource) return undefined;
  const scoped = applyWorkspaceConfig(
    policySource.directory,
    start,
    detected,
    policySource.config,
    { requireDesign: true, localProject, ancestorDesign },
  );
  return scoped === detected.profile ? undefined : scoped;
}

type WorkspaceRootConfig = {
  project?: { design?: unknown; stack?: unknown; toolchain?: unknown };
  workspaces?: Record<string, unknown>;
} | null;

interface WorkspaceConfigSource {
  directory: string;
  config: WorkspaceRootConfig;
}

function readWorkspaceRootConfig(
  directory: string,
): WorkspaceRootConfig | undefined {
  const configPath = path.join(directory, ".gwrkrc.json");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch {
    return undefined;
  }
}

function* ancestorWorkspaceConfigs(workspace: string, root?: string) {
  let directory = path.resolve(workspace);
  const stop = root === undefined ? undefined : path.resolve(root);
  if (stop !== undefined) {
    const relative = relativeWorkspacePath(stop, directory);
    if (!relative || isOutsideRoot(relative)) return;
  }

  while (!fs.existsSync(path.join(directory, ".git"))) {
    const parent = path.dirname(directory);
    if (parent === directory || parent === stop) return;
    directory = parent;
    const config = readWorkspaceRootConfig(directory);
    if (config) yield { directory, config };
  }
}

function findNearestAncestorDesign(
  ancestors: readonly WorkspaceConfigSource[],
  workspace: string,
) {
  for (const ancestor of ancestors) {
    const workspaces = validateWorkspaceEntries(ancestor.config);
    const match = matchWorkspacePath(
      relativeWorkspacePath(ancestor.directory, workspace),
      Object.keys(workspaces),
    );
    const design =
      (match ? workspaces[match].design : undefined) ??
      DesignSchema.safeParse(ancestor.config?.project?.design).data;
    if (design) return { ...ancestor, design };
  }
  return undefined;
}

function relativeWorkspacePath(root: string, workspace: string): string {
  return path.relative(root, workspace).split(path.sep).join("/");
}

function isOutsideRoot(relativePath: string): boolean {
  return (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  );
}

function crossesGitWorktreeBoundary(root: string, workspace: string): boolean {
  const relativePath = relativeWorkspacePath(root, workspace);
  if (!relativePath || isOutsideRoot(relativePath)) return false;

  let directory = path.resolve(root);
  for (const segment of relativePath.split("/")) {
    directory = path.join(directory, segment);
    if (fs.existsSync(path.join(directory, ".git"))) return true;
  }
  return false;
}

function validateWorkspaceEntries(
  config: WorkspaceRootConfig,
): Record<string, WorkspaceProfileConfig> {
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
  return workspaces;
}

function applyWorkspaceConfig(
  root: string,
  workspace: string,
  initialDetection: FilesystemProfile,
  config: WorkspaceRootConfig,
  options?: {
    requireDesign?: boolean;
    configuredLookup?: boolean;
    localProject?: WorkspaceProfileConfig;
    ancestorDesign?: WorkspaceProfileConfig["design"];
    workspaces?: Record<string, WorkspaceProfileConfig>;
  },
): ProjectProfile | undefined {
  const workspaces = options?.workspaces ?? validateWorkspaceEntries(config);
  const relativePath = relativeWorkspacePath(root, workspace);
  const matchedPath = matchWorkspacePath(relativePath, Object.keys(workspaces));
  const matchedEntry = matchedPath ? workspaces[matchedPath] : undefined;
  if (!matchedEntry && options?.configuredLookup) {
    return initialDetection.profile;
  }
  const design = DesignSchema.safeParse(config?.project?.design).data;
  const entryDesign = matchedEntry?.design;
  const localProject = options?.localProject;
  const outsideWorktree =
    options?.configuredLookup && crossesGitWorktreeBoundary(root, workspace);
  const localDesign =
    outsideWorktree || entryDesign
      ? undefined
      : (localProject?.design ?? options?.ancestorDesign);
  const hasDesign = entryDesign || localDesign || design;
  let detected = initialDetection;
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

  if (outsideWorktree) return undefined;

  let matchedProject: WorkspaceProfileConfig | undefined;
  if (
    matchedPath &&
    (options?.configuredLookup || matchedPath !== relativePath)
  ) {
    const matchedRoot = path.resolve(root, matchedPath);
    matchedProject =
      matchedPath === relativePath ? undefined : readLocalProject(matchedRoot);
    try {
      detected = detectFilesystemProfile(matchedRoot);
    } catch {
      // A configured lookup can resolve a workspace that is absent on disk.
      if (options?.configuredLookup && matchedEntry) {
        detected = {
          profile: configuredWorkspaceProfile(matchedEntry),
          signals: [],
        };
      }
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
    (!stack?.buildSystem ||
      !stack.framework ||
      (!stack.language && !stack.languages?.[0]))
  ) {
    try {
      const rootDetection = detectFilesystemProfile(root);
      stack = resolveProfileStack(
        rootDetection.profile.stack,
        [stack],
        rootDetection.signals,
      );
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
      localProject: localDesign
        ? { ...localProject, design: localDesign }
        : localProject,
      matchedLocalProject: matchedProject && {
        ...matchedProject,
        design: undefined,
      },
      detectedStacks: detected.signals,
      detectedToolchains: detected.toolchains,
    },
  );
}

async function detectWorkspaceProfile(
  root: string,
  workspacePath: string,
): Promise<ProjectProfile> {
  const workspace = path.resolve(root, workspacePath);
  if (
    isOutsideRoot(relativeWorkspacePath(root, workspace)) ||
    crossesGitWorktreeBoundary(root, workspace)
  ) {
    return detectProfileInDirectory(workspace);
  }
  return detectProfileInDirectory(workspace, {
    directory: root,
    config: readWorkspaceRootConfig(root),
  });
}

function configuredWorkspaceProfile(
  config?: WorkspaceProfileConfig,
): ProjectProfile {
  return {
    type: config?.type || "nodejs",
    stack: config?.stack || {},
    layout: config?.layout || "flat",
  };
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
  const workspaces = validateWorkspaceEntries(config);
  const bestMatch = matchWorkspacePath(
    relativeWorkspacePath(projectRoot, cwd),
    Object.keys(workspaces),
  );
  const workspace = configuredWorkspaceProfile(
    bestMatch ? workspaces[bestMatch] : undefined,
  );
  const scoped = resolveDetectedProfile(
    cwd,
    { profile: workspace, signals: [] },
    readLocalProject(cwd),
    { directory: projectRoot, config, configuredLookup: true },
  );
  return !bestMatch && scoped === workspace ? undefined : scoped;
}
