/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
import { PlanStore } from "./plan-store.js";
import * as planDb from "../db/plan.js";

// vi.hoisted ensures this runs in the same scope as vi.mock factories
const { getTestDb, setTestDb } = vi.hoisted(() => {
  let _db: Database.Database;
  return {
    getTestDb: () => _db,
    setTestDb: (db: Database.Database) => { _db = db; },
  };
});

vi.mock("../db/index.js", () => ({
  getDb: () => getTestDb(),
  initDb: vi.fn(),
}));

/**
 * Integration test: uses real SQLite (in-memory) + real filesystem.
 * DB module is mocked to return our in-memory DB, but all plan.ts functions are real.
 */

// Apply migrations to the in-memory DB
function applyMigrations(db: Database.Database) {
  const migrationsDir = path.join(process.cwd(), "src", "db", "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    db.exec(sql);
  }
}

describe("PlanStore.initFromSpecs Integration (plan_phases population)", () => {
  let tempDir: string;
  let db: Database.Database;
  const projectId = "test-project";

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-init-test-"));
    db = new Database(":memory:");
    setTestDb(db); // Wire the mock
    applyMigrations(db);

    // Register project
    db.prepare("INSERT OR IGNORE INTO projects (id, name, path) VALUES (?, ?, ?)").run(
      projectId,
      "test-project",
      tempDir,
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createFeatureDir(featureId: string, planContent: string) {
    const dir = path.join(tempDir, "specs", featureId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(dir, "plan.md"), planContent);
  }

  it("should insert phases from plan.md into plan_phases", () => {
    createFeatureDir("feat-a", [
      "# Plan",
      "",
      "### Phase 1: Foundation",
      "",
      "**Files (1):**",
      "- `src/setup.ts` (NEW: Create setup)",
      "",
      "### Phase 2: Integration",
      "",
      "**Files (1):**",
      "- `src/api.ts` (NEW: Create API)",
    ].join("\n"));

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    const report = store.initFromSpecs(specsDir);

    expect(report.added).toContain("feat-a");
    expect(report.phasesInserted).toBe(2);

    const phases = planDb.listPhases("feat-a", projectId, db);
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({ id: "feat-a/phase-01", feature_id: "feat-a", name: "Foundation", seq: 1 });
    expect(phases[1]).toMatchObject({ id: "feat-a/phase-02", feature_id: "feat-a", name: "Integration", seq: 2 });
  });

  it("should produce deterministic phase IDs across runs", () => {
    createFeatureDir("feat-det", [
      "# Plan",
      "",
      "### Phase 1: Alpha",
      "### Phase 2: Beta",
      "### Phase 3: Gamma",
    ].join("\n"));

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);

    const phases = planDb.listPhases("feat-det", projectId, db);
    expect(phases.map(p => p.id)).toEqual(["feat-det/phase-01", "feat-det/phase-02", "feat-det/phase-03"]);

    // Second run — should not duplicate
    const report2 = store.initFromSpecs(specsDir);
    expect(report2.phasesInserted).toBe(0); // All exist already

    const phases2 = planDb.listPhases("feat-det", projectId, db);
    expect(phases2).toHaveLength(3); // No duplicates
  });

  it("should enrich phase status from ship runs in runs table", () => {
    createFeatureDir("feat-ship", [
      "# Plan",
      "",
      "### Phase 1: Done Phase",
      "### Phase 2: Open Phase",
    ].join("\n"));

    // Insert a ship run for phase-01
    db.prepare(
      `INSERT INTO runs (feature_id, phase_id, command, project_id, started_at, finished_at, exit_code)
       VALUES (?, ?, 'ship', ?, datetime('now'), datetime('now'), 0)`,
    ).run("feat-ship", "phase-01", projectId);

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);

    const phases = planDb.listPhases("feat-ship", projectId, db);
    expect(phases[0]).toMatchObject({ id: "feat-ship/phase-01", status: "SHIPPED" });
    expect(phases[1]).toMatchObject({ id: "feat-ship/phase-02", status: "PLANNED" });
  });

  it("should be additive for new phases while preserving runtime status on existing ones", () => {
    createFeatureDir("feat-add", [
      "# Plan",
      "",
      "### Phase 1 — Original (5 SP)",
    ].join("\n"));

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);

    // Manually update phase-01 status to SHIPPED (runtime state)
    const p1 = planDb.getPhase("feat-add/phase-01", projectId, db);
    expect(p1).toBeDefined();
    planDb.insertPhase({ ...p1!, status: "SHIPPED" }, projectId, db);

    // Add phase 2 to plan.md
    createFeatureDir("feat-add", [
      "# Plan",
      "",
      "### Phase 1 — Original (5 SP)",
      "### Phase 2 — New Phase (2 SP)",
    ].join("\n"));

    const report2 = store.initFromSpecs(specsDir);
    expect(report2.phasesInserted).toBe(1); // Only phase-02 is new

    const phases = planDb.listPhases("feat-add", projectId, db);
    expect(phases).toHaveLength(2);
    // Phase 1 keeps its runtime SHIPPED status; sp tracks the (unchanged) doc
    expect(phases[0]).toMatchObject({ id: "feat-add/phase-01", status: "SHIPPED", sp_estimate: 5 });
    // Phase 2 is new
    expect(phases[1]).toMatchObject({ id: "feat-add/phase-02", name: "New Phase", status: "PLANNED", sp_estimate: 2 });
  });

  it("should handle features without plan.md gracefully (no phases)", () => {
    // Feature with spec.md but no plan.md
    const dir = path.join(tempDir, "specs", "feat-no-plan");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), "# Spec");

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    const report = store.initFromSpecs(specsDir);

    expect(report.added).toContain("feat-no-plan");
    expect(report.phasesInserted).toBe(0);

    const phases = planDb.listPhases("feat-no-plan", projectId, db);
    expect(phases).toHaveLength(0);
  });

  it("should prune ghost features that no longer exist on disk", () => {
    createFeatureDir("feat-real", "# Plan\n\n### Phase 1: Real\n");

    // Manually insert a ghost feature in DB
    planDb.insertFeature(
      { id: "ghost-099", name: "Ghost", status: "SPECIFIED", sp_total: 0 },
      projectId,
      db,
    );
    planDb.insertFeature(
      { id: "F000", name: "Extraction", status: "DONE", sp_total: 0 },
      projectId,
      db,
    );

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    const report = store.initFromSpecs(specsDir);

    expect(report.pruned).toContain("ghost-099");
    expect(report.pruned).toContain("F000");

    // Ghost should be gone from DB
    expect(planDb.getFeature("ghost-099", projectId, db)).toBeUndefined();
    expect(planDb.getFeature("F000", projectId, db)).toBeUndefined();
    // Real feature should still exist
    expect(planDb.getFeature("feat-real", projectId, db)).toBeDefined();
  });

  it("should reconcile feature status to SHIPPED when all phases are shipped", () => {
    createFeatureDir("feat-reconcile", "# Plan\n\n### Phase 1: Done\n### Phase 2: Also Done\n");

    // Insert ship runs for both phases
    db.prepare(
      `INSERT INTO runs (feature_id, phase_id, command, project_id, started_at, finished_at, exit_code)
       VALUES (?, ?, 'ship', ?, datetime('now'), datetime('now'), 0)`,
    ).run("feat-reconcile", "phase-01", projectId);
    db.prepare(
      `INSERT INTO runs (feature_id, phase_id, command, project_id, started_at, finished_at, exit_code)
       VALUES (?, ?, 'ship', ?, datetime('now'), datetime('now'), 0)`,
    ).run("feat-reconcile", "phase-02", projectId);

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    const report = store.initFromSpecs(specsDir);

    // Feature should be SHIPPED (reconciled from DEFINED)
    const feature = planDb.getFeature("feat-reconcile", projectId, db);
    expect(feature?.status).toBe("SHIPPED");
    expect(report.reconciled).toContainEqual("feat-reconcile: DEFINED → SHIPPED");
  });

  it("should pass story points from plan.md into phase sp_estimate", () => {
    createFeatureDir("feat-sp", [
      "## Phases",
      "### Phase 1 — Foundation (7 SP)",
      "### Phase 2 — Integration (5 SP)",
    ].join("\n"));

    const store = new PlanStore(projectId);
    const report = store.initFromSpecs(path.join(tempDir, "specs"));
    expect(report.phasesInserted).toBe(2);

    const phases = planDb.listPhases("feat-sp", projectId, db);
    expect(phases[0]).toMatchObject({ seq: 1, sp_estimate: 7 });
    expect(phases[1]).toMatchObject({ seq: 2, sp_estimate: 5 });
  });

  it("should set and refresh feature sp_total from tasks.json across runs", () => {
    const dir = path.join(tempDir, "specs", "feat-sp");
    fs.mkdirSync(path.join(dir, ".gwrk"), { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(dir, "plan.md"), "### Phase 1 — Foo\n### Phase 2 — Bar");
    fs.writeFileSync(path.join(dir, ".gwrk/tasks.json"), JSON.stringify({
      phases: [
        { id: "phase-01", tasks: [{ id: "T001", sp: 2 }] },
        { id: "phase-02", tasks: [{ id: "T002", sp: 3 }] },
      ],
    }));

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);
    expect(planDb.getFeature("feat-sp", projectId, db)?.sp_total).toBe(5);

    // Re-estimate on disk -> re-init must refresh the existing feature's sp_total
    fs.writeFileSync(path.join(dir, ".gwrk/tasks.json"), JSON.stringify({
      phases: [
        { id: "phase-01", tasks: [{ id: "T001", sp: 8 }] },
        { id: "phase-02", tasks: [{ id: "T002", sp: 3 }] },
      ],
    }));
    store.initFromSpecs(specsDir);
    expect(planDb.getFeature("feat-sp", projectId, db)?.sp_total).toBe(11);

    // And the per-phase sp_estimate reflects tasks.json
    const phases = planDb.listPhases("feat-sp", projectId, db);
    expect(phases[0]).toMatchObject({ seq: 1, sp_estimate: 8 });
    expect(phases[1]).toMatchObject({ seq: 2, sp_estimate: 3 });
  });

  it("should refresh an existing feature's status when its docs advance on disk", () => {
    // First scan: spec.md only -> SPECIFIED
    const dir = path.join(tempDir, "specs", "feat-advance");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "spec.md"), "# Spec");

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);
    expect(planDb.getFeature("feat-advance", projectId, db)?.status).toBe("SPECIFIED");

    // plan.md added -> re-init should advance SPECIFIED -> DEFINED
    fs.writeFileSync(path.join(dir, "plan.md"), "# Plan\n\n### Phase 1 — Foo (3 SP)");
    const report2 = store.initFromSpecs(specsDir);

    expect(planDb.getFeature("feat-advance", projectId, db)?.status).toBe("DEFINED");
    expect(report2.reconciled).toContainEqual("feat-advance: SPECIFIED → DEFINED");
  });

  it("should never downgrade an implementation-phase feature status from disk readiness", () => {
    createFeatureDir("feat-shipped", "# Plan\n\n### Phase 1 — Foo (3 SP)");
    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    store.initFromSpecs(specsDir);

    // Simulate the feature already shipped
    planDb.updateFeatureStatus("feat-shipped", "SHIPPED", projectId, db);

    store.initFromSpecs(specsDir); // disk says DEFINED, must NOT downgrade
    expect(planDb.getFeature("feat-shipped", projectId, db)?.status).toBe("SHIPPED");
  });

  it("is idempotent but not static: same docs -> same phases; changed docs -> changed phases, runtime status preserved", () => {
    createFeatureDir("feat-track", "# Plan\n\n### Phase 1 — Original (3 SP)");
    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");

    store.initFromSpecs(specsDir);
    const first = planDb.listPhases("feat-track", projectId, db);
    store.initFromSpecs(specsDir); // no doc change
    const second = planDb.listPhases("feat-track", projectId, db);
    // Idempotent: same input -> identical output
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // Mark phase-01 shipped (runtime state)
    planDb.insertPhase(
      { ...planDb.getPhase("feat-track/phase-01", projectId, db)!, status: "SHIPPED" },
      projectId,
      db,
    );

    // Change the doc: rename + re-point SP
    createFeatureDir("feat-track", "# Plan\n\n### Phase 1 — Renamed (5 SP)");
    store.initFromSpecs(specsDir);
    const third = planDb.getPhase("feat-track/phase-01", projectId, db);
    // Not static: doc-derived fields track the plan
    expect(third).toMatchObject({ name: "Renamed", sp_estimate: 5 });
    // Runtime field preserved
    expect(third?.status).toBe("SHIPPED");
  });

  it("should reconcile feature status to IN_PROGRESS when some phases are shipped", () => {
    createFeatureDir("feat-partial", "# Plan\n\n### Phase 1: Done\n### Phase 2: Open\n");

    // Only phase 1 shipped
    db.prepare(
      `INSERT INTO runs (feature_id, phase_id, command, project_id, started_at, finished_at, exit_code)
       VALUES (?, ?, 'ship', ?, datetime('now'), datetime('now'), 0)`,
    ).run("feat-partial", "phase-01", projectId);

    const store = new PlanStore(projectId);
    const specsDir = path.join(tempDir, "specs");
    const report = store.initFromSpecs(specsDir);

    const feature = planDb.getFeature("feat-partial", projectId, db);
    expect(feature?.status).toBe("IN_PROGRESS");
    expect(report.reconciled).toContainEqual("feat-partial: DEFINED → IN_PROGRESS");
  });
});
