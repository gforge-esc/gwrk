/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getGateResult, recordGateResult } from "./gates.js";
import { getTestDb } from "./index.js";
import { listIssues, upsertIssue } from "./issues.js";
import {
  type PlanFeature,
  getFeature,
  getPhase,
  insertFeature,
  insertPhase,
  listFeatures,
} from "./plan.js";
import { registerProject } from "./runs.js";

describe("Database Scoping (US-030 / FR-037 / FR-038 / TR-036)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    // Setup tables with project_id column (simulating migration 009)
    db.exec(`
      CREATE TABLE plan_features (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        sp_total INTEGER NOT NULL,
        project_id TEXT,
        updated_at TEXT
      );
    `);
  });

  afterEach(() => {
    db.close();
  });

  it("should scope feature insertion and retrieval by projectId", () => {
    const f1: PlanFeature = {
      id: "F1",
      name: "Feat 1",
      status: "open",
      sp_total: 5,
    };
    const p1 = "proj-1";
    const p2 = "proj-2";

    insertFeature(f1, p1, db);
    insertFeature({ ...f1, id: "F2" }, p2, db);

    // Verify retrieval is scoped
    const result1 = getFeature("F1", p1, db);
    expect(result1).toBeDefined();
    expect(result1?.id).toBe("F1");

    const result2 = getFeature("F1", p2, db);
    expect(result2).toBeUndefined();
  });

  it("should scope listFeatures by projectId", () => {
    const p1 = "proj-1";
    const p2 = "proj-2";

    insertFeature(
      { id: "F1", name: "F1", status: "open", sp_total: 1 },
      p1,
      db,
    );
    insertFeature(
      { id: "F2", name: "F2", status: "open", sp_total: 1 },
      p2,
      db,
    );

    const list1 = listFeatures(p1, db);
    expect(list1).toHaveLength(1);
    expect(list1[0].id).toBe("F1");

    const list2 = listFeatures(p2, db);
    expect(list2).toHaveLength(1);
    expect(list2[0].id).toBe("F2");
  });
});

describe("Shared ledger project isolation", () => {
  const projectIds = ["project-one", "project-two"];
  const featureId = "001-shared-feature";
  const phaseId = "phase-01";
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
    for (const id of projectIds) {
      registerProject({ id, name: id, path: `/fixtures/${id}` }, db);
      insertFeature(
        { id: featureId, name: id, status: "open", sp_total: 1 },
        id,
        db,
      );
    }
  });

  afterEach(() => db.close());

  it("keeps identical feature and phase IDs in both projects", () => {
    for (const id of projectIds) {
      insertPhase(
        {
          id: phaseId,
          feature_id: featureId,
          name: id,
          status: "open",
          health: "green",
          sp_estimate: 1,
          seq: 1,
        },
        id,
        db,
      );
    }
    for (const id of projectIds) {
      expect(getFeature(featureId, id, db)?.name).toBe(id);
      expect(getPhase(phaseId, id, db)?.name).toBe(id);
    }
  });

  it("keeps identical gate IDs in both projects", () => {
    for (const id of projectIds) {
      recordGateResult(
        {
          feature_id: featureId,
          phase_id: phaseId,
          task_id: "T001",
          gate_script: "verify.sh",
          passed: 1,
          exit_code: 0,
          output: id,
        },
        id,
        db,
      );
    }
    for (const id of projectIds) {
      expect(getGateResult(featureId, phaseId, "T001", id, db)?.output).toBe(
        id,
      );
    }
  });

  it("keeps identical issue numbers in both projects", () => {
    for (const id of projectIds) {
      upsertIssue(
        {
          issue_number: 1,
          feature_id: featureId,
          title: id,
          body: null,
          state: "open",
          created_at: "2026-11-11T12:00:00Z",
          author: "fixture",
        },
        id,
        db,
      );
    }
    for (const id of projectIds) {
      expect(listIssues(featureId, id, db).map(({ title }) => title)).toEqual([
        id,
      ]);
    }
  });
});
