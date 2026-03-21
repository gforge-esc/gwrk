import fs from "node:fs";
import path from "node:path";
import { commitFiles } from "../utils/git.js";

export interface LogEntry {
  runId: string | number;
  phase?: string;
  agent?: string;
  timestamp: string;
  size: number;
  file: string;
}

export interface LogIndex {
  featureId: string;
  logs: LogEntry[];
}

/**
 * Finalizes logs for a feature: indexes them and commits to git.
 * (FR-H02)
 */
export async function finalizeLogs(
  featureId: string,
  projectPath: string,
): Promise<void> {
  const runsDir = path.join("specs", featureId, ".gwrk", "runs");
  const fullRunsDir = path.join(projectPath, runsDir);
  
  if (!fs.existsSync(fullRunsDir)) return;

  const indexPath = path.join(fullRunsDir, "index.json");
  let index: LogIndex = { featureId, logs: [] };

  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch (_e) {
      // Re-create if corrupt
    }
  }

  const files = fs.readdirSync(fullRunsDir).filter((f) => f.endsWith(".log"));
  const stagedFiles: string[] = [];

  for (const file of files) {
    const filePath = path.join(runsDir, file);
    const fullPath = path.join(fullRunsDir, file);
    
    // Always add all log files to git stage to be sure they are tracked
    stagedFiles.push(filePath);

    if (index.logs.some((l) => l.file === file)) continue;

    const stats = fs.statSync(fullPath);
    
    // Attempt to extract metadata from filename
    // Expected format: <timestamp>-<runId>-<phase>-<agent>.log
    const nameParts = file.replace(".log", "").split("-");
    const entry: LogEntry = {
      timestamp: nameParts[0] || new Date(stats.mtime).toISOString(),
      runId: nameParts[1] || "unknown",
      phase: nameParts[2] || "unknown",
      agent: nameParts[3] || "unknown",
      size: stats.size,
      file,
    };

    index.logs.push(entry);
  }

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  stagedFiles.push(path.join(runsDir, "index.json"));

  commitFiles(
    projectPath,
    stagedFiles,
    `harvest: finalize logs for ${featureId}`
  );
}
