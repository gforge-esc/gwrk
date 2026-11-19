/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { validateAssessment } from "../../domain/architecture-assessment.js";
import type { ProjectDesign } from "../../domain/architecture-context.js";
import { repositoryGitEnv } from "../git/process-env.js";

const executeFile = promisify(execFile);
const targetPath = ".gwrk/architecture.md";
const manifestPath = ".gwrk/context-manifest.json";
const indexPath = ".gwrk/decisions/index.md";
type IssueKind = "missing" | "invalid" | "unreadable" | "hash-mismatch";
type FileRead =
  | { kind: "present"; bytes: Buffer }
  | { kind: "missing" | "unreadable" };
export interface ArchitectureReadiness {
  target: { selection: ProjectDesign | null; path: string | null };
  context: {
    status: "missing" | "incomplete" | "ready";
    issues: Array<{ path: string; kind: IssueKind }>;
  };
  assessment: {
    latest: {
      reportPath: string;
      generatedAt: string | null;
      revision: string | null;
      targetMatch: "matches" | "differs" | "unknown";
      scope: { inspected: string[]; limitations: string[] } | null;
    } | null;
  };
}
const ManifestSchema = z.object({
  version: z.literal(1),
  files: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
  decisions: z.record(z.array(z.string())),
});
const ProvenanceSchema = z.object({
  generatedAt: z.string().datetime({ offset: true }),
  revision: z.unknown().optional(),
  targetHash: z.unknown().optional(),
});
function within(root: string, target: string): boolean {
  const suffix = relative(root, target);
  return (
    suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  );
}
async function safePath(
  root: string,
  path: string,
): Promise<string | undefined> {
  try {
    const canonical = await realpath(path);
    return within(root, canonical) ? canonical : undefined;
  } catch {
    return undefined;
  }
}
async function read(root: string, path: string): Promise<FileRead> {
  try {
    const canonical = await realpath(join(root, path));
    if (!within(root, canonical) || !(await stat(canonical)).isFile())
      return { kind: "unreadable" };
    return { kind: "present", bytes: await readFile(canonical) };
  } catch (error) {
    return {
      kind:
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "ENOENT"
          ? "missing"
          : "unreadable",
    };
  }
}
function json(file: FileRead): unknown {
  if (file.kind !== "present") return undefined;
  try {
    return JSON.parse(file.bytes.toString("utf8"));
  } catch {
    return undefined;
  }
}
function archiveTimestamp(directory: string): number | undefined {
  const date = /^(\d{4}-\d{2}-\d{2})(?:$|[-_T])/.exec(directory)?.[1];
  if (!date) return undefined;
  const timestamp = Date.parse(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== date
  )
    return undefined;
  const clock = /^\d{4}-\d{2}-\d{2}T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(
    directory,
  );
  if (!clock) return timestamp;
  const precise = Date.parse(
    `${date}T${clock[1]}:${clock[2]}:${clock[3]}.${clock[4]}Z`,
  );
  return Number.isFinite(precise) &&
    new Date(precise).toISOString().slice(0, 10) === date
    ? precise
    : timestamp;
}

export async function readArchitectureReadiness(
  projectRoot: string,
  design?: ProjectDesign,
): Promise<ArchitectureReadiness | undefined> {
  const root = await realpath(projectRoot).catch(() => resolve(projectRoot));
  const [target, manifest, index] = await Promise.all([
    read(root, targetPath),
    read(root, manifestPath),
    read(root, indexPath),
  ]);
  const issues: ArchitectureReadiness["context"]["issues"] = [];
  for (const [path, file] of [
    [targetPath, target],
    [manifestPath, manifest],
    [indexPath, index],
  ] as const) {
    if (file.kind !== "present") issues.push({ path, kind: file.kind });
  }
  const currentHash =
    target.kind === "present"
      ? createHash("sha256").update(target.bytes).digest("hex")
      : undefined;
  const parsedManifest = ManifestSchema.safeParse(json(manifest));
  if (manifest.kind === "present") {
    if (!parsedManifest.success || !parsedManifest.data.files[targetPath])
      issues.push({ path: manifestPath, kind: "invalid" });
    else if (
      currentHash &&
      parsedManifest.data.files[targetPath] !== currentHash
    )
      issues.push({ path: targetPath, kind: "hash-mismatch" });
  }
  const directories = new Map<string, number | undefined>();
  const archive = await safePath(
    root,
    join(root, "docs/architecture/assessments"),
  );
  if (archive) {
    const entries = await readdir(archive, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      const time = archiveTimestamp(entry.name);
      if (time === undefined) continue;
      const directory = await safePath(root, join(archive, entry.name));
      if (
        directory &&
        (await stat(directory)
          .then((entry) => entry.isDirectory())
          .catch(() => false))
      )
        directories.set(directory, time);
    }
  }
  try {
    const { stdout } = await executeFile(
      "git",
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ":(glob)**/assessment.json",
      ],
      {
        cwd: root,
        env: { ...repositoryGitEnv(root), GIT_OPTIONAL_LOCKS: "0" },
        timeout: 5_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    for (const path of stdout.split("\0")) {
      if (!path) continue;
      const directory = await safePath(root, dirname(join(root, path)));
      if (directory && !directories.has(directory))
        directories.set(directory, undefined);
    }
  } catch {
    /* Custom inventory requires a readable Git checkout. */
  }
  type Candidate = {
    time: number;
    report: NonNullable<ArchitectureReadiness["assessment"]["latest"]>;
  };
  const candidates: Candidate[] = [];
  let assessmentEvidence = false;
  for (const [directory, fallbackTime] of directories) {
    const prefix = relative(root, directory).split(sep).join("/");
    const reportPath = posix.join(prefix, "report.md");
    const [report, data, source] = await Promise.all([
      read(root, reportPath),
      read(root, posix.join(prefix, "assessment.json")),
      read(root, posix.join(prefix, "provenance.json")),
    ]);
    assessmentEvidence ||= [report, data, source].some(
      (file) => file.kind !== "missing",
    );
    if (report.kind !== "present" || !report.bytes.toString("utf8").trim())
      continue;
    const provenance = ProvenanceSchema.safeParse(json(source));
    const recorded =
      provenance.success &&
      Number.isFinite(Date.parse(provenance.data.generatedAt))
        ? provenance.data
        : undefined;
    const time = recorded ? Date.parse(recorded.generatedAt) : fallbackTime;
    if (time === undefined) continue;
    let scope: NonNullable<
      ArchitectureReadiness["assessment"]["latest"]
    >["scope"] = null;
    try {
      const assessment = validateAssessment(json(data));
      scope = {
        inspected: assessment.inspected,
        limitations: assessment.limitations,
      };
    } catch {
      /* A readable report remains useful without structured scope. */
    }
    const recordedHash =
      typeof recorded?.targetHash === "string" &&
      /^[a-fA-F0-9]{64}$/.test(recorded.targetHash)
        ? recorded.targetHash.toLowerCase()
        : undefined;
    candidates.push({
      time,
      report: {
        reportPath,
        generatedAt: recorded?.generatedAt ?? null,
        revision:
          typeof recorded?.revision === "string" && recorded.revision.trim()
            ? recorded.revision
            : null,
        targetMatch:
          recordedHash && currentHash
            ? recordedHash === currentHash
              ? "matches"
              : "differs"
            : "unknown",
        scope,
      },
    });
  }
  candidates.sort(
    (a, b) =>
      b.time - a.time ||
      (a.report.reportPath < b.report.reportPath
        ? -1
        : a.report.reportPath > b.report.reportPath
          ? 1
          : 0),
  );
  if (
    !design &&
    !assessmentEvidence &&
    [target, manifest, index].every((file) => file.kind === "missing")
  )
    return undefined;
  return {
    target: {
      selection: design ?? null,
      path: target.kind === "present" ? targetPath : null,
    },
    context: {
      status:
        target.kind === "missing" && manifest.kind === "missing"
          ? "missing"
          : issues.length
            ? "incomplete"
            : "ready",
      issues,
    },
    assessment: { latest: candidates[0]?.report ?? null },
  };
}
