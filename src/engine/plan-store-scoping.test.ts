/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PlanStore } from "./plan-store.js";
import * as db from "../db/plan.js";

vi.mock("../db/plan.js", () => ({
  listFeatures: vi.fn(() => []),
  listPhases: vi.fn(() => []),
  listAllEdges: vi.fn(() => []),
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
    const store = new PlanStore(projectId);
    
    expect((store as any).projectId).toBe(projectId);

    store.getPlanStatus();
    expect(db.listFeatures).toHaveBeenCalledWith(projectId);
  });
});
