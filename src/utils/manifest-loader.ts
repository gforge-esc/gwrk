/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { type AnyManifest, AnyManifestSchema } from "../plugins/manifest.js";

export class ManifestValidationError extends Error {
  constructor(name: string, details: string) {
    super(`Invalid manifest for plugin '${name}': ${details}`);
    this.name = "ManifestValidationError";
  }
}

export async function loadManifestFromSkillMarkdown(
  pluginDir: string,
): Promise<AnyManifest | null> {
  const skillMdPath = path.join(pluginDir, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return null;
    const frontmatter = (parse(match[1] ?? "") || {}) as Record<
      string,
      unknown
    >;
    const body = (match[2] ?? "").trim();
    const rawName =
      typeof frontmatter.name === "string" && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : path.basename(pluginDir);
    const description =
      typeof frontmatter.description === "string" &&
      frontmatter.description.trim()
        ? frontmatter.description.trim()
        : `Skill ${rawName}`;
    const version =
      typeof frontmatter.version === "string" && frontmatter.version.trim()
        ? frontmatter.version.trim()
        : "1.0.0";
    const synthesized = {
      type: "skill",
      name: rawName,
      version,
      description,
      ...(typeof frontmatter.disabled === "boolean"
        ? { disabled: frontmatter.disabled }
        : {}),
      ...(typeof frontmatter.minGwrkVersion === "string"
        ? { minGwrkVersion: frontmatter.minGwrkVersion }
        : {}),
      tier: "atomic",
      category: "reasoning",
      prompt: body || description,
      interface: {
        input: "stdin",
        output: "stdout",
      },
      runtime: {
        preferredAgent: "agy",
        preferredModel: "default",
      },
    };
    const result = AnyManifestSchema.safeParse(synthesized);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/**
 * Loads and validates a manifest.yaml file (or SKILL.md frontmatter) from a plugin directory.
 */
export async function loadManifest(pluginDir: string): Promise<AnyManifest> {
  const manifestPath = path.join(pluginDir, "manifest.yaml");
  try {
    const content = await fs.readFile(manifestPath, "utf-8");
    const raw = parse(content);
    const result = AnyManifestSchema.safeParse(raw);
    if (!result.success) {
      throw new ManifestValidationError(
        path.basename(pluginDir),
        result.error.message,
      );
    }
    return result.data;
  } catch (e) {
    if (e instanceof ManifestValidationError) throw e;
    const fromSkillMd = await loadManifestFromSkillMarkdown(pluginDir);
    if (fromSkillMd) return fromSkillMd;
    throw new Error(
      `Could not load manifest from ${manifestPath}: ${(e as Error).message}`,
    );
  }
}
