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
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
    );
    if (pkg.name === "@gwrk/cli") {
      isGwrk = true;
    }
  } catch { /* no package.json */ }

  // 2. Scan ALL language markers (not first-match-wins)
  const signals: LanguageSignal[] = [];

  if (isGwrk) {
    profile.type = "pnpm-monorepo";
    profile.stack.language = "TypeScript";
    profile.stack.buildSystem = "pnpm";
    profile.layout = "monorepo";
    profile._isGwrk = true;
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
    // Polyglot monorepo: multiple languages detected
    profile.type = "polyglot-monorepo";
    profile.stack.languages = signals.map((s) => s.language);
    profile.stack.language = signals[0].language; // primary language (backwards compat)
    profile.layout = "monorepo";
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

  // 4. Refine Layout (only if not already set to monorepo)
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

