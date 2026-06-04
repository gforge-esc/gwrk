import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/index.js";
export { computeLeadingIndicators } from "./indicators.js";
import type {
  CommitCluster,
  CompressionRatios,
  CompressionReport,
  CompressionSummary,
  DeliveryActuals,
  EffortForecast,
  LeadingIndicators,
} from "./types.js";

/**
 * Clusters timestamps into work sessions.
 * (FR-H05)
 */
export function clusterCommits(
  timestamps: number[],
  gapMinutes: number,
): CommitCluster[] {
  if (timestamps.length === 0) return [];

  const sorted = [...timestamps].sort((a, b) => a - b);
  const gapMs = gapMinutes * 60 * 1000;
  const clusters: CommitCluster[] = [];

  let currentStart = sorted[0] as number;
  let currentEnd = sorted[0] as number;
  let commitCount = 1;

  for (let i = 1; i < sorted.length; i++) {
    const ts = sorted[i] as number;
    if (ts - currentEnd > gapMs) {
      // Close current cluster
      const durationMinutes = Math.max((currentEnd - currentStart) / 60000, 5);
      clusters.push({
        id: `session-${clusters.length + 1}`,
        start: new Date(currentStart).toISOString(),
        end: new Date(currentEnd).toISOString(),
        durationMinutes,
        commitCount,
      });

      // Start new cluster
      currentStart = ts;
      currentEnd = ts;
      commitCount = 1;
    } else {
      currentEnd = ts;
      commitCount++;
    }
  }

  // Final cluster
  const durationMinutes = Math.max((currentEnd - currentStart) / 60000, 5);
  clusters.push({
    id: `session-${clusters.length + 1}`,
    start: new Date(currentStart).toISOString(),
    end: new Date(currentEnd).toISOString(),
    durationMinutes,
    commitCount,
  });

  return clusters;
}

/**
 * Computes compression ratios for a feature phase.
 * Point Compression: How much faster agents ship per story point vs human baseline.
 * Total Compression: How much faster the feature is delivered vs human schedule.
 * (FR-H04, FR-H05)
 */
export function computeCompression(
  forecast: EffortForecast,
  actuals: DeliveryActuals,
): CompressionRatios {
  // Point Compression = Estimated Coding Hours / Actual Coding Time (hours)
  // Actual coding time is derived from commit clustering (FR-H04)
  const actualHours = actuals.activeCodingMinutes / 60;
  const pointCompression =
    actualHours > 0
      ? forecast.estimatedHours / actualHours
      : Number.POSITIVE_INFINITY;

  // Total Compression = Estimated Elapsed Days / Actual Elapsed Days
  // Actual days is delivery window: first commit -> merge (FR-H05)
  const actualDays = actuals.deliveryWindowHours / 24;
  const totalCompression =
    actualDays > 0
      ? forecast.estimatedDays / actualDays
      : Number.POSITIVE_INFINITY;

  return {
    pointCompression,
    totalCompression,
    dormancyDays: actuals.dormancyDays,
  };
}

export function generateSummary(
  reports: CompressionReport[],
): CompressionSummary {
  const summary: CompressionSummary = {
    projectName: "Unknown", // Can be overridden
    generatedAt: new Date().toISOString(),
    features: reports,
    totals: {
      totalSP: 0,
      totalEstimatedHours: 0,
      totalActualCodingHours: 0,
      avgPointCompression: 0,
      avgTotalCompression: 0,
      avgFirstPassRate: 0,
      avgAvgAttempts: 0,
      avgLinesPerSP: 0,
      avgFilesPerSP: 0,
      avgToolCallsPerSP: 0,
      totalContracts: 0,
      totalGates: 0,
    },
    best: { featureId: "", pointCompression: 0 },
    worst: { featureId: "", pointCompression: Number.POSITIVE_INFINITY },
    trend: "stable",
  };

  if (reports.length === 0) return summary;

  let totalPointCompression = 0;
  let totalTotalCompression = 0;
  
  let indicatorsCount = 0;
  let totalFirstPassRate = 0;
  let totalAvgAttempts = 0;
  let totalLines = 0;
  let totalFiles = 0;
  let totalToolCalls = 0;
  let totalSPForIndicators = 0;

  for (const r of reports) {
    summary.totals.totalSP += r.forecast.totalSP;
    summary.totals.totalEstimatedHours += r.forecast.estimatedHours;
    summary.totals.totalActualCodingHours += r.actuals.activeCodingMinutes / 60;

    totalPointCompression += r.compression.pointCompression;
    totalTotalCompression += r.compression.totalCompression;
    
    if (r.indicators) {
      indicatorsCount++;
      totalFirstPassRate += r.indicators.convergence.firstPassRate;
      totalAvgAttempts += r.indicators.convergence.avgAttempts;
      
      // Weight density by SP
      totalLines += r.indicators.density.linesPerSP * r.forecast.totalSP;
      totalFiles += r.indicators.density.filesPerSP * r.forecast.totalSP;
      totalToolCalls += r.indicators.density.toolCallsPerSP * r.forecast.totalSP;
      totalSPForIndicators += r.forecast.totalSP;

      summary.totals.totalContracts = (summary.totals.totalContracts || 0) + r.indicators.specQuality.contractCount;
      summary.totals.totalGates = (summary.totals.totalGates || 0) + r.indicators.specQuality.gateCount;
    }

    if (r.compression.pointCompression > summary.best.pointCompression) {
      summary.best = {
        featureId: r.featureId,
        pointCompression: r.compression.pointCompression,
      };
    }
    if (r.compression.pointCompression < summary.worst.pointCompression) {
      summary.worst = {
        featureId: r.featureId,
        pointCompression: r.compression.pointCompression,
      };
    }
  }

  const count = reports.length;
  summary.totals.avgPointCompression = totalPointCompression / count;
  summary.totals.avgTotalCompression = totalTotalCompression / count;

  if (indicatorsCount > 0) {
    summary.totals.avgFirstPassRate = totalFirstPassRate / indicatorsCount;
    summary.totals.avgAvgAttempts = totalAvgAttempts / indicatorsCount;
    
    if (totalSPForIndicators > 0) {
      summary.totals.avgLinesPerSP = totalLines / totalSPForIndicators;
      summary.totals.avgFilesPerSP = totalFiles / totalSPForIndicators;
      summary.totals.avgToolCallsPerSP = totalToolCalls / totalSPForIndicators;
    }
  }

  const sorted = [...reports].sort(
    (a, b) =>
      new Date(a.actuals.firstImplCommit).getTime() -
      new Date(b.actuals.firstImplCommit).getTime(),
  );

  if (sorted.length > 1) {
    const mid = Math.floor(sorted.length / 2);
    const firstHalf = sorted.slice(0, mid);
    const secondHalf = sorted.slice(mid);

    const firstHalfAvg =
      firstHalf.reduce((sum, r) => sum + r.compression.pointCompression, 0) /
      firstHalf.length;
    const secondHalfAvg =
      secondHalf.reduce((sum, r) => sum + r.compression.pointCompression, 0) /
      secondHalf.length;

    if (secondHalfAvg > firstHalfAvg * 1.05) {
      summary.trend = "improving";
    } else if (secondHalfAvg < firstHalfAvg * 0.95) {
      summary.trend = "declining";
    }
  }

  return summary;
}

/**
 * Gathers delivery actuals securely from the filesystem and git.
 */
export function gatherDeliveryActuals(
  featureDir: string,
  sessionGapMinutes = 30,
  prNumber?: number,
): DeliveryActuals {
  const specPath = path.join(featureDir, "spec.md");
  if (!fs.existsSync(featureDir)) {
    throw new Error(`Feature directory not found: ${featureDir}`);
  }

  let specCreatedAtStr = new Date().toISOString();
  if (fs.existsSync(specPath)) {
    const stats = fs.statSync(specPath);
    // Use birthtime if available, otherwise fallback to mtime
    const birthTime =
      stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
    specCreatedAtStr = birthTime.toISOString();
  }

  // extract timestamps from git
  let gitLogOut = "";
  try {
    const parentDir = path.dirname(featureDir);
    // Use git log on the exact feature directory
    // %aI = author date strict ISO 8601
    gitLogOut = execFileSync(
      "git",
      ["log", "--reverse", "--format=%aI", "--", featureDir],
      {
        cwd: parentDir,
        encoding: "utf-8",
      },
    )
      .toString()
      .trim();
  } catch (err) {
    // maybe no commits yet
  }

  const lines = gitLogOut
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    throw new Error(
      `No implementation commits found for feature '${path.basename(featureDir)}'`,
    );
  }

  // Parse commit timestamps and sort chronologically
  const timestamps = lines
    .map((l) => new Date(l).getTime())
    .sort((a, b) => a - b);

  if (timestamps.length === 0) {
    throw new Error(
      `No valid timestamps found for feature '${path.basename(featureDir)}'`,
    );
  }

  const firstTimestamp = timestamps[0] as number;
  const lastTimestamp = timestamps[timestamps.length - 1] as number;

  const firstImplCommit = new Date(firstTimestamp).toISOString();
  const lastImplCommit = new Date(lastTimestamp).toISOString();

  // Clustering using the new utility
  const clusters = clusterCommits(timestamps, sessionGapMinutes);
  const sessionCount = clusters.length;
  const activeCodingMinutes = clusters.reduce(
    (sum, c) => sum + c.durationMinutes,
    0,
  );

  const specCreatedTime = new Date(specCreatedAtStr).getTime();
  const firstImplTime = firstTimestamp;

  let dormancyDays = (firstImplTime - specCreatedTime) / (1000 * 60 * 60 * 24);
  if (dormancyDays < 0) dormancyDays = 0;

  // Attempt to get PR merge time, fallback to last commit
  let prMergedAtStr = lastImplCommit;
  try {
    const parentDir = path.dirname(featureDir);
    const args = ["pr", "view", "--json", "mergedAt", "--jq", ".mergedAt"];
    if (prNumber) {
      args.splice(2, 0, String(prNumber));
    }

    const ghOut = execFileSync("gh", args, {
      cwd: parentDir,
      encoding: "utf-8",
    })
      .toString()
      .trim();
    if (ghOut && ghOut !== "null") {
      prMergedAtStr = ghOut;
    }
  } catch (err) {
    // degraded state is totally fine, fallback is lastImplCommit
  }

  const firstCommitDate = new Date(firstImplCommit);
  const finishDate = new Date(prMergedAtStr);
  let deliveryWindowHours =
    (finishDate.getTime() - firstCommitDate.getTime()) / (1000 * 60 * 60);
  if (deliveryWindowHours < 0.1) deliveryWindowHours = 0.1;

  return {
    specCreatedAt: specCreatedAtStr,
    firstImplCommit,
    lastImplCommit,
    prMergedAt: prMergedAtStr,
    dormancyDays: Math.floor(dormancyDays),
    activeCodingMinutes,
    sessionCount,
    deliveryWindowHours,
    clusters,
  };
}
