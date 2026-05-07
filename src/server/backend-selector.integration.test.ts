import { describe, it, expect, beforeEach, vi } from "vitest";
import { BackendSelector, type TaskContext } from "./backend-selector.js";
import { TaskClassification, TaskType } from "./task-classifier.js";
import type { AgentRegistry } from "./agent-registry.js";
import { getDb, getTestDb } from "../db/index.js";
import { QuotaProber } from "./quota-prober.js";

vi.mock("../db/index.js", async () => {
  const actual = await vi.importActual("../db/index.js") as any;
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

describe("BackendSelector Integration", () => {
  let db: any;
  let mockRegistry: AgentRegistry;
  let prober: QuotaProber;
  let selector: BackendSelector;

  const context: TaskContext = {
    runId: "integration-run-123",
    feature: "feat-integration",
    phase: "phase-1",
    taskType: TaskType.IMPLEMENT,
    language: "typescript",
    taskSP: 3,
  };

  beforeEach(() => {
    db = getTestDb();
    vi.mocked(getDb).mockReturnValue(db);

    mockRegistry = {
      backends: {
        gemini: {
          name: "gemini",
          type: "local-cli",
          command: "gemini --model {{model}}",
          maxConcurrent: 1,
          quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
          models: [
            { name: "gemini-pro", tier: TaskClassification.THINKING, modelFlag: "pro" },
            { name: "gemini-flash", tier: TaskClassification.FAST, modelFlag: "flash" },
          ],
        },
      },
      fallbackOrder: ["gemini"],
    };

    prober = new QuotaProber();
    // Mock probeQuota to avoid actual tmux calls
    vi.spyOn(prober, "probeQuota").mockResolvedValue({
      percent: 85,
      status: "fresh",
      probedAt: new Date().toISOString(),
      resetsIn: "1h",
    });

    selector = new BackendSelector(mockRegistry, prober);
  });

  it("performs full flow: select -> record -> query (TR-006)", async () => {
    // 1. Select backend
    const selection = await selector.selectBackend(context);
    
    expect(selection.backend).toBe("gemini");
    expect(selection.model).toBe("gemini-pro");
    expect(selection.quotaPercent).toBe(85);

    // 2. Verify it was recorded in the database
    const row = db.prepare("SELECT * FROM routing_decisions WHERE run_id = ?").get(context.runId) as any;
    
    expect(row).toBeDefined();
    expect(row.selected_backend).toBe("gemini");
    expect(row.selected_model).toBe("gemini-pro");
    expect(row.task_classification).toBe(TaskClassification.THINKING);
    expect(row.quota_percent).toBe(85);
    expect(row.probe_status).toBe("fresh");
    expect(row.run_id).toBe(context.runId);
  });

  it("handles model failover and records it (TR-009)", async () => {
    // Mark gemini-pro as failed/in cooldown
    prober.markModelFailure("gemini", "gemini-pro");

    const selection = await selector.selectBackend(context);
    
    expect(selection.backend).toBe("gemini");
    expect(selection.model).toBe("gemini-flash");
    expect(selection.modelFailoverUsed).toBe(true);

    // Verify record
    const row = db.prepare("SELECT * FROM routing_decisions WHERE run_id = ?").get(context.runId) as any;
    expect(row.selected_model).toBe("gemini-flash");
    expect(row.model_failover_used).toBe(1);
  });
});
