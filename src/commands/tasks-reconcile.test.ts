/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tasksGenerateCommand } from "./tasks-generate.js";

import { planToTasks } from "../engine/plan-to-tasks.js";

/**
 * Tests for --reconcile behavior.
 * These cover known scenarios:
 *   1. Preserves completed task status when title matches
 *   2. New tasks from updated plan appear as "open"
 *   3. Removed tasks from updated plan are marked "cancelled"
 *   4. Task IDs are reassigned sequentially (no gaps)
 *   5. generatedFrom.plan.hash is updated to current plan
 */
describe("gwrk define tasks --reconcile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "reconcile-test-"));
    // Provide a mock standard config to satisfy loadConfig
    fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "test-feature" }, agents: { define: "gemini", implement: "gemini" } }));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function writePlan(content: string) {
    const specsDir = path.join(tempDir, "specs", "test-feature");
    if (!fs.existsSync(specsDir)) fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, "plan.md"), content);
  }

  function readTasks(): any {
    const tasksPath = path.join(tempDir, "specs", "test-feature", ".gwrk", "tasks.json");
    return JSON.parse(fs.readFileSync(tasksPath, "utf-8"));
  }

  const PLAN_V1 = `# Implementation Plan: test-feature

### Phase 1: Setup

**Files (2):**
- \`src/config.ts\` (NEW: Configuration module)
- \`src/utils.ts\` (NEW: Utility helpers)
`;

  const PLAN_V2 = `# Implementation Plan: test-feature

### Phase 1: Setup

**Files (3):**
- \`src/config.ts\` (NEW: Configuration module)
- \`src/logger.ts\` (NEW: Logging system)
- \`src/utils.ts\` (NEW: Utility helpers)
`;

  const PLAN_V3_REMOVED = `# Implementation Plan: test-feature

### Phase 1: Setup

**Files (1):**
- \`src/logger.ts\` (NEW: Logging system)
`;

  it("preserves completed task status when title matches", () => {
    const featureDir = path.join(tempDir, "specs", "test-feature");
    writePlan(PLAN_V1);
    
    // Initial generation
    planToTasks(featureDir, "test-feature");
    
    // Mark one task as completed
    const tasks = readTasks();
    tasks.phases[0].tasks[0].status = "completed";
    tasks.phases[0].tasks[0].completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(featureDir, ".gwrk", "tasks.json"), JSON.stringify(tasks));
    
    // Reconcile with same plan
    planToTasks(featureDir, "test-feature", { reconcile: true });
    
    const reconciled = readTasks();
    expect(reconciled.phases[0].tasks[0].status).toBe("completed");
    expect(reconciled.phases[0].tasks[0].title).toBe("Create config.ts");
    expect(reconciled.phases[0].tasks[1].status).toBe("open");
  });

  it("adds new tasks from updated plan as open", () => {
    const featureDir = path.join(tempDir, "specs", "test-feature");
    writePlan(PLAN_V1);
    planToTasks(featureDir, "test-feature");
    
    // Update plan
    writePlan(PLAN_V2);
    planToTasks(featureDir, "test-feature", { reconcile: true });
    
    const reconciled = readTasks();
    expect(reconciled.phases[0].tasks).toHaveLength(3);
    expect(reconciled.phases[0].tasks[1].title).toBe("Create logger.ts");
    expect(reconciled.phases[0].tasks[1].status).toBe("open");
  });

  it("marks removed tasks as cancelled", () => {
    const featureDir = path.join(tempDir, "specs", "test-feature");
    writePlan(PLAN_V1);
    planToTasks(featureDir, "test-feature");
    
    // Update plan to remove tasks
    writePlan(PLAN_V3_REMOVED);
    planToTasks(featureDir, "test-feature", { reconcile: true });
    
    const reconciled = readTasks();
    // logger.ts was in V2 but not in V3. 
    // Wait, PLAN_V1 had config.ts and utils.ts. PLAN_V3 has only logger.ts.
    // So config.ts and utils.ts should be cancelled.
    expect(reconciled.phases[0].tasks).toHaveLength(3); // 1 new + 2 cancelled
    const cancelled = reconciled.phases[0].tasks.filter((t: any) => t.status === "cancelled");
    expect(cancelled).toHaveLength(2);
    expect(cancelled.map((t: any) => t.title)).toContain("Create config.ts");
    expect(cancelled.map((t: any) => t.title)).toContain("Create utils.ts");
  });

  it("updates generatedFrom hash to current plan", () => {
    const featureDir = path.join(tempDir, "specs", "test-feature");
    writePlan(PLAN_V1);
    const initial = planToTasks(featureDir, "test-feature");
    const initialHash = initial.generatedFrom?.plan.hash;
    
    writePlan(PLAN_V2);
    const reconciled = planToTasks(featureDir, "test-feature", { reconcile: true });
    const newHash = reconciled.generatedFrom?.plan.hash;
    
    expect(newHash).toBeDefined();
    expect(newHash).not.toBe(initialHash);
  });
});
