/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
const categories = [
  "reasoning",
  "evaluative",
  "creative",
  "persona",
  "communication",
  "operational",
  "meta",
] as const;
export interface SeedSkill {
  name: string;
  category: (typeof categories)[number];
  description: string;
  prompt: string;
}
export function parseSeedTaxonomy(content: string): SeedSkill[] {
  const skills: SeedSkill[] = [];
  const names = new Set<string>();
  for (const section of content.replace(/\r\n?/g, "\n").split(/^\s*---\s*$/m)) {
    const header = section
      .trim()
      .split("\n", 1)[0]
      .replace(/^#+\s*/, "")
      .toLowerCase();
    const category = categories.find((value) => header === `${value} modes`);
    const declared = [...section.matchAll(/^\s*\d+\.\s+\*\*/gm)].length;
    if (!category) {
      if (declared) throw new Error(`Unknown taxonomy category: ${header}`);
      continue;
    }
    const entries = [
      ...section.matchAll(
        /^\s*\d+\.\s+\*\*([^*\n]+)\*\*\s+-\s+([^\n]+)\s+>\s*"([^"]+)"[ \t]*$/gm,
      ),
    ];
    if (!declared || entries.length !== declared)
      throw new Error(`Incomplete taxonomy entries in ${category}`);
    for (const entry of entries) {
      const name = entry[1].trim().toLowerCase().replace(/\s+/g, "-");
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name))
        throw new Error(`Invalid taxonomy skill name: ${entry[1]}`);
      if (names.has(name)) throw new Error(`Duplicate taxonomy skill: ${name}`);
      const description = entry[2].trim();
      const prompt = entry[3].trim();
      if (!description || !prompt)
        throw new Error(`Empty taxonomy skill: ${name}`);
      names.add(name);
      skills.push({ name, category, description, prompt });
    }
  }
  if (!skills.length) throw new Error("Taxonomy contains no skill entries");
  return skills;
}
