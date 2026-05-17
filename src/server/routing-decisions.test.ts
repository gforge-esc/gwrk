import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getTestDb } from "../db/index.js";
import {
  type RoutingDecisionRecord,
  recordDecision,
} from "./routing-decisions.js";

vi.mock("../db/index.js", async () => {
  const actual = (await vi.importActual("../db/index.js")) as any;
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

describe("routing-decisions", () => {
  let db: any;

  beforeEach(() => {
    db = getTestDb();
    (getDb as any).mockReturnValue(db);
  });

  it("records a decision in the database (TR-006)", () => {
    const decision: RoutingDecisionRecord = {
      runId: "run-456",
      feature: "routing",
      phase: "P3",
      selectedBackend: "gemini",
      selectedModel: "gemini-pro",
      taskClassification: "thinking",
      reason: "high quota",
      quotaPercent: 88,
      probeStatus: "fresh",
      taskSp: 5,
      fallbackUsed: false,
      modelFailoverUsed: true,
    };

    recordDecision(decision);

    const row = db
      .prepare("SELECT * FROM routing_decisions WHERE run_id = ?")
      .get("run-456") as any;

    expect(row).toBeDefined();
    expect(row.selected_backend).toBe("gemini");
    expect(row.selected_model).toBe("gemini-pro");
    expect(row.task_classification).toBe("thinking");
    expect(row.quota_percent).toBe(88);
    expect(row.probe_status).toBe("fresh");
    expect(row.fallback_used).toBe(0); // Boolean stored as integer in SQLite
    expect(row.model_failover_used).toBe(1);
    expect(row.task_sp).toBe(5);
  });
});
