/**
 * src/engine/prompt-conditioner.ts
 * Phase 13: Project Awareness
 */

export interface ProjectProfile {
  type: string;
  stack?: {
    language?: string;
    framework?: string;
    buildSystem?: string;
  };
  layout?: string;
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
  // If the type matches profile.type, keep the content. Otherwise, remove it.
  const guardRegex = /\[type:\s*([^\]]+)\]([\s\S]*?)\[\/type\]/g;
  let conditioned = prompt.replace(guardRegex, (match, type, content) => {
    const types = type.split(",").map((t: string) => t.trim());
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
  
  let layoutTag = "";
  if (typeof profile.layout === "string" && profile.layout) {
    layoutTag = `  <layout type="${profile.layout}" />\n`;
  } else if (typeof profile.layout === "object" && profile.layout !== null) {
    const layoutAttrs = Object.entries(profile.layout)
      .map(([k, v]) => `${k}="${v}"`)
      .join(" ");
    layoutTag = `  <layout ${layoutAttrs} />\n`;
  }

  return `<project_profile type="${profile.type}">\n${stackTag}${layoutTag}</project_profile>`;
}
