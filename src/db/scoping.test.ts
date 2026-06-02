import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { insertFeature, getFeature, listFeatures, type PlanFeature } from "./plan.js";

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
    const f1: PlanFeature = { id: "F1", name: "Feat 1", status: "open", sp_total: 5 };
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

    insertFeature({ id: "F1", name: "F1", status: "open", sp_total: 1 }, p1, db);
    insertFeature({ id: "F2", name: "F2", status: "open", sp_total: 1 }, p2, db);

    const list1 = listFeatures(p1, db);
    expect(list1).toHaveLength(1);
    expect(list1[0].id).toBe("F1");

    const list2 = listFeatures(p2, db);
    expect(list2).toHaveLength(1);
    expect(list2[0].id).toBe("F2");
  });
});
