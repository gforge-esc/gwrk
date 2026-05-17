import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getTestDb } from "../db/index.js";
import type { AgentRegistry } from "./agent-registry.js";
import { BackendSelector, type TaskContext } from "./backend-selector.js";
import { TaskClassification, TaskType } from "./task-classifier.js";

// Mock recordDecision to avoid DB side effects in non-db tests
vi.mock("./routing-decisions.js", () => ({
  recordDecision: vi.fn(),
}));

vi.mock("../db/index.js", async () => {
  const actual = (await vi.importActual("../db/index.js")) as any;
  return {
    ...actual,
    getDb: vi.fn(),
  };
});

describe("BackendSelector", () => {
  let mockRegistry: AgentRegistry;
  let mockProber: any;
  let selector: BackendSelector;
  let db: any;

  const context: TaskContext = {
    runId: "run-123",
    feature: "feat-1",
    phase: "phase-1",
    taskType: TaskType.IMPLEMENT,
    language: "typescript",
    taskSP: 3,
  };

  beforeEach(() => {
    db = getTestDb();
    (getDb as any).mockReturnValue(db);

    mockRegistry = {
      backends: {
        codex: {
          name: "codex",
          type: "local-cli",
          command: "codex --model {{model}}",
          maxConcurrent: 1,
          quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
          models: [
            {
              name: "gpt-5",
              tier: TaskClassification.THINKING,
              modelFlag: "gpt-5",
            },
          ],
        },
        gemini: {
          name: "gemini",
          type: "local-cli",
          command: "gemini --model {{model}}",
          maxConcurrent: 1,
          quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
          models: [
            {
              name: "gemini-pro",
              tier: TaskClassification.THINKING,
              modelFlag: "gemini-pro",
            },
          ],
        },
        claude: {
          name: "claude",
          type: "local-cli",
          command: "claude --model {{model}}",
          maxConcurrent: 1,
          quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
          models: [
            {
              name: "claude-3",
              tier: TaskClassification.THINKING,
              modelFlag: "claude-3",
            },
          ],
        },
      },
      fallbackOrder: ["codex", "gemini", "claude"],
    };

    mockProber = {
      probeQuota: vi.fn().mockImplementation(async (backend) => {
        return {
          percent: 100,
          status: "fresh",
          probedAt: new Date().toISOString(),
          resetsIn: "unknown",
        };
      }),
      isModelInCooldown: vi.fn().mockReturnValue(false),
    };

    selector = new BackendSelector(mockRegistry, mockProber);
  });

  it("selects backend with highest quota (TR-001)", async () => {
    mockProber.probeQuota.mockImplementation(async (backend) => {
      if (backend.name === "codex") return { percent: 10, status: "fresh" };
      if (backend.name === "gemini") return { percent: 80, status: "fresh" };
      if (backend.name === "claude") return { percent: 50, status: "fresh" };
      return { percent: 100 };
    });

    const selection = await selector.selectBackend(context);
    expect(selection.backend).toBe("gemini");
    expect(selection.quotaPercent).toBe(80);
  });

  it("falls back to next provider if primary is exhausted (TR-002)", async () => {
    mockProber.probeQuota.mockImplementation(async (backend) => {
      if (backend.name === "codex") return { percent: 0, status: "fresh" };
      if (backend.name === "gemini") return { percent: 80, status: "fresh" };
      if (backend.name === "claude") return { percent: 70, status: "fresh" };
      return { percent: 0 };
    });

    const selection = await selector.selectBackend(context);
    expect(selection.backend).toBe("gemini"); // Gemini has 80%, highest available
  });

  it("tiebreaks by historical success rate if quotas are similar (TR-004)", async () => {
    mockProber.probeQuota.mockImplementation(async (backend) => {
      if (backend.name === "codex") return { percent: 90, status: "fresh" };
      if (backend.name === "gemini") return { percent: 95, status: "fresh" }; // Within 20%
      return { percent: 100 };
    });

    // Seed history: codex has 100% success, gemini has 0%
    db.prepare(
      "INSERT INTO projects (id, name, path) VALUES ('p1', 'p1', '/tmp')",
    ).run();
    db.prepare(
      "INSERT INTO runs (feature_id, agent_backend, exit_code, command) VALUES ('f1', 'codex', 0, 'cmd')",
    ).run();
    db.prepare(
      "INSERT INTO runs (feature_id, agent_backend, exit_code, command) VALUES ('f1', 'gemini', 1, 'cmd')",
    ).run();

    const selection = await selector.selectBackend(context);
    expect(selection.backend).toBe("codex"); // Codex preferred due to better history
  });

  it("handles model failover within provider (TR-009)", async () => {
    mockRegistry.backends.gemini.models = [
      {
        name: "gemini-flash",
        tier: TaskClassification.FAST,
        modelFlag: "flash",
      },
      {
        name: "gemini-pro",
        tier: TaskClassification.THINKING,
        modelFlag: "pro",
      },
    ];

    mockProber.probeQuota.mockImplementation(async (backend) => {
      if (backend.name === "gemini") return { percent: 100, status: "fresh" };
      return { percent: 0 };
    });

    // Mock flash in cooldown
    mockProber.isModelInCooldown.mockImplementation((backend, model) => {
      return model === "gemini-flash";
    });

    const selection = await selector.selectBackend({
      ...context,
      taskType: TaskType.TEST,
    });
    expect(selection.backend).toBe("gemini");
    expect(selection.model).toBe("gemini-pro");
    expect(selection.modelFailoverUsed).toBe(true);
  });

  it("exits if no backends have quota", async () => {
    mockProber.probeQuota.mockReturnValue(Promise.resolve({ percent: 0 }));
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });

    await expect(selector.selectBackend(context)).rejects.toThrow("exit");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
