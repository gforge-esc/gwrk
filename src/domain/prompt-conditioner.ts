/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { ProjectProfile } from "./types.js";

export type { ProjectProfile };

export function conditionPrompt(prompt: string, profile: ProjectProfile): string {
  if (!profile || profile.type === "unknown") {
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

  const xml = generateProfileXml(profile);
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
