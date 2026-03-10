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
  completedAt: z.string().datetime().optional(),
});

export const PhaseSchema = z.object({
  id: z.string().regex(/^phase-\d{2}$/),
  title: z.string().min(1),
  tasks: z.array(TaskSchema).min(1),
  doneWhen: z.array(z.string()).optional(),
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

export function loadTaskState(featureDir: string): TaskState {
  const tasksPath = path.join(featureDir, ".gwrk", "tasks.json");

  if (!fs.existsSync(tasksPath)) {
    console.error(`Task state file not found at ${tasksPath}`);
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
  } catch (error) {
    console.error(`Task state error in ${tasksPath}: invalid JSON`);
    process.exit(1);
  }

  const result = TaskStateSchema.safeParse(raw);
  if (!result.success) {
    console.error(`Task state error in ${tasksPath}: ${result.error.message}`);
    process.exit(1);
  }

  return result.data;
}

export function saveTaskState(featureDir: string, state: TaskState): void {
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
