/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "./index.js";
import {
  getAllDependencies,
  getEdgesForFeature,
  getFeature,
  getPhase,
  getProposal,
  insertEdge,
  insertFeature,
  insertPhase,
  insertProposal,
  listPhases,
} from "./plan.js";

describe("src/db/plan.ts (DM-018-001/002/003)", () => {
  let db: Database.Database;
  const projectId = "test-project";

  beforeEach(() => {
    db = getTestDb();
  });

  it("FR-001: should insert and retrieve a feature", () => {
    const feature = {
      id: "F018",
      name: "Build Plan Orchestrator",
      status: "PLANNED",
      sp_total: 25,
    };
    insertFeature(feature, projectId, db);
    const result = getFeature("F018", projectId, db);
    expect(result).toMatchObject(feature);
  });

  it("FR-001: should insert and retrieve a phase", () => {
    insertFeature(
      {
        id: "F018",
        name: "Build Plan Orchestrator",
        status: "PLANNED",
        sp_total: 25,
      },
      projectId,
      db,
    );
    const phase = {
      id: "F018-P1",
      feature_id: "F018",
      name: "Foundation",
      status: "PLANNED",
      health: "CLEAN",
      sp_estimate: 5,
      seq: 1,
    };
    insertPhase(phase, projectId, db);
    const result = getPhase("F018-P1", projectId, db);
    expect(result).toMatchObject(phase);
  });

  it("lists a moved phase under its canonical feature", () => {
    const phase = {
      id: "phase",
      name: "Shared phase",
      status: "PLANNED",
      health: "CLEAN",
      sp_estimate: 0,
      seq: 1,
    };
    for (const [id, featureId] of [
      ["alias", "old-feature"],
      [projectId, "current-feature"],
    ]) {
      insertFeature(
        { id: featureId, name: featureId, status: "PLANNED", sp_total: 0 },
        id,
        db,
      );
      insertPhase({ ...phase, feature_id: featureId }, id, db);
    }
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)",
    ).run("alias", projectId);

    expect(listPhases("old-feature", projectId, db)).toEqual([]);
    expect(listPhases("current-feature", projectId, db)).toEqual([
      getPhase(phase.id, projectId, db),
    ]);
  });

  it("moves an effective phase to a legacy-owned feature with its proposals", () => {
    const phase = {
      id: "phase",
      feature_id: "current-feature",
      name: "Shared phase",
      status: "PLANNED",
      health: "CLEAN",
      sp_estimate: 0,
      seq: 1,
    };
    insertFeature(
      { id: phase.feature_id, name: "Current", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );
    insertFeature(
      {
        id: "destination",
        name: "Destination",
        status: "PLANNED",
        sp_total: 5,
      },
      "alias",
      db,
    );
    insertPhase(phase, projectId, db);
    const proposal = {
      id: "proposal",
      target_phase_id: phase.id,
      proposal_type: "ADD_TASK",
      status: "PENDING",
    };
    insertProposal(proposal, projectId, db);
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)",
    ).run("alias", projectId);

    insertPhase({ ...phase, feature_id: "destination" }, "alias", db);

    for (const id of [projectId, "alias"]) {
      const moved = getPhase(phase.id, id, db);
      expect.soft(moved?.feature_id).toBe("destination");
      expect.soft(listPhases(phase.feature_id, id, db)).toEqual([]);
      expect.soft(listPhases("destination", id, db)).toEqual([moved]);
      expect.soft(getProposal(proposal.id, id, db)).toMatchObject(proposal);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("FR-001: should insert and retrieve edges", () => {
    insertFeature(
      { id: "F018", name: "Feature 1", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );
    insertFeature(
      { id: "F019", name: "Feature 2", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );

    const edge = { from_id: "F018", to_id: "F019", edge_type: "DEPENDS_ON" };
    insertEdge(edge, projectId, db);

    const edges = getEdgesForFeature("F019", projectId, db);
    expect(edges).toContainEqual(expect.objectContaining(edge));
  });

  it("FR-001: should support recursive dependency traversal (CTE)", () => {
    insertFeature(
      { id: "A", name: "A", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );
    insertFeature(
      { id: "B", name: "B", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );
    insertFeature(
      { id: "C", name: "C", status: "PLANNED", sp_total: 0 },
      projectId,
      db,
    );

    insertEdge(
      { from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" },
      projectId,
      db,
    );
    insertEdge(
      { from_id: "B", to_id: "C", edge_type: "DEPENDS_ON" },
      projectId,
      db,
    );

    const allDeps = getAllDependencies("C", projectId, db);
    expect(allDeps.map((d) => d.id)).toContain("A");
    expect(allDeps.map((d) => d.id)).toContain("B");
  });
});
