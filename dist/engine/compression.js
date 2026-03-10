import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
/** ... existing exports ... */
export function computeCompression(forecast, actuals) {
    // Point Compression = Estimated Coding Hours / Actual Coding Time (hours)
    const actualHours = actuals.activeCodingMinutes / 60;
    const pointCompression = actualHours > 0
        ? forecast.estimatedHours / actualHours
        : Number.POSITIVE_INFINITY;
    // Total Compression = Estimated Elapsed Days / Actual Elapsed Days
    const actualDays = actuals.deliveryWindowHours / 24;
    const totalCompression = actualDays > 0
        ? forecast.estimatedDays / actualDays
        : Number.POSITIVE_INFINITY;
    return {
        pointCompression,
        totalCompression,
        dormancyDays: actuals.dormancyDays,
    };
}
export function generateSummary(reports) {
    const summary = {
        projectName: "Unknown", // Can be overridden
        generatedAt: new Date().toISOString(),
        features: reports,
        totals: {
            totalSP: 0,
            totalEstimatedHours: 0,
            totalActualCodingHours: 0,
            avgPointCompression: 0,
            avgTotalCompression: 0,
        },
        best: { featureId: "", pointCompression: 0 },
        worst: { featureId: "", pointCompression: Number.POSITIVE_INFINITY },
        trend: "stable",
    };
    if (reports.length === 0)
        return summary;
    let totalPointCompression = 0;
    let totalTotalCompression = 0;
    for (const r of reports) {
        summary.totals.totalSP += r.forecast.totalSP;
        summary.totals.totalEstimatedHours += r.forecast.estimatedHours;
        summary.totals.totalActualCodingHours += r.actuals.activeCodingMinutes / 60;
        totalPointCompression += r.compression.pointCompression;
        totalTotalCompression += r.compression.totalCompression;
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
    summary.totals.avgPointCompression = totalPointCompression / reports.length;
    summary.totals.avgTotalCompression = totalTotalCompression / reports.length;
    const sorted = [...reports].sort((a, b) => new Date(a.actuals.firstImplCommit).getTime() -
        new Date(b.actuals.firstImplCommit).getTime());
    if (sorted.length > 1) {
        const mid = Math.floor(sorted.length / 2);
        const firstHalf = sorted.slice(0, mid);
        const secondHalf = sorted.slice(mid);
        const firstHalfAvg = firstHalf.reduce((sum, r) => sum + r.compression.pointCompression, 0) /
            firstHalf.length;
        const secondHalfAvg = secondHalf.reduce((sum, r) => sum + r.compression.pointCompression, 0) /
            secondHalf.length;
        if (secondHalfAvg > firstHalfAvg * 1.05) {
            summary.trend = "improving";
        }
        else if (secondHalfAvg < firstHalfAvg * 0.95) {
            summary.trend = "declining";
        }
    }
    return summary;
}
/**
 * Gathers delivery actuals securely from the filesystem and git.
 */
export function gatherDeliveryActuals(featureDir, sessionGapMinutes = 30) {
    const specPath = path.join(featureDir, "spec.md");
    if (!fs.existsSync(featureDir)) {
        throw new Error(`Feature directory not found: ${featureDir}`);
    }
    let specCreatedAtStr = new Date().toISOString();
    if (fs.existsSync(specPath)) {
        const stats = fs.statSync(specPath);
        // Use birthtime if available, otherwise fallback to mtime
        const birthTime = stats.birthtime.getTime() > 0 ? stats.birthtime : stats.mtime;
        specCreatedAtStr = birthTime.toISOString();
    }
    // extract timestamps from git
    let gitLogOut = "";
    try {
        const parentDir = path.dirname(featureDir);
        // Use git log on the exact feature directory
        // %aI = author date strict ISO 8601
        gitLogOut = execFileSync("git", ["log", "--reverse", "--format=%aI", "--", featureDir], {
            cwd: parentDir,
            encoding: "utf-8",
        })
            .toString()
            .trim();
    }
    catch (err) {
        // maybe no commits yet
    }
    const lines = gitLogOut
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        throw new Error(`No implementation commits found for feature '${path.basename(featureDir)}'`);
    }
    // Parse commit timestamps and sort chronologically
    const timestamps = lines
        .map((l) => new Date(l).getTime())
        .sort((a, b) => a - b);
    if (timestamps.length === 0) {
        throw new Error(`No valid timestamps found for feature '${path.basename(featureDir)}'`);
    }
    const firstTimestamp = timestamps[0];
    const lastTimestamp = timestamps[timestamps.length - 1];
    const firstImplCommit = new Date(firstTimestamp).toISOString();
    const lastImplCommit = new Date(lastTimestamp).toISOString();
    // Clustering
    let sessionCount = 0;
    let activeCodingMinutes = 0;
    const gapMs = sessionGapMinutes * 60 * 1000;
    if (timestamps.length === 1) {
        sessionCount = 1;
        // single commit heuristics: count as minimum 5 minutes
        activeCodingMinutes = 5;
    }
    else {
        let currentSessionStart = firstTimestamp;
        let currentSessionEnd = firstTimestamp;
        sessionCount = 1;
        for (let i = 1; i < timestamps.length; i++) {
            const ts = timestamps[i];
            const diff = ts - currentSessionEnd;
            if (diff > gapMs) {
                // Gap exceeded. Close current session.
                const sessionDuration = (currentSessionEnd - currentSessionStart) / (1000 * 60);
                // Minimum session duration of 5 minutes for single-isolated commits ending a session immediately
                activeCodingMinutes += Math.max(sessionDuration, 5);
                // Start new session
                sessionCount++;
                currentSessionStart = ts;
                currentSessionEnd = ts;
            }
            else {
                // Extend current session
                currentSessionEnd = ts;
            }
        }
        // Close final session
        const finalSessionDuration = (currentSessionEnd - currentSessionStart) / (1000 * 60);
        activeCodingMinutes += Math.max(finalSessionDuration, 5);
    }
    const specCreatedTime = new Date(specCreatedAtStr).getTime();
    const firstImplTime = firstTimestamp;
    let dormancyDays = (firstImplTime - specCreatedTime) / (1000 * 60 * 60 * 24);
    if (dormancyDays < 0)
        dormancyDays = 0;
    // Attempt to get PR merge time, fallback to last commit
    let prMergedAtStr = lastImplCommit;
    try {
        const parentDir = path.dirname(featureDir);
        const ghOut = execFileSync("gh", ["pr", "view", "--json", "mergedAt", "--jq", ".mergedAt"], {
            cwd: parentDir,
            encoding: "utf-8",
        })
            .toString()
            .trim();
        if (ghOut && ghOut !== "null") {
            prMergedAtStr = ghOut;
        }
    }
    catch (err) {
        // degraded state is totally fine, fallback is lastImplCommit
    }
    const firstCommitDate = new Date(firstImplCommit);
    const finishDate = new Date(prMergedAtStr);
    let deliveryWindowHours = (finishDate.getTime() - firstCommitDate.getTime()) / (1000 * 60 * 60);
    if (deliveryWindowHours < 0.1)
        deliveryWindowHours = 0.1;
    return {
        specCreatedAt: specCreatedAtStr,
        firstImplCommit,
        lastImplCommit,
        prMergedAt: prMergedAtStr,
        dormancyDays: Math.floor(dormancyDays),
        activeCodingMinutes,
        sessionCount,
        deliveryWindowHours,
    };
}
