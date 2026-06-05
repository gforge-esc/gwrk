import { execFileSync } from "node:child_process";
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
  // We count all unique tasks (T### or US###) that have any history for this feature.
  // We count how many distinct feature-attempts (runs) each task was worked on.
  const taskStats = db
    .prepare(
      `
    WITH project_info AS (SELECT ? as pid)
    SELECT
      task_id,
      COUNT(DISTINCT attempt_num) as attempts,
      MIN(attempt_num) as first_attempt,
      MAX(is_completed) as is_completed
    FROM (
      SELECT
        h.task_id,
        CASE WHEN h.to_status = 'completed' THEN 1 ELSE 0 END as is_completed,
        COALESCE(
          (SELECT attempt FROM runs WHERE id = h.run_id),
          (
            SELECT COUNT(*)
            FROM runs r, project_info pi
            WHERE r.feature_id = h.feature_id
              AND (r.project_id = pi.pid OR r.project_id IS NULL OR r.project_id = '')
              AND r.command IN ('implement', 'ship')
              AND r.started_at <= h.timestamp
          )
        ) as attempt_num
      FROM history h, project_info pi
      WHERE h.feature_id = ?
        AND (h.project_id = pi.pid OR h.project_id IS NULL OR h.project_id = '')
        AND (h.task_id LIKE 'T%' OR h.task_id LIKE 'US%')
    )
    WHERE task_id GLOB 'T[0-9][0-9][0-9]' OR task_id GLOB 'US-[0-9]*'
    GROUP BY task_id
  `,
    )
    .all(projectId, featureId) as {
    task_id: string;
    attempts: number;
    first_attempt: number;
    is_completed: number;
  }[];

  // Load total tasks from tasks.json or spec.md if available to get an accurate denominator (FR-014)
  let totalTasksExpected = 0;
  const featureDir = path.join(process.cwd(), "specs", featureId);
  try {
    const tasksJsonPath = path.join(featureDir, ".gwrk", "tasks.json");
    if (fs.existsSync(tasksJsonPath)) {
      const tasksJson = JSON.parse(fs.readFileSync(tasksJsonPath, "utf-8"));
      totalTasksExpected = tasksJson.phases.reduce(
        (sum: number, p: any) => sum + (p.tasks?.length || 0),
        0,
      );
    } else {
      // Fallback: count US-### blocks in spec.md
      const specPath = path.join(featureDir, "spec.md");
      if (fs.existsSync(specPath)) {
        const content = fs.readFileSync(specPath, "utf-8");
        const matches = content.match(/^#{2,4}\s+US-\d+[a-z]?/gim);
        if (matches) totalTasksExpected = matches.length;
      }
    }
  } catch {
    /* ignore */
  }

  const taskCount = Math.max(taskStats.length, totalTasksExpected);
  let firstPassRate = 0;
  let avgAttempts = 0;

  if (taskCount > 0) {
    // First-pass: completed in the very first attempt of the feature (attempt_num=1)
    const firstPassTasks = taskStats.filter(
      (t) => t.first_attempt === 1 && t.attempts === 1 && t.is_completed === 1,
    ).length;
    firstPassRate = (firstPassTasks / taskCount) * 100;
    
    const attemptedCount = taskStats.length;
    avgAttempts = attemptedCount > 0 
      ? taskStats.reduce((sum, t) => sum + t.attempts, 0) / attemptedCount
      : 0;
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
    WHERE feature_id = ? AND (project_id = ? OR project_id IS NULL OR project_id = '')
  `,
    )
    .get(featureId, projectId) as { total_lines: number | null; total_files: number | null };

  let totalLines = runStats?.total_lines || 0;
  let totalFiles = runStats?.total_files || 0;

  // Fallback to Git if DB stats are missing (common for old runs)
  if (totalLines === 0 || totalFiles === 0) {
    try {
      if (fs.existsSync(featureDir)) {
        // Use git log --numstat to get churn for the feature directory
        const gitOut = execFileSync(
          "git",
          ["log", "--numstat", "--format=", "--", featureDir],
          { encoding: "utf-8" },
        );
        const lines = gitOut.split("\n").filter(Boolean);
        const uniqueFiles = new Set<string>();
        let gitLines = 0;

        for (const line of lines) {
          const [added, deleted, file] = line.split("\t");
          if (added && deleted && file) {
            if (added !== "-" && deleted !== "-") {
              gitLines += parseInt(added, 10) + parseInt(deleted, 10);
            }
            uniqueFiles.add(file);
          }
        }
        if (totalLines === 0) totalLines = gitLines;
        if (totalFiles === 0) totalFiles = uniqueFiles.size;
      }
    } catch {
      /* ignore git errors */
    }
  }

  const spCount = forecast.totalSP || 1;

  // Tool calls: Heuristic count from agent log files
  let toolCalls = 0;
  const countInDir = (dir: string, regex?: RegExp) => {
    if (fs.existsSync(dir)) {
      const logs = fs
        .readdirSync(dir)
        .filter((f) => (regex ? regex.test(f) : true) && f.endsWith(".log"));
      for (const logFile of logs) {
        try {
          const content = fs.readFileSync(path.join(dir, logFile), "utf-8");
          // Match tool calls: [timestamp] $ tool_name OR [timestamp] > tool_name
          const matches = content.match(/^\[.*\]\s+[\$>]\s+\w+/gm);
          if (matches) toolCalls += matches.length;
        } catch { /* ignore */ }
      }
    }
  };


  try {
    // 1. Check active runs dir
    const runsDir = path.join(process.cwd(), ".runs");
    const featureRegex = new RegExp(`(^|[-])${featureId}([-]|\\.)`);
    countInDir(runsDir, featureRegex);

    // 2. Check harvested logs dir
    const harvestedDir = path.join(process.cwd(), "specs", featureId, ".gwrk", "runs");
    countInDir(harvestedDir);
  } catch {
    // Non-fatal
  }

  // 3. Spec Quality
  const contractCount = fs.existsSync(path.join(featureDir, "contracts"))
    ? fs
        .readdirSync(path.join(featureDir, "contracts"))
        .filter((f) => f.endsWith(".md") && !f.startsWith("README")).length
    : 0;
  const gateCount = fs.existsSync(path.join(featureDir, "gates"))
    ? fs
        .readdirSync(path.join(featureDir, "gates"))
        .filter((f) => f.startsWith("T") && f.endsWith("-gate.sh")).length
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

