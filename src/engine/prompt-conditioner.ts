/**
 * src/engine/prompt-conditioner.ts
 * Phase 13: Project Awareness
 */

export interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    /** Multiple languages detected in a polyglot monorepo */
    languages?: string[];
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
  /** Toolchain signals (formatter, linter, test runner) */
  toolchain?: {
    primary?: "biome" | "eslint" | "ruff";
    formatter?: "prettier" | "biome" | "black";
    test?: "vitest" | "jest" | "pytest" | "cargo-test" | "go-test";
  };
  /** True when gwrk is operating on its own codebase (self-development) */
  _isGwrk?: boolean;
}

/**
 * Injects <project_profile> XML and resolves [type: project-type] guards.
 * FR-033: Inject <project_profile> XML block
 * FR-034: Resolve conditional guards in PROMPT.md
 */
export function conditionPrompt(prompt: string, profile: ProjectProfile): string {
  if (!profile || profile.type === "unknown") {
    return prompt;
  }

  // 1. Resolve conditional guards: [type: some-type] ... [/type]
  // Rules:
  //   - [type: generic] → ALWAYS included (fallback content for any project)
  //   - [type: gwrk-native] → included ONLY when profile IS gwrk (self-development)
  //   - [type: X] → included when profile.type === X
  //   - Multiple types: [type: X, Y] → included if profile.type matches ANY
  const alwaysInclude = new Set(["generic"]);
  // gwrk working on itself: include gwrk-native blocks
  if (profile.type === "gwrk-cli" || profile._isGwrk) {
    alwaysInclude.add("gwrk-native");
  }

  const guardRegex = /\[type:\s*([^\]]+)\]([\s\S]*?)\[\/type\]/g;
  let conditioned = prompt.replace(guardRegex, (_match, type, content) => {
    const types = type.split(",").map((t: string) => t.trim());
    // Always include generic blocks
    if (types.some((t: string) => alwaysInclude.has(t))) {
      return content;
    }
    // Match project-specific blocks
    if (types.includes(profile.type)) {
      return content;
    }
    return "";
  });

  // 2. Generate XML block
  const xml = generateProfileXml(profile);

  // 3. Inject XML at the top
  return `${xml}\n\n${conditioned.trim()}`;
}

function generateProfileXml(profile: ProjectProfile): string {
  const stackAttrs = [];
  if (profile.stack?.language)
    stackAttrs.push(`language="${profile.stack.language}"`);
  if (profile.stack?.framework)
    stackAttrs.push(`framework="${profile.stack.framework}"`);
  if (profile.stack?.buildSystem)
    stackAttrs.push(`buildSystem="${profile.stack.buildSystem}"`);

  const stackTag =
    stackAttrs.length > 0 ? `  <stack ${stackAttrs.join(" ")} />\n` : "";

  // Polyglot: emit <languages> tag when multiple languages detected
  let languagesTag = "";
  if (profile.stack?.languages && profile.stack.languages.length > 1) {
    const langItems = profile.stack.languages
      .map((lang) => `    <lang>${lang}</lang>`)
      .join("\n");
    languagesTag = `  <languages>\n${langItems}\n  </languages>\n`;
  }
  
  let layoutTag = "";
  if (typeof profile.layout === "string" && profile.layout) {
    layoutTag = `  <layout type="${profile.layout}" />\n`;
  } else if (typeof profile.layout === "object" && profile.layout !== null) {
    const layoutAttrs = Object.entries(profile.layout)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    layoutTag = `  <layout ${layoutAttrs} />\n`;
  }

  return `<project_profile type="${profile.type}">\n${stackTag}${languagesTag}${layoutTag}</project_profile>`;
}
