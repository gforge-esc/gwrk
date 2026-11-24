/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { PolicyCandidate } from "../domain/policy-selection.js";
import { CommandError } from "../utils/signal.js";
export const PolicyPinSchema = z.strictObject({
  name: z.string().min(1),
  source: z.enum(["builtin", "global", "project-entry", "project-local"]),
  version: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const ProjectPolicyLockSchema = z.strictObject({
  version: z.literal(1),
  gwrkVersion: z.string().min(1),
  skills: z
    .array(PolicyPinSchema)
    .refine(
      (pins) => new Set(pins.map((pin) => pin.name)).size === pins.length,
      "Policy skill names must be unique",
    ),
});
export type ProjectPolicyLock = z.infer<typeof ProjectPolicyLockSchema>;
export type PolicyLockCandidate = PolicyCandidate & {
  sourceManifest?: unknown;
};
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    );
  return value;
}
export function computePolicySkillDigest(
  manifest: unknown,
  text: string,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([sorted(manifest), text.replace(/\r\n?/g, "\n")]),
      "utf8",
    )
    .digest("hex");
}
export async function readProjectPolicyLock(
  projectRoot: string,
): Promise<ProjectPolicyLock | undefined> {
  const file = join(projectRoot, ".gwrk", "policy-lock.json");
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    stat = lstatSync(file, { throwIfNoEntry: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw new CommandError(
      `Cannot read ${file}. Review the tracked lock and restore a readable file.`,
    );
  }
  if (stat === undefined) return undefined;
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const absent = await lstat(file).then(
        () => false,
        (probe: NodeJS.ErrnoException) => probe.code === "ENOENT",
      );
      if (absent) return undefined;
    }
    throw new CommandError(
      `Cannot read ${file}. Review the tracked lock and restore a readable file.`,
    );
  }
  try {
    return ProjectPolicyLockSchema.parse(JSON.parse(text));
  } catch {
    throw new CommandError(
      `Invalid ${file}. Review the tracked version 1 lock and its unique skill pins.`,
    );
  }
}
export function verifyProjectPolicyLock<T extends PolicyLockCandidate>(
  lock: ProjectPolicyLock,
  candidates: readonly T[],
  gwrkVersion: string,
): T[] {
  const file = ".gwrk/policy-lock.json";
  if (lock.gwrkVersion !== gwrkVersion)
    throw new CommandError(
      `${file} requires gwrk ${lock.gwrkVersion}, found ${gwrkVersion}. Provision that release or review the tracked lock.`,
    );
  const selected = new Set<T>();
  for (const pin of lock.skills) {
    const matches = candidates.filter(
      (candidate) =>
        candidate.name === pin.name && candidate.source === pin.source,
    );
    const candidate = matches.length === 1 ? matches[0] : undefined;
    if (
      !candidate ||
      candidate.manifest.disabled ||
      candidate.manifest.version !== pin.version ||
      typeof candidate.content !== "string" ||
      !candidate.content.trim() ||
      computePolicySkillDigest(
        candidate.sourceManifest ?? candidate.manifest,
        candidate.content,
      ) !== pin.sha256
    ) {
      throw new CommandError(
        `${file} pin ${pin.name} from ${pin.source} requires version ${pin.version} and SHA-256 ${pin.sha256}. Provision the pinned package or review and update the tracked lock.`,
      );
    }
    selected.add(candidate);
  }
  return candidates.filter((candidate) => selected.has(candidate));
}
