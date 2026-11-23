/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import type Database from "better-sqlite3";
import { recordGateResult } from "../db/gates.js";
import { type TaskGateResult, runTaskGate } from "../utils/gate-exec.js";
import { resolveProjectId } from "../utils/project-id.js";
import {
  type TaskState,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";

export interface ReconcileResult {
  passed: number;
  failed: number;
  total: number;
  failedTaskIds: string[];
}

export interface ReconcileGateOptions {
  projectId?: string;
  db?: Database.Database;
  updateLocalTaskState?: boolean;
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
  options: ReconcileGateOptions = {},
  env?: NodeJS.ProcessEnv,
): Promise<ReconcileResult> {
  const featureDir = path.join(projectPath, "specs", featureId);
  const projectId = options.projectId ?? resolveProjectId(projectPath);

  let taskState: TaskState;
  try {
    taskState = loadTaskState(featureDir);
  } catch {
    // No tasks.json — nothing to reconcile
    return { passed: 0, failed: 0, total: 0, failedTaskIds: [] };
  }

  const targetPhases = phaseId
    ? taskState.phases.filter((p) => p.id === phaseId)
    : taskState.phases;

  let passed = 0;
  let failed = 0;
  let total = 0;
  const failedTaskIds: string[] = [];

  // 026: a fenced Done-When compiles the SAME gateScript onto every task in a
  // phase. Run each distinct gate once so a Docker integration gate (e.g.
  // `make test:db`) is not re-run per task post-merge.
  const gateCache = new Map<string, TaskGateResult>();

  for (const phase of targetPhases) {
    for (const task of phase.tasks) {
      // Skip cancelled tasks
      if (task.status === "cancelled") {
        total++;
        continue;
      }

      total++;
      // 026: verify through the shared gate runner (inline-capable, cwd-pinned)
      // so harvest's "done-done" evidence matches `gwrk gate` and ship. The old
      // path-only `runGate(join(featureDir, gateScript))` recorded ENOENT/127
      // false-FAILs for every inline gate.
      let gateResult = gateCache.get(task.gateScript);
      if (!gateResult) {
        gateResult = await runTaskGate(task, {
          featureDir,
          cwd: projectPath,
          env,
        });
        gateCache.set(task.gateScript, gateResult);
      }

      // Record evidence to SQLite (survives tasks.json regeneration)
      const gateEvidence = {
        feature_id: featureId,
        phase_id: phase.id,
        task_id: task.id,
        gate_script: task.gateScript,
        passed: gateResult.passed ? 1 : 0,
        exit_code: gateResult.exitCode,
        output: gateResult.output.slice(0, 2000), // Truncate for storage
      };
      if (options.db) {
        recordGateResult(gateEvidence, projectId, options.db);
      } else {
        recordGateResult(gateEvidence, projectId);
      }

      if (gateResult.passed) {
        passed++;
        if (
          options.updateLocalTaskState !== false &&
          task.status !== "completed"
        ) {
          task.status = "completed";
          task.completedAt = new Date().toISOString();
        }
      } else {
        failed++;
        failedTaskIds.push(task.id);
        // Don't reopen completed tasks — gate may have regressed
        // but we don't want to lose "done" state from a flaky gate
      }
    }
  }

  // Save updated task state
  if (options.updateLocalTaskState !== false)
    saveTaskState(featureDir, taskState);

  return { passed, failed, total, failedTaskIds };
}
