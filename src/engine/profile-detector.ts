import fs from "node:fs";
import path from "node:path";
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

/**
 * Auto-detect project type, stack, and layout from filesystem signals.
 * Scans for ALL language markers to support polyglot monorepos.
 */
export async function detectProfile(
  projectRoot: string,
): Promise<ProjectProfile> {
  const profile: ProjectProfile & { stack: NonNullable<ProjectProfile["stack"]> } = {
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
    return profile;
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
    return profile;
  }

  // pnpm workspace detection
  if (
    files.includes("pnpm-workspace.yaml") ||
    files.includes("pnpm-lock.yaml")
  ) {
    signals.push({
      language: "TypeScript",
      type: "pnpm-monorepo",
      buildSystem: "pnpm",
    });
  } else if (files.includes("package.json")) {
    // Node.js / TypeScript / React / Next.js / Express
    const signal: LanguageSignal = {
      language: "JavaScript",
      type: "nodejs",
      buildSystem: "npm",
    };

    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
      );
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        signal.language = "TypeScript";
      }
      if (pkg.dependencies?.react) signal.framework = "React";
      if (pkg.dependencies?.next) signal.framework = "Next.js";
      if (pkg.dependencies?.express) signal.framework = "Express";
    } catch {
      // Ignore parse errors
    }

    signals.push(signal);
  }

  // Rust detection
  if (files.includes("Cargo.toml")) {
    signals.push({
      language: "Rust",
      type: "rust",
      buildSystem: "cargo",
    });
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
    signals.push(signal);
  }

  // Go detection
  if (files.includes("go.mod")) {
    signals.push({
      language: "Go",
      type: "go",
      buildSystem: "go",
    });
  }

  // 3. Resolve profile from collected signals
  if (signals.length > 1) {
    // Priority: Cargo.toml over package.json for single projects (backward compat with test)
    if (
      signals.length === 2 &&
      signals.some((s) => s.type === "rust") &&
      signals.some((s) => s.type === "nodejs")
    ) {
      const rustSignal = signals.find((s) => s.type === "rust")!;
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
    // Simple black check: check for tool.black in pyproject.toml if we really wanted to be thorough,
    // but filesystem-only means we just check for the presence of markers.
    if (files.includes("pyproject.toml")) {
      try {
        const content = fs.readFileSync(path.join(projectRoot, "pyproject.toml"), "utf-8");
        if (content.includes("[tool.black]")) toolchain.formatter = "black";
        if (content.includes("[tool.ruff]")) toolchain.primary = "ruff";
      } catch {}
    }
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

  // Also check package.json for test signals
  if (!toolchain.test && files.includes("package.json")) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"));
      if (pkg.devDependencies?.vitest || pkg.dependencies?.vitest) toolchain.test = "vitest";
      else if (pkg.devDependencies?.jest || pkg.dependencies?.jest) toolchain.test = "jest";
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

  return profile;
}

/**
 * US-002: Resolve the specific profile for a workspace subdirectory.
 * Checks if the current path is within a defined workspace in .gwrkrc.json.
 */
export function resolveWorkspaceProfile(
  cwd: string,
  projectRoot: string,
  config: any,
): ProjectProfile | undefined {
  if (!config.workspaces) return undefined;

  const relativeCwd = path.relative(projectRoot, cwd);
  
  // Find the longest matching workspace path
  let bestMatch: string | undefined;
  for (const workspacePath of Object.keys(config.workspaces)) {
    if (relativeCwd === workspacePath || relativeCwd.startsWith(`${workspacePath}${path.sep}`)) {
      if (!bestMatch || workspacePath.length > bestMatch.length) {
        bestMatch = workspacePath;
      }
    }
  }

  if (bestMatch) {
    const wsConfig = config.workspaces[bestMatch];
    return {
      type: wsConfig.type || "nodejs",
      stack: wsConfig.stack || {},
      layout: wsConfig.layout || "flat",
    };
  }

  return undefined;
}

