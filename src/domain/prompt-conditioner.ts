/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectProfile } from "./types.js";

export type { ProjectProfile };

export function conditionPrompt(
  prompt: string,
  profile: ProjectProfile,
): string {
  if (!profile || profile.type === "unknown") {
    if (profile?.design) {
      return `${generateProjectContext(profile.design)}\n\n${prompt}`;
    }
    return prompt;
  }

  const alwaysInclude = new Set(["generic"]);
  if (profile.type === "gwrk-cli" || profile._isGwrk) {
    alwaysInclude.add("gwrk-native");
  }

  const guardRegex = /\[type:\s*([^\]]+)\]([\s\S]*?)\[\/type\]/g;
  const conditioned = prompt.replace(guardRegex, (_match, type, content) => {
    const types = type.split(",").map((t: string) => t.trim());
    if (types.some((t: string) => alwaysInclude.has(t))) {
      return content;
    }
    if (types.includes(profile.type)) {
      return content;
    }
    return "";
  });

  if (profile.design) {
    const xml = generateProfileXml(profile, escapeXml);
    return `${generateProjectContext(profile.design, xml)}\n\n${conditioned.trim()}`;
  }
  return `${generateProfileXml(profile)}\n\n${conditioned.trim()}`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function generateProjectContext(
  design: NonNullable<ProjectProfile["design"]>,
  profileXml?: string,
): string {
  const principles = design.principles.map(
    (principle) => `    <principle>${escapeXml(principle)}</principle>`,
  );
  return [
    "<project_context>",
    ...(profileXml ? [profileXml] : []),
    `  <design templateVersion="${escapeXml(design.templateVersion)}">`,
    `    <architecture>${escapeXml(design.architecture)}</architecture>`,
    ...principles,
    "  </design>",
    "</project_context>",
  ].join("\n");
}

function generateProfileXml(
  profile: ProjectProfile,
  renderValue: (value: string) => string = (value) => value,
): string {
  const stackAttrs = [];
  if (profile.stack?.language)
    stackAttrs.push(`language="${renderValue(profile.stack.language)}"`);
  if (profile.stack?.framework)
    stackAttrs.push(`framework="${renderValue(profile.stack.framework)}"`);
  if (profile.stack?.buildSystem)
    stackAttrs.push(`buildSystem="${renderValue(profile.stack.buildSystem)}"`);

  const stackTag =
    stackAttrs.length > 0 ? `  <stack ${stackAttrs.join(" ")} />\n` : "";

  let languagesTag = "";
  if (profile.stack?.languages && profile.stack.languages.length > 1) {
    const langItems = profile.stack.languages
      .map((lang) => `    <lang>${renderValue(lang)}</lang>`)
      .join("\n");
    languagesTag = `  <languages>\n${langItems}\n  </languages>\n`;
  }

  let layoutTag = "";
  if (typeof profile.layout === "string" && profile.layout) {
    layoutTag = `  <layout type="${renderValue(profile.layout)}" />\n`;
  } else if (typeof profile.layout === "object" && profile.layout !== null) {
    const layoutAttrs = Object.entries(profile.layout)
      .map(([k, v]) => `${k}="${renderValue(String(v))}"`)
      .join(" ");
    layoutTag = `  <layout ${layoutAttrs} />\n`;
  }

  return `<project_profile type="${renderValue(profile.type)}">\n${stackTag}${languagesTag}${layoutTag}</project_profile>`;
}
