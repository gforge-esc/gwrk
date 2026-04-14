import { describe, expect, it, vi, beforeEach } from "vitest";
import { PlanStore } from "./plan-store.js";
import * as db from "../db/plan.js";

vi.mock("../db/plan.js");

describe.skip("PlanStore Proposals (US-014)", () => {
  let store: PlanStore;

  beforeEach(() => {
    store = new PlanStore();
    vi.clearAllMocks();
  });

  it("should create a proposal", () => {
    const proposal = {
      target_phase_id: "F1-P1",
      proposal_type: "STATUS_UPDATE",
      detail: "Update to DONE",
      source: "agent"
    };

    if (typeof (store as any).proposeChange === 'function') {
        (db as any).insertProposal = vi.fn().mockReturnValue({ id: "PR-123" });
        (store as any).proposeChange(proposal);
        expect((db as any).insertProposal).toHaveBeenCalledWith(expect.objectContaining(proposal));
    } else {
        throw new Error("proposeChange not implemented");
    }
  });
});
