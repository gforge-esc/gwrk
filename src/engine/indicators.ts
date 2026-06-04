import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db/index.js";
import type { EffortForecast, LeadingIndicators } from "./types.js";

/**
 * Computes leading indicators for a feature.
 * Convergence: First-pass rate and Avg attempts per task.
 * Density: Lines/SP, Files/SP, Tool Calls/SP.
 * Spec Quality: Contract count and Gate count.
 * (FR-014)
 */
export function computeLeadingIndicators(
  featureId: string,
  forecast: EffortForecast,
  projectId: string,
): LeadingIndicators {
  const db = getDb();

  // 1. Convergence
  // We estimate attempts per task by counting how many runs started before the task was completed.
  // We group by task_id to handle potential regressions and multiple 'completed' events.
  const taskStats = db
    .prepare(
      `
    SELECT
      task_id,
      MAX(attempts) as attempts
    FROM (
      SELECT
        h.task_id,
        (
          SELECT COUNT(*)
          FROM runs r
          WHERE r.feature_id = h.feature_id
            AND r.project_id = h.project_id
            AND r.phase_id = (SELECT phase_id FROM runs WHERE id = h.run_id)
            AND r.command IN ('implement', 'ship')
            AND r.started_at <= h.timestamp
        ) as attempts
      FROM history h
      WHERE h.feature_id = ?
        AND h.project_id = ?
        AND h.to_status = 'completed'
        AND (h.task_id LIKE 'T%' OR h.task_id LIKE 'US%')
    )
    GROUP BY task_id
  `,
    )
    .all(featureId, projectId) as { task_id: string; attempts: number }[];

  const taskCount = taskStats.length || 0;
  let firstPassRate = 0;
  let avgAttempts = 0;

  if (taskCount > 0) {
    const firstPassTasks = taskStats.filter((t) => t.attempts === 1).length;
    firstPassRate = (firstPassTasks / taskCount) * 100;
    avgAttempts = taskStats.reduce((sum, t) => sum + t.attempts, 0) / taskCount;
  }

  // 2. Density
  // Aggregate stats from the runs table for this feature.
  const runStats = db
    .prepare(
      `
    SELECT 
      SUM(COALESCE(lines_added, 0) + COALESCE(lines_deleted, 0)) as total_lines, 
      SUM(COALESCE(files_changed, 0)) as total_files
    FROM runs
    WHERE feature_id = ? AND project_id = ? AND exit_code = 0
  `,
    )
    .get(featureId, projectId) as { total_lines: number | null; total_files: number | null };

  const totalLines = runStats?.total_lines || 0;
  const totalFiles = runStats?.total_files || 0;
  const spCount = forecast.totalSP || 1;

  // Tool calls: Heuristic count from agent log files if available
  let toolCalls = 0;
  try {
    const runsDir = path.join(process.cwd(), ".runs");
    if (fs.existsSync(runsDir)) {
      const featureRegex = new RegExp(`(^|[-])${featureId}([-]|\\.)`);
      const logs = fs
        .readdirSync(runsDir)
        .filter((f) => featureRegex.test(f) && f.endsWith(".log"));
      for (const logFile of logs) {
        const content = fs.readFileSync(path.join(runsDir, logFile), "utf-8");
        // Count lines that look like tool calls (e.g., "[12:34:56 +00:01]  $ git ...")
        const matches = content.match(/^\[.*\]\s+\$ /gm);
        if (matches) toolCalls += matches.length;
      }
    }
  } catch {
    // Non-fatal
  }

  // 3. Spec Quality
  const featureDir = path.join(process.cwd(), "specs", featureId);
  const contractCount = fs.existsSync(path.join(featureDir, "contracts"))
    ? fs
        .readdirSync(path.join(featureDir, "contracts"))
        .filter((f) => f.endsWith(".md")).length
    : 0;
  const gateCount = fs.existsSync(path.join(featureDir, "gates"))
    ? fs
        .readdirSync(path.join(featureDir, "gates"))
        .filter((f) => f.endsWith(".sh")).length
    : 0;

  return {
    convergence: {
      firstPassRate: Math.round(firstPassRate),
      avgAttempts: Number(avgAttempts.toFixed(2)),
    },
    density: {
      linesPerSP: Number((totalLines / spCount).toFixed(2)),
      filesPerSP: Number((totalFiles / spCount).toFixed(2)),
      toolCallsPerSP: Number((toolCalls / spCount).toFixed(2)),
    },
    specQuality: {
      contractCount,
      gateCount,
    },
  };
}
