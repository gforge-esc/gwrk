/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "./index.js";
import {
  deleteFeature,
  deletePhase,
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
  listProposals,
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
      insertProposal(
        {
          id: "P1",
          target_phase_id: phase.id,
          proposal_type: "ADD_TASK",
          status: "PENDING",
        },
        id,
        db,
      );
    }
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)",
    ).run("alias", projectId);

    expect(listPhases("old-feature", projectId, db)).toEqual([]);
    expect(listPhases("current-feature", projectId, db)).toEqual([
      getPhase(phase.id, projectId, db),
    ]);

    deleteFeature("current-feature", projectId, db);
    for (const id of [projectId, "alias"]) {
      expect.soft(getPhase(phase.id, id, db)).toBeUndefined();
      expect.soft(listPhases("old-feature", id, db)).toEqual([]);
      expect.soft(getProposal("P1", id, db)).toBeUndefined();
      expect.soft(listProposals(id, db)).toEqual([]);
      expect(getFeature("old-feature", id, db)).toBeDefined();
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("removes superseded proposal copies when deleting their effective phase", () => {
    for (const [owner, phase] of [
      [projectId, "phase-new"],
      ["alias", "phase-old"],
    ]) {
      insertFeature(
        { id: "feature", name: "Feature", status: "PLANNED", sp_total: 0 },
        owner,
        db,
      );
      insertPhase(
        {
          id: phase,
          feature_id: "feature",
          name: phase,
          status: "PLANNED",
          health: "CLEAN",
          sp_estimate: 0,
          seq: 1,
        },
        owner,
        db,
      );
      insertProposal(
        {
          id: "P1",
          target_phase_id: phase,
          proposal_type: "ADD_TASK",
          status: "PENDING",
        },
        owner,
        db,
      );
    }
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)",
    ).run("alias", projectId);

    expect(getProposal("P1", "alias", db)?.target_phase_id).toBe("phase-new");
    deletePhase("phase-new", "alias", db);
    for (const owner of [projectId, "alias"]) {
      expect.soft(getProposal("P1", owner, db)).toBeUndefined();
      expect.soft(getPhase("phase-old", owner, db)).toBeDefined();
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });

  it("preserves a surviving phase's proposal when its shadowed parent cascades", () => {
    for (const [owner, feature] of [
      [projectId, "keep"],
      ["alias", "delete"],
    ]) {
      insertFeature(
        { id: feature, name: feature, status: "PLANNED", sp_total: 0 },
        owner,
        db,
      );
      insertPhase(
        {
          id: "P",
          feature_id: feature,
          name: "Phase",
          status: "PLANNED",
          health: "CLEAN",
          sp_estimate: 0,
          seq: 1,
        },
        owner,
        db,
      );
    }
    insertProposal(
      {
        id: "Q",
        target_phase_id: "P",
        proposal_type: "ADD_TASK",
        status: "PENDING",
        detail: "Keep this proposal",
        source: "review",
      },
      "alias",
      db,
    );
    db.prepare(
      "UPDATE plan_proposals SET created_at = '2026-10-01', resolved_at = '2026-10-02', updated_at = '2026-10-03' WHERE id = 'Q'",
    ).run();
    db.prepare(
      "INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)",
    ).run("alias", projectId);
    const expected = {
      ...getProposal("Q", projectId, db),
      project_id: projectId,
    };

    deleteFeature("delete", "alias", db);
    for (const id of [projectId, "alias"]) {
      expect.soft(getPhase("P", id, db)?.feature_id).toBe("keep");
      expect.soft(getProposal("Q", id, db)).toEqual(expected);
      expect.soft(listProposals(id, db)).toEqual([expected]);
    }
    expect(db.pragma("foreign_key_check")).toEqual([]);
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

  it("retargets a proposal between canonical and alias phases", () => {
    const phase = {
      feature_id: "shared",
      name: "Phase",
      status: "PLANNED",
      health: "CLEAN",
      sp_estimate: 0,
      seq: 1,
    };
    for (const [id, phaseId] of [
      [projectId, "current-phase"],
      ["alpha-old", "old-phase"],
    ]) {
      insertFeature(
        { id: "shared", name: "Feature", status: "PLANNED", sp_total: 0 },
        id,
        db,
      );
      insertPhase({ ...phase, id: phaseId }, id, db);
    }
    const proposal = {
      id: "P1",
      target_phase_id: "current-phase",
      proposal_type: "ADD_TASK",
      status: "PENDING",
    };
    insertProposal(proposal, projectId, db);
    db.exec(`
      UPDATE plan_proposals SET created_at = '2026-11-10', resolved_at = '2026-11-11';
      INSERT INTO project_aliases (alias_id, project_id) VALUES ('alpha-old', 'test-project');
    `);

    for (const [target, owner] of [
      ["old-phase", "alpha-old"],
      ["current-phase", projectId],
    ]) {
      insertProposal({ ...proposal, target_phase_id: target }, "alpha-old", db);
      for (const id of [projectId, "alpha-old"]) {
        const effective = getProposal(proposal.id, id, db);
        expect.soft(effective).toMatchObject({
          target_phase_id: target,
          project_id: owner,
          created_at: "2026-11-10",
          resolved_at: "2026-11-11",
        });
        expect.soft(listProposals(id, db)).toEqual([effective]);
      }
      expect
        .soft(
          db
            .prepare("SELECT COUNT(*) FROM plan_proposals WHERE id = 'P1'")
            .pluck()
            .get(),
        )
        .toBe(1);
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
