import type { GwrkConfig } from "../utils/config.js";
import type { PulseReport, PulseSnapshot, SpecProgress, WeeklyBucket } from "./types.js";
interface ParsedCommit {
    hash: string;
    timestamp: string;
    files: {
        added: number;
        deleted: number;
        path: string;
    }[];
}
/**
 * Parses raw output from `git log --numstat --format=%H|%aI`
 */
export declare function parseGitLog(raw: string): ParsedCommit[];
/**
 * Groups commits into ISO-week buckets. Output is sorted oldest first.
 */
export declare function bucketByWeek(commits: ParsedCommit[], defaultBranch: string): WeeklyBucket[];
/**
 * Scans a single repository and returns a PulseSnapshot.
 */
export declare function scanRepository(repoPath: string): PulseSnapshot;
/**
 * Scans project specs directory for progress metrics.
 */
export declare function scanSpecProgress(projectRoot: string): SpecProgress;
/**
 * Scans multiple repos and aggregates a PulseReport.
 */
export declare function generatePulseReport(config: GwrkConfig): PulseReport;
export {};
