import fs from "node:fs";
import path from "node:path";

export interface ProjectProfile {
  type: string;
  stack: {
    language?: string;
    framework?: string;
    buildSystem?: string;
  };
  layout: string;
}

/**
 * Auto-detect project type, stack, and layout from filesystem signals
 */
export async function detectProfile(
  projectRoot: string,
): Promise<ProjectProfile> {
  const profile: ProjectProfile = {
    type: "unknown",
    stack: {},
    layout: "flat",
  };

  const files = fs.readdirSync(projectRoot);

  // 1. Detect Type & Stack
  if (
    files.includes("pnpm-workspace.yaml") ||
    files.includes("pnpm-lock.yaml")
  ) {
    profile.type = "pnpm-monorepo";
    profile.stack.language = "TypeScript";
    profile.stack.buildSystem = "pnpm";
    profile.layout = "monorepo";
  } else if (files.includes("package.json")) {
    profile.type = "nodejs";
    profile.stack.language = "JavaScript";
    profile.stack.buildSystem = "npm";

    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectRoot, "package.json"), "utf-8"),
      );
      if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
        profile.stack.language = "TypeScript";
      }
      if (pkg.dependencies?.react) profile.stack.framework = "React";
      if (pkg.dependencies?.next) profile.stack.framework = "Next.js";
      if (pkg.dependencies?.express) profile.stack.framework = "Express";
    } catch (e) {
      // Ignore parse errors
    }
  } else if (files.includes("Cargo.toml")) {
    profile.type = "rust";
    profile.stack.language = "Rust";
    profile.stack.buildSystem = "cargo";
  } else if (
    files.includes("pyproject.toml") ||
    files.includes("requirements.txt") ||
    files.includes("setup.py")
  ) {
    profile.type = "python";
    profile.stack.language = "Python";
    if (files.includes("poetry.lock")) profile.stack.buildSystem = "Poetry";
    else if (files.includes("requirements.txt"))
      profile.stack.buildSystem = "pip";
  } else if (
    files.includes("GEMINI.md") ||
    fs.existsSync(path.join(projectRoot, ".gwrk"))
  ) {
    profile.type = "gwrk-native";
  }

  // 2. Refine Layout
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
