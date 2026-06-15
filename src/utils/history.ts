import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { recordHistory } from "../db/runs.js";

const HistoryEntrySchema = z.object({
  timestamp: z.string().datetime(),
  featureId: z.string().min(1),
  taskId: z.string().regex(/^T\d{3}$/),
  fromStatus: z.enum(["open", "in_progress", "completed", "cancelled"]),
  toStatus: z.enum(["open", "in_progress", "completed", "cancelled"]),
  agentId: z.string().optional(),
  runId: z.number().optional(),
  projectId: z.string().optional(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

export function appendHistory(entry: HistoryEntry): void {
  // FR-021: history.jsonl is deprecated.
  // Writes are redirected to SQLite DB + Execution Manifests (handled by commands).

  // Write to SQLite DB
  try {
    recordHistory({
      project_id: entry.projectId,
      feature_id: entry.featureId,
      task_id: entry.taskId,
      from_status: entry.fromStatus,
      to_status: entry.toStatus,
      run_id: entry.runId,
      metadata: entry.agentId
        ? JSON.stringify({ agentId: entry.agentId })
        : undefined,
    });
  } catch (error) {
    console.warn(`Warning: Could not record history in DB: ${error}`);
  }
}
