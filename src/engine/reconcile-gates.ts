import path from "node:path";
import { recordGateResult } from "../db/gates.js";
import { resolveProjectId } from "../utils/project-id.js";
import { runGate } from "../utils/gate-runner.js";
import {
  type TaskState,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";

export interface ReconcileResult {
  passed: number;
  failed: number;
  total: number;
}

/**
 * Run gates for a feature phase, record evidence to SQLite, and
 * reconcile tasks.json completion state.
 *
 * This is the "done done" mechanism: gates are the truth,
 * tasks.json status is derived, SQLite is the evidence.
 */
export async function reconcileGates(
  projectPath: string,
  featureId: string,
  phaseId?: string,
): Promise<ReconcileResult> {
  const featureDir = path.join(projectPath, "specs", featureId);
  const projectId = resolveProjectId(projectPath);

  let taskState: TaskState;
  try {
    taskState = loadTaskState(featureDir);
  } catch {
    // No tasks.json — nothing to reconcile
    return { passed: 0, failed: 0, total: 0 };
  }

  const targetPhases = phaseId
    ? taskState.phases.filter((p) => p.id === phaseId)
    : taskState.phases;

  let passed = 0;
  let failed = 0;
  let total = 0;

  for (const phase of targetPhases) {
    for (const task of phase.tasks) {
      // Skip cancelled tasks
      if (task.status === "cancelled") {
        total++;
        continue;
      }

      total++;
      const gatePath = path.join(featureDir, task.gateScript);

      const gateResult = await runGate(gatePath);

      // Record evidence to SQLite (survives tasks.json regeneration)
      recordGateResult(
        {
          feature_id: featureId,
          phase_id: phase.id,
          task_id: task.id,
          gate_script: task.gateScript,
          passed: gateResult.passed ? 1 : 0,
          exit_code: gateResult.exitCode,
          output: gateResult.output.slice(0, 2000), // Truncate for storage
        },
        projectId,
      );

      if (gateResult.passed) {
        passed++;
        if (task.status !== "completed") {
          task.status = "completed";
          task.completedAt = new Date().toISOString();
        }
      } else {
        failed++;
        // Don't reopen completed tasks — gate may have regressed
        // but we don't want to lose "done" state from a flaky gate
      }
    }
  }

  // Save updated task state
  saveTaskState(featureDir, taskState);

  return { passed, failed, total };
}
