import { describe, it, expect, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import { ShipStage } from "./ship-types.js";
import * as fs from "node:fs";

vi.mock("node:fs");
vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn().mockReturnValue({
    phases: [
      {
        id: "phase-03",
        tasks: [
          { id: "T014", status: "completed", sp: 3 },
          { id: "T016", status: "completed", sp: 5 }
        ]
      }
    ]
  }),
  saveTaskState: vi.fn()
}));

describe("ShipOrchestrator Plan Events", () => {
  const config = {
    featureId: "018-build-plan-orchestrator",
    phaseId: "phase-03",
    backend: "gemini",
    maxIterations: 3,
    ciTimeout: 10,
    cwd: "/tmp/gwrk"
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it("should emit 'plan:ship:complete' when entering DONE stage", async () => {
    const initialState = {
      stage: ShipStage.DONE,
      iteration: 1,
      featureId: config.featureId,
      phaseId: config.phaseId,
      startedAt: new Date().toISOString(),
      runId: "test-run",
      backend: config.backend,
      failureContext: null,
    };

    const orchestrator = new ShipOrchestrator(config, initialState);
    
    const eventPromise = new Promise((resolve) => {
      orchestrator.on("plan:ship:complete", resolve);
    });

    const exitCode = await orchestrator.run();
    expect(exitCode).toBe(0);

    const event = await eventPromise as any;
    expect(event).toMatchObject({
      featureId: config.featureId,
      phaseId: config.phaseId,
      sp_actual: 8, // 3 + 5
    });
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    expect(event.evidence).toContain("Completed via gwrk ship");
  });
});
