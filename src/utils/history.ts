import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { recordHistory } from "../db/runs.js";

export const HistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),
  featureId: z.string().min(1),
  taskId: z.string().regex(/^T\d{3}$/),
  fromStatus: z.enum(["open", "in_progress", "completed"]),
  toStatus: z.enum(["open", "in_progress", "completed"]),
  agentId: z.string().optional(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export function appendHistory(entry: HistoryEntry): void {
  const historyPath = path.join(".gwrk", "history.jsonl");
  const gwrkDir = path.dirname(historyPath);

  if (!fs.existsSync(gwrkDir)) {
    fs.mkdirSync(gwrkDir, { recursive: true });
  }

  const result = HistoryEntrySchema.safeParse(entry);
  if (!result.success) {
    console.error(`Invalid history entry: ${result.error.message}`);
    process.exit(1);
  }

  // Write to legacy JSONL
  const line = `${JSON.stringify(entry)}\n`;
  fs.appendFileSync(historyPath, line, "utf-8");

  // Write to SQLite DB
  try {
    recordHistory({
      feature_id: entry.featureId,
      task_id: entry.taskId,
      from_status: entry.fromStatus,
      to_status: entry.toStatus,
      metadata: entry.agentId ? JSON.stringify({ agentId: entry.agentId }) : undefined,
    });
  } catch (error) {
    console.warn(`Warning: Could not record history in DB: ${error}`);
  }
}
