import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanStore } from "./plan-store.js";
import * as db from "../db/plan.js";

vi.mock("../db/plan.js", () => ({
  listFeatures: vi.fn(),
  listPhases: vi.fn(),
  listAllEdges: vi.fn(),
  getFeature: vi.fn(),
  insertFeature: vi.fn(),
  isPlanEmpty: vi.fn(),
}));

describe("PlanStore Scoping (FR-039 / TR-037)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should accept projectId in constructor and use it for queries", () => {
    const projectId = "test-project-123";
    // @ts-expect-error - Constructor doesn't accept projectId yet
    const store = new PlanStore(projectId);
    
    // @ts-expect-error
    expect(store.projectId).toBe(projectId);

    store.getPlanStatus();
    // @ts-expect-error - listFeatures doesn't accept projectId yet
    expect(db.listFeatures).toHaveBeenCalledWith(projectId);
  });
});
