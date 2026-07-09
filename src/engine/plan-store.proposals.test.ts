/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { PlanStore } from "./plan-store.js";
import * as db from "../db/plan.js";

vi.mock("../db/plan.js", async () => {
  const actual = await vi.importActual("../db/plan.js");
  return {
    ...actual as any,
    getDb: vi.fn(),
    insertProposal: vi.fn(),
    getProposal: vi.fn(),
    listProposals: vi.fn(),
    deleteProposal: vi.fn(),
    getPhase: vi.fn(),
    insertPhase: vi.fn(),
  };
});

describe("PlanStore Proposals (Phase 5)", () => {
  let store: PlanStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new PlanStore("test-project");
  });

  it("should add a proposal", () => {
    const proposal = {
      id: "prop-1",
      target_phase_id: "phase-1",
      proposal_type: "STATUS_UPDATE",
      detail: "DONE",
      status: "PENDING",
    };

    store.addProposal(proposal);
    expect(db.insertProposal).toHaveBeenCalledWith(proposal, "test-project");
  });

  it("should list proposals", () => {
    const mockProposals = [
      { id: "p1", status: "PENDING" },
      { id: "p2", status: "APPROVED" },
    ];
    vi.mocked(db.listProposals).mockReturnValue(mockProposals as any);

    const result = store.listProposals();
    expect(result).toEqual(mockProposals);
  });

  it("should approve a status update proposal", () => {
    const proposal = {
      id: "prop-1",
      target_phase_id: "phase-1",
      proposal_type: "STATUS_UPDATE",
      detail: "DONE",
      status: "PENDING",
    };
    const phase = { id: "phase-1", status: "IN_PROGRESS" };

    vi.mocked(db.getProposal).mockReturnValue(proposal as any);
    vi.mocked(db.getPhase).mockReturnValue(phase as any);

    store.approveProposal("prop-1");

    // Should update the phase status
    expect(db.insertPhase).toHaveBeenCalledWith(expect.objectContaining({
      id: "phase-1",
      status: "DONE",
    }), "test-project");

    // Should mark proposal as APPROVED
    expect(db.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      id: "prop-1",
      status: "APPROVED",
    }), "test-project");
  });

  it("should reject a proposal", () => {
    const proposal = {
      id: "prop-1",
      target_phase_id: "phase-1",
      status: "PENDING",
    };

    vi.mocked(db.getProposal).mockReturnValue(proposal as any);

    store.rejectProposal("prop-1");

    expect(db.insertProposal).toHaveBeenCalledWith(expect.objectContaining({
      id: "prop-1",
      status: "REJECTED",
    }), "test-project");
  });
});
