/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Regenerating tasks.json must not destroy what has already shipped.
 *
 * `planToTasks` loaded the existing tasks.json only under `options.reconcile`,
 * so a plain `gwrk define tasks` regenerated every task at `status: "open"`.
 * That is not a cosmetic loss: `gwrk ship <feature>` with no phase argument
 * selects phases from tasks.json, so an open status reads as unshipped work.
 *
 * On 005-dashboard-api it made phases 02–05 — merged weeks earlier, and SHIPPED
 * in the plan graph — look unbuilt. The next run announced six phases and spent
 * ~20 minutes re-implementing phase 02, producing a PR with zero source
 * changes, and would have spent another hour on 03–05.
 *
 * Two behaviours were bundled behind `reconcile`. Preserving the status of a
 * task that still exists is not reconciliation and is now unconditional;
 * carrying a task that plan.md no longer mentions forward as `cancelled` is,
 * and stays opt-in.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { planToTasks } from "./plan-to-tasks.js";

const PLAN = `# Plan

### Phase 1: Persistence

**Files:**
- \`src/lib/db/cdo.js\` (NEW: cdo-push persistence)

### Phase 2: Read routes

**Files:**
- \`src/app/api/v1/readings/route.js\` (NEW: readings route)
`;

/**
 * plan.md with Phase 2's file replaced by one with a DIFFERENT basename, so the
 * derived task title genuinely changes — titles are `Create <basename>`.
 */
const PLAN_RETITLED = `# Plan

### Phase 1: Persistence

**Files:**
- \`src/lib/db/cdo.js\` (NEW: cdo-push persistence)

### Phase 2: Read routes

**Files:**
- \`src/app/api/v1/context/context-route.js\` (NEW: context route)
`;

describe("planToTasks status preservation", () => {
  let featureDir: string;

  const tasksPath = () => path.join(featureDir, ".gwrk", "tasks.json");
  const read = () => JSON.parse(fs.readFileSync(tasksPath(), "utf-8"));

  /** Mark every task in a phase completed, as a real ship would. */
  const complete = (phaseId: string) => {
    const state = read();
    for (const p of state.phases) {
      if (p.id !== phaseId) continue;
      for (const t of p.tasks) {
        t.status = "completed";
        t.completedAt = "2026-08-01T00:00:00.000Z";
      }
    }
    fs.writeFileSync(tasksPath(), JSON.stringify(state, null, 2));
  };

  const statuses = (phaseId: string) =>
    read()
      .phases.find((p: { id: string }) => p.id === phaseId)
      .tasks.map((t: { status: string }) => t.status);

  beforeEach(() => {
    featureDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-p2t-"));
    fs.writeFileSync(path.join(featureDir, "plan.md"), PLAN);
  });

  afterEach(() => {
    fs.rmSync(featureDir, { recursive: true, force: true });
  });

  it("keeps a completed task completed when regenerated without --reconcile", () => {
    planToTasks(featureDir, "005-dashboard-api");
    complete("phase-01");

    planToTasks(featureDir, "005-dashboard-api");

    expect(statuses("phase-01")).toEqual(["completed"]);
  });

  it("keeps completedAt, so shipped work retains its evidence", () => {
    planToTasks(featureDir, "005-dashboard-api");
    complete("phase-01");

    planToTasks(featureDir, "005-dashboard-api");

    const task = read().phases[0].tasks[0];
    expect(task.completedAt).toBe("2026-08-01T00:00:00.000Z");
  });

  it("leaves untouched phases open", () => {
    planToTasks(featureDir, "005-dashboard-api");
    complete("phase-01");

    planToTasks(featureDir, "005-dashboard-api");

    expect(statuses("phase-02")).toEqual(["open"]);
  });

  it("resets a task whose title changed, rather than inheriting a stale completion", () => {
    // Matching is by title. A rewritten task is different work and must not
    // inherit the old one's completed status.
    planToTasks(featureDir, "005-dashboard-api");
    complete("phase-02");
    fs.writeFileSync(path.join(featureDir, "plan.md"), PLAN_RETITLED);

    planToTasks(featureDir, "005-dashboard-api");

    expect(statuses("phase-02")).toEqual(["open"]);
  });

  it("does not carry a removed task forward as cancelled without --reconcile", () => {
    planToTasks(featureDir, "005-dashboard-api");
    fs.writeFileSync(path.join(featureDir, "plan.md"), PLAN_RETITLED);

    planToTasks(featureDir, "005-dashboard-api");

    expect(statuses("phase-02")).toEqual(["open"]);
  });

  it("still carries a removed task forward as cancelled with --reconcile", () => {
    planToTasks(featureDir, "005-dashboard-api");
    fs.writeFileSync(path.join(featureDir, "plan.md"), PLAN_RETITLED);

    planToTasks(featureDir, "005-dashboard-api", { reconcile: true });

    expect(statuses("phase-02").sort()).toEqual(["cancelled", "open"]);
  });
});
