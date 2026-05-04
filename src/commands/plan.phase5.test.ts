import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { planCommand } from "./plan.js";

// Mock PlanStore — both viz and review need it
vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    isEmpty: vi.fn().mockReturnValue(false),
    getPlanStatus: vi.fn().mockReturnValue({
      features: [
        {
          id: "F001",
          name: "test-feature",
          status: "IN_PROGRESS",
          phases: [
            {
              id: "P001",
              name: "Phase 1",
              feature_id: "F001",
              status: "IN_PROGRESS",
              sp_estimate: 3,
            },
          ],
        },
      ],
      edges: [],
    }),
    getSolver: vi.fn().mockReturnValue({
      getCriticalPath: vi.fn().mockReturnValue({ path: [], total_sp: 0 }),
    }),
    listProposals: vi.fn().mockReturnValue([]),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
  })),
}));

// Mock plan-viz to avoid graphology dependency in tests
vi.mock("../server/plan-viz.js", () => ({
  generatePlanVizHtml: vi
    .fn()
    .mockReturnValue("<html><body>Plan Viz</body></html>"),
}));

describe("gwrk plan subcommands (Phase 5)", () => {
  let program: Command;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    program = new Command();
    program.addCommand(planCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("US-012: gwrk plan viz --dry-run should output visualization HTML", async () => {
    await program.parseAsync(["node", "test", "plan", "viz", "--dry-run"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dry Run"),
    );
  });

  it("US-014: gwrk plan review list should show proposals", async () => {
    await program.parseAsync(["node", "test", "plan", "review", "list"]);

    expect(consoleSpy).toHaveBeenCalledWith("No pending proposals.");
  });
});
