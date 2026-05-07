import fs from "node:fs";
import path from "node:path";
import type { GwrkConfig } from "../utils/config.js";
import {
  detectDefaultBranch,
  gitBranches,
  gitDraftLineCount,
  gitLineCount,
  gitLog,
  gitMainCommits,
} from "../utils/git.js";
import type {
  PulseReport,
  PulseSnapshot,
  SpecProgress,
  WeeklyBucket,
} from "./types.js";
import { PulseReportSchema, PulseSnapshotSchema } from "./types.js";

interface ParsedCommit {
  hash: string;
  timestamp: string;
  files: { added: number; deleted: number; path: string }[];
}

/**
 * Parses raw output from `git log --numstat --format=%H|%aI`
 */
export function parseGitLog(raw: string): ParsedCommit[] {
  if (!raw || !raw.trim()) return [];

  const commits: ParsedCommit[] = [];
  const blocks = raw.trim().split(/(?=^[a-f0-9]+\|)/m); // Split by commit hash line

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.trim().split("\n");
    if (lines.length === 0) continue;

    const [hash, timestamp] = lines[0].split("|");
    if (!hash || !timestamp) continue;

    const parsed: ParsedCommit = { hash, timestamp, files: [] };

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const [addedStr, deletedStr, filePath] = line.split(/\t+/);

      // Handle rename format e.g. "path/{old => new}"
      let finalPath = filePath;
      if (finalPath?.includes("=>")) {
        const match = finalPath.match(/\{(.*) => (.*)\}/);
        if (match) {
          finalPath = finalPath.replace(match[0], match[2]);
        }
      }

      // Handle binary files which output "-" for added/deleted
      const added = addedStr === "-" ? 0 : Number.parseInt(addedStr, 10) || 0;
      const deleted =
        deletedStr === "-" ? 0 : Number.parseInt(deletedStr, 10) || 0;

      if (finalPath) {
        parsed.files.push({ added, deleted, path: finalPath });
      }
    }

    commits.push(parsed);
  }

  return commits;
}

/**
 * Groups commits into ISO-week buckets. Output is sorted oldest first.
 */
export function bucketByWeek(
  commits: ParsedCommit[],
  defaultBranchCommits: Set<string>,
): WeeklyBucket[] {
  if (commits.length === 0) return [];

  const buckets = new Map<string, WeeklyBucket>();

  // Optional: Since git history can be non-linear or commits unordered, sort them chronologically first
  const sortedCommits = [...commits].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );

  for (const commit of sortedCommits) {
    // Determine ISO week (Monday of that week)
    const d = new Date(commit.timestamp);
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const weekStart = new Date(d.setUTCDate(diff));
    weekStart.setUTCHours(0, 0, 0, 0);
    const weekStartIso = weekStart.toISOString();

    if (!buckets.has(weekStartIso)) {
      buckets.set(weekStartIso, {
        weekStart: weekStartIso,
        totalMain: 0,
        totalDrafts: 0,
        added: 0,
        deleted: 0,
      });
    }

    const bucket = buckets.get(weekStartIso) as WeeklyBucket;

    const isMain = defaultBranchCommits.has(commit.hash);
    for (const file of commit.files) {
      const net = file.added - file.deleted;
      if (isMain) {
        bucket.totalMain += net;
      } else {
        bucket.totalDrafts += net;
      }
      bucket.added += file.added;
      bucket.deleted += file.deleted;
    }
  }

  const result = Array.from(buckets.values());
  result.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Compute totalMain and totalDrafts cumulatively
  let runningMain = 0;
  let runningDrafts = 0;
  for (const bucket of result) {
    runningMain += bucket.totalMain;
    runningDrafts += bucket.totalDrafts;
    bucket.totalMain = Math.max(0, runningMain);
    bucket.totalDrafts = Math.max(0, runningDrafts);
  }

  return result;
}

/**
 * Scans a single repository and returns a PulseSnapshot.
 */
export function scanRepository(
  repoPath: string,
  branchOverride?: string,
): PulseSnapshot {
  if (!fs.existsSync(repoPath)) {
    throw new Error(`Path not found: ${repoPath}`);
  }
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }

  const defaultBranch = detectDefaultBranch(repoPath, branchOverride);
  const mainCommits = gitMainCommits(repoPath, defaultBranch);
  const rawLog = gitLog(repoPath);
  const commits = parseGitLog(rawLog);
  const buckets = bucketByWeek(commits, mainCommits);

  const mainLoc = gitLineCount(repoPath, defaultBranch);

  // Find lines added in any branch besides defaultBranch that haven't been merged
  const draftLoc = gitDraftLineCount(repoPath, defaultBranch);

  const snapshot: PulseSnapshot = {
    repoPath: repoPath,
    repoName: path.basename(repoPath),
    defaultBranch,
    scannedAt: new Date().toISOString(),
    mainLoc,
    draftLoc,
    weeklyBuckets: buckets,
  };

  return PulseSnapshotSchema.parse(snapshot);
}

/**
 * Scans project specs directory for progress metrics.
 */
export function scanSpecProgress(projectRoot: string): SpecProgress {
  let totalSpecs = 0;
  let totalPlans = 0;

  const specsDir = path.join(projectRoot, "specs");
  if (!fs.existsSync(specsDir)) {
    return { totalSpecs, totalPlans };
  }

  const features = fs
    .readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const feature of features) {
    if (fs.existsSync(path.join(specsDir, feature, "spec.md"))) {
      totalSpecs++;
    }
    if (fs.existsSync(path.join(specsDir, feature, "plan.md"))) {
      totalPlans++;
    }
  }

  return { totalSpecs, totalPlans };
}

/**
 * Scans multiple repos and aggregates a PulseReport.
 */
export function generatePulseReport(config: GwrkConfig): PulseReport {
  const repos = config.pulse?.repos;

  if (!repos || repos.length === 0) {
    throw new Error(
      "No repositories tracked. Add repos to .gwrkrc.json pulse.repos",
    );
  }

  const repositories: PulseSnapshot[] = [];
  for (const repo of repos) {
    repositories.push(scanRepository(repo));
  }

  // Assuming current working directory is the main project root
  const specProgress = scanSpecProgress(process.cwd());

  const report: PulseReport = {
    generatedAt: new Date().toISOString(),
    repositories,
    specProgress,
  };

  return PulseReportSchema.parse(report);
}
