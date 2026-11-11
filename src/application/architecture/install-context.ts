/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type ContextInput,
  contextMarkdown,
  decisionMarkdown,
} from "../../domain/architecture-context.js";
import type { ContextFilesPort } from "../../ports/context-files-port.js";

interface ContextManifest {
  version: 1;
  files: Record<string, string>;
  decisions: Record<string, string[]>;
}
export interface ContextInstallation {
  status: "ready" | "incomplete";
  conformance: "unassessed";
  decisions: string[];
  conflicts: string[];
}
const BEGIN = "<!-- gwrk:architecture:begin -->";
const END = "<!-- gwrk:architecture:end -->";

export async function installContext(
  files: ContextFilesPort,
  input: ContextInput,
): Promise<ContextInstallation> {
  const manifestPath = ".gwrk/context-manifest.json";
  const prior = await files.read(manifestPath);
  const manifest: ContextManifest = prior
    ? JSON.parse(prior)
    : { version: 1, files: {}, decisions: {} };
  const conflicts: string[] = [];
  const key = JSON.stringify(input);
  let decisions = manifest.decisions[key];
  if (!decisions) {
    const entries = await files.list(input.decisionsDir);
    const max = entries.reduce(
      (value, entry) =>
        Math.max(value, Number(/^ADR-(\d+)-/.exec(entry)?.[1] ?? 0)),
      0,
    );
    const number = String(max + 1).padStart(3, "0");
    const file = `${input.decisionsDir}/ADR-${number}-desired-architecture.md`;
    if ((await files.read(file)) !== null)
      throw new Error(`Decision already exists: ${file}`);
    await files.write(file, decisionMarkdown(input, number, files.today()));
    decisions = [file];
    manifest.decisions[key] = decisions;
  }
  for (const file of decisions)
    if ((await files.read(file)) === null) conflicts.push(file);

  async function managed(file: string, content: string, block = false) {
    const existing = await files.read(file);
    let current = existing;
    if (block && existing !== null) {
      const start = existing.indexOf(BEGIN);
      const end = existing.indexOf(END);
      if (start < 0 !== end < 0 || (start >= 0 && end < start)) {
        conflicts.push(file);
        return;
      }
      current = start < 0 ? null : existing.slice(start, end + END.length);
    }
    const hash = manifest.files[file];
    if (
      current !== null &&
      current !== content &&
      (!hash || files.hash(current) !== hash)
    ) {
      conflicts.push(file);
      return;
    }
    let next = content;
    if (block && existing !== null) {
      const start = existing.indexOf(BEGIN);
      next =
        start < 0
          ? `${existing.trimEnd()}\n\n${content}\n`
          : existing.slice(0, start) +
            content +
            existing.slice(existing.indexOf(END) + END.length);
    }
    await files.write(file, next);
    manifest.files[file] = files.hash(content);
  }
  await managed(".gwrk/architecture.md", contextMarkdown(input, decisions));
  const instruction = `${BEGIN}\nRead .gwrk/architecture.md and .gwrk/decisions/index.md before design or implementation.\nThe selected architecture is a target. Initialization does not assess code conformance.\nUse the gwrk-assess skill for explicit assessment or run gwrk assess.\n${END}`;
  for (const file of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"])
    await managed(file, instruction, true);
  const skill = await files.bundled("skills/gwrk-assess/SKILL.md");
  const contract = await files.bundled(
    "skills/gwrk-assess/references/assessment.md",
  );
  const pluginRoot = ".gwrk/plugins/gwrk";
  await managed(`${pluginRoot}/skills/gwrk-assess/SKILL.md`, skill);
  await managed(
    `${pluginRoot}/skills/gwrk-assess/references/assessment.md`,
    contract,
  );
  await managed(
    `${pluginRoot}/.claude-plugin/plugin.json`,
    `${JSON.stringify({ name: "gwrk", version: "1.0.0", description: "Project architecture assessment and ordered feature proposals", skills: "./skills/" }, null, 2)}\n`,
  );
  await managed(
    ".gwrk/.claude-plugin/marketplace.json",
    `${JSON.stringify({ name: "gwrk", owner: { name: "gwrk project maintainers" }, plugins: [{ name: "gwrk", source: "./plugins/gwrk", description: "Assess project architecture against its declared target" }] }, null, 2)}\n`,
  );
  await managed(
    `${pluginRoot}/gemini-extension.json`,
    `${JSON.stringify({ name: "gwrk", version: "1.0.0", contextFileName: "GEMINI.md" }, null, 2)}\n`,
  );
  await managed(
    `${pluginRoot}/GEMINI.md`,
    "Read the gwrk-assess skill when asked to assess project architecture. Resolve project context from the user's working repository.\n",
  );
  await managed(
    `${pluginRoot}/commands/gwrk/assess.toml`,
    'description = "Assess the current project against its declared architecture"\nprompt = """Use the gwrk-assess skill to assess the current project. Read .gwrk/architecture.md first. {{args}}"""\n',
  );
  await files.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    status: conflicts.length ? "incomplete" : "ready",
    conformance: "unassessed",
    decisions,
    conflicts,
  };
}
