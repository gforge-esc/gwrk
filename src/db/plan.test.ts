import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "./index.js";
import {
  getAllDependencies,
  getEdgesForFeature,
  getFeature,
  getPhase,
  insertEdge,
  insertFeature,
  insertPhase,
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
    insertFeature({ id: "A", name: "A", status: "PLANNED", sp_total: 0 }, projectId, db);
    insertFeature({ id: "B", name: "B", status: "PLANNED", sp_total: 0 }, projectId, db);
    insertFeature({ id: "C", name: "C", status: "PLANNED", sp_total: 0 }, projectId, db);

    insertEdge({ from_id: "A", to_id: "B", edge_type: "DEPENDS_ON" }, projectId, db);
    insertEdge({ from_id: "B", to_id: "C", edge_type: "DEPENDS_ON" }, projectId, db);

    const allDeps = getAllDependencies("C", projectId, db);
    expect(allDeps.map((d) => d.id)).toContain("A");
    expect(allDeps.map((d) => d.id)).toContain("B");
  });
});
