import { beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { planCommand } from "./plan.js";
import { PlanHeartbeat } from "../server/heartbeat.js";
import { generatePlanVizHtml } from "../server/plan-viz.js";
import { PlanStore } from "../engine/plan-store.js";
import * as db from "../db/plan.js";

// Mock PlanStore
vi.mock("../engine/plan-store.js", () => {
  return {
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
                updated_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
              },
            ],
          },
        ],
        edges: [],
      }),
      getSolver: vi.fn().mockReturnValue(Promise.resolve({
        getReadyQueue: vi.fn().mockReturnValue([{ id: "P001", name: "Phase 1", sp_estimate: 3 }]),
        getCriticalPath: vi.fn().mockReturnValue({ path: [], total_sp: 0, warnings: [] }),
        getTopologicalWaves: vi.fn().mockReturnValue([]),
      })),
      listProposals: vi.fn().mockReturnValue([]),
      approveProposal: vi.fn(),
      rejectProposal: vi.fn(),
      updatePhase: vi.fn(),
    })),
  };
});

// Mock drift-detector
vi.mock("../engine/drift-detector.js", () => {
  return {
    DriftDetector: vi.fn().mockImplementation(() => ({
      verify: vi.fn().mockReturnValue([{ status: "CLEAN" }]),
    })),
  };
});

describe("Phase 5: Visualization & Monitoring", () => {
  describe("generatePlanVizHtml", () => {
    it("should generate HTML containing graph data", () => {
      const features = [{ id: "F001", name: "Feature 1", status: "IN_PROGRESS", sp_total: 10 }];
      const phases = [{ id: "P001", feature_id: "F001", name: "Phase 1", status: "IN_PROGRESS", health: "GREEN", sp_estimate: 5, seq: 1 }];
      const edges = [];
      
      const html = generatePlanVizHtml(features, phases, edges, ["P001"]);
      
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("Feature 1");
      expect(html).toContain("Phase 1");
      expect(html).toContain("#e74c3c"); // Critical path color
      expect(html).toContain("sigma.min.js");
    });
  });

  describe("PlanHeartbeat", () => {
    it("should detect stale phases and update health", async () => {
      const mockConfig = {
        project: { name: "test", slack: { channelId: "C123" } },
      } as any;
      const mockSlack = {
        client: {
          chat: {
            postMessage: vi.fn().mockResolvedValue({ ok: true }),
          },
        },
      } as any;
      
      const heartbeat = new PlanHeartbeat(mockConfig, mockSlack);
      await heartbeat.runCheck();
      
      const store = (heartbeat as any).store;
      expect(store.updatePhase).toHaveBeenCalledWith("P001", { health: "YELLOW" });
      expect(mockSlack.client.chat.postMessage).toHaveBeenCalled();
    });
  });

  describe("gwrk plan subcommands", () => {
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
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Dry Run"));
    });

    it("US-014: gwrk plan review list should show proposals", async () => {
      await program.parseAsync(["node", "test", "plan", "review", "list"]);
      expect(consoleSpy).toHaveBeenCalledWith("No pending proposals.");
    });
  });
});
