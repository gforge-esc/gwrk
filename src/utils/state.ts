import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const TaskStatusSchema = z.enum([
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

export const TaskSchema = z.object({
  id: z.string().regex(/^T\d{3}$/),
  title: z.string().min(1),
  description: z.string(),
  status: TaskStatusSchema,
  gateScript: z.string(),
  sp: z.number().int().nonnegative().default(0),
  completedAt: z
    .string()
    .datetime()
    .optional()
    .nullable()
    .transform((v) => v ?? undefined),
  classification: z
    .enum(["greenfield", "change", "refactor", "noop"])
    .optional(),
});

export const PhaseSchema = z.object({
  id: z.string().regex(/^phase-\d{2}$/),
  title: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
  sp_estimate: z.number().int().nonnegative().default(0),
  doneWhen: z.array(z.string()).optional(),
  // New optional fields (Phase 3.4)
  objective: z.string().optional(),
  scope: z
    .object({
      in_scope: z.array(z.string()),
      out_of_scope: z.array(z.string()),
    })
    .optional(),
  classification_summary: z.record(z.number()).optional(),
  inputs: z
    .object({
      spec_refs: z.array(z.string()),
      project_signals: z.array(z.string()),
    })
    .optional(),
});

const SourceProvenanceSchema = z.object({
  hash: z.string(),
  modifiedAt: z.string().datetime(),
});

export const TaskStateSchema = z.object({
  featureId: z.string().min(1),
  createdAt: z.string().datetime(),
  generatedFrom: z
    .object({
      plan: SourceProvenanceSchema,
    })
    .optional(),
  phases: z.array(PhaseSchema).min(1),
});

export type Task = z.infer<typeof TaskSchema>;
export type Phase = z.infer<typeof PhaseSchema>;
export type TaskState = z.infer<typeof TaskStateSchema>;

/**
 * Common LLM status hallucinations → valid Zod enum values.
 * Review/UAT agents frequently write non-schema status values.
 * Rather than crash, we coerce and warn.
 */
const STATUS_COERCION_MAP: Record<string, string> = {
  todo: "open",
  pending: "open",
  not_started: "open",
  blocked: "open",
  wip: "in_progress",
  working: "in_progress",
  active: "in_progress",
  done: "completed",
  finished: "completed",
  complete: "completed",
  passed: "completed",
  skipped: "cancelled",
  removed: "cancelled",
};

const VALID_STATUSES = new Set([
  "open",
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Sanitize task statuses in raw JSON before Zod validation.
 * Coerces common LLM hallucinations to valid enum values.
 * Returns the number of coercions performed.
 */
function sanitizeTaskStatuses(raw: Record<string, unknown>): number {
  let coerced = 0;
  const phases = raw.phases;
  if (!Array.isArray(phases)) return 0;

  for (const phase of phases) {
    if (!phase || typeof phase !== "object") continue;
    const tasks = (phase as Record<string, unknown>).tasks;
    if (!Array.isArray(tasks)) continue;

    for (const task of tasks) {
      if (!task || typeof task !== "object") continue;
      const t = task as Record<string, unknown>;
      const status = t.status;
      if (typeof status !== "string") continue;

      if (!VALID_STATUSES.has(status)) {
        const coercedStatus =
          STATUS_COERCION_MAP[status.toLowerCase()] ?? "open";
        console.warn(
          `  ⚠ task ${t.id ?? "?"}: coerced invalid status "${status}" → "${coercedStatus}"`,
        );
        t.status = coercedStatus;
        coerced++;
      }
    }
  }
  return coerced;
}

export function loadTaskState(featureDir: string): TaskState {
  const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");

  if (!fs.existsSync(tasksPath)) {
    throw new Error(`Task state file not found at ${tasksPath}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
  } catch (error) {
    console.error(`Task state error in ${tasksPath}: invalid JSON`);
    process.exit(1);
  }

  // Sanitize LLM-hallucinated status values before Zod validation
  const coerced = sanitizeTaskStatuses(raw as Record<string, unknown>);
  if (coerced > 0) {
    console.warn(
      `  ⚠ ${coerced} invalid task status(es) coerced in ${tasksPath}`,
    );
    // Write the sanitized version back to prevent re-coercion on next load
    const tempPath = `${tasksPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(raw, null, 2), "utf-8");
    fs.renameSync(tempPath, tasksPath);
  }

  const result = TaskStateSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Task state error in ${tasksPath}: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}

export function saveTaskState(featureDir: string, state: TaskState): void {
  // SP Additivity Invariant Check
  for (const phase of state.phases) {
    const taskSum = phase.tasks.reduce((sum, t) => sum + (t.sp || 0), 0);
    if (phase.sp_estimate > 0 && phase.sp_estimate !== taskSum) {
      throw new Error(
        `SP Invariant Violation in ${phase.id}: phase.sp_estimate (${phase.sp_estimate}) != sum(tasks.sp) (${taskSum})`,
      );
    }
  }

  const gwrkDir = path.join(featureDir, ".gwrk");
  if (!fs.existsSync(gwrkDir)) {
    fs.mkdirSync(gwrkDir, { recursive: true });
  }

  const tasksPath = path.join(gwrkDir, "tasks.json");
  const result = TaskStateSchema.safeParse(state);
  if (!result.success) {
    console.error(`Invalid task state: ${result.error.message}`);
    process.exit(1);
  }

  // Atomic write via temp file
  const tempPath = `${tasksPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(state, null, 2), "utf-8");
  fs.renameSync(tempPath, tasksPath);
}

export function markTaskComplete(state: TaskState, taskId: string): TaskState {
  const newState: TaskState = JSON.parse(JSON.stringify(state));
  let found = false;

  for (const phase of newState.phases) {
    const task = phase.tasks.find((t) => t.id === taskId);
    if (task) {
      if (task.status === "completed") {
        throw new Error(`Task ${taskId} already completed`);
      }
      task.status = "completed";
      task.completedAt = new Date().toISOString();
      found = true;
      break;
    }
  }

  if (!found) {
    throw new Error(`Task ${taskId} not found in tasks.json`);
  }

  return newState;
}

export function listTasks(state: TaskState): Task[] {
  return state.phases.flatMap((phase) => phase.tasks);
}

export function nextTask(state: TaskState, phaseId: string): Task | null {
  const phase = state.phases.find((p) => p.id === phaseId);
  if (!phase) {
    return null;
  }
  return phase.tasks.find((t) => t.status === "open") || null;
}

/** SHA256 of file contents — used for provenance tracking */
export function contentHash(filePath: string): string {
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(content).digest("hex");
}
