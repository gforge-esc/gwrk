import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentBackendConfig } from "./agent-registry.js";
import { ModelSelector } from "./model-selector.js";
import type { QuotaProber } from "./quota-prober.js";
import { TaskClassification, TaskType } from "./task-classifier.js";

describe("ModelSelector", () => {
  let modelSelector: ModelSelector;
  let mockProber: {
    isModelInCooldown: ReturnType<typeof vi.fn>;
  };

  const mockBackend: AgentBackendConfig = {
    name: "gemini",
    type: "local-cli",
    command: "gemini -p --model {{model}}",
    maxConcurrent: 1,
    quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
    models: [
      {
        name: "gemini-3.1-pro-preview",
        tier: TaskClassification.THINKING,
        modelFlag: "gemini-3.1-pro-preview",
      },
      {
        name: "gemini-3-flash-preview",
        tier: TaskClassification.FAST,
        modelFlag: "gemini-3-flash-preview",
      },
    ],
  };

  beforeEach(() => {
    modelSelector = new ModelSelector();
    mockProber = {
      isModelInCooldown: vi.fn().mockReturnValue(false),
    };
  });

  describe("selectModel", () => {
    it("selects thinking model for implement task (TR-008)", () => {
      const { model } = modelSelector.selectModel(
        mockBackend,
        TaskClassification.THINKING,
        TaskType.IMPLEMENT,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.name).toBe("gemini-3.1-pro-preview");
    });

    it("selects fast model for test task (TR-008)", () => {
      const { model } = modelSelector.selectModel(
        mockBackend,
        TaskClassification.FAST,
        TaskType.TEST,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.name).toBe("gemini-3-flash-preview");
    });

    it("selects high-context model for define task (TR-008)", () => {
      const backendWithHighContext = {
        ...mockBackend,
        models: [
          ...mockBackend.models,
          {
            name: "gemini-1.5-pro",
            tier: TaskClassification.HIGH_CONTEXT,
            modelFlag: "high-context",
          },
        ],
      };
      const { model } = modelSelector.selectModel(
        backendWithHighContext,
        TaskClassification.HIGH_CONTEXT,
        TaskType.DEFINE,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.name).toBe("gemini-1.5-pro");
    });

    it("uses reviewModel override for review tasks (FR-011)", () => {
      const backendWithReview = {
        ...mockBackend,
        reviewModel: "gemini-review-flag",
      };
      const { model } = modelSelector.selectModel(
        backendWithReview,
        TaskClassification.THINKING,
        TaskType.REVIEW,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.modelFlag).toBe("gemini-review-flag");
    });

    it("handles model failover if preferred is in cooldown (FR-009)", () => {
      mockProber.isModelInCooldown.mockImplementation(
        (_backend: string, model: string) => {
          return model === "gemini-3.1-pro-preview";
        },
      );

      const { model, modelFailoverUsed } = modelSelector.selectModel(
        mockBackend,
        TaskClassification.THINKING,
        TaskType.IMPLEMENT,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.name).toBe("gemini-3-flash-preview");
      expect(modelFailoverUsed).toBe(true);
    });

    it("sets modelFailoverUsed to true for intra-tier failover (FR-009)", () => {
      const backendWithTwoPro = {
        ...mockBackend,
        models: [
          {
            name: "pro-1",
            tier: TaskClassification.THINKING,
            modelFlag: "pro-1",
          },
          {
            name: "pro-2",
            tier: TaskClassification.THINKING,
            modelFlag: "pro-2",
          },
        ],
      };
      mockProber.isModelInCooldown.mockImplementation(
        (_backend: string, model: string) => {
          return model === "pro-1";
        },
      );

      const { model, modelFailoverUsed } = modelSelector.selectModel(
        backendWithTwoPro,
        TaskClassification.THINKING,
        TaskType.IMPLEMENT,
        mockProber as unknown as QuotaProber,
      );
      expect(model?.name).toBe("pro-2");
      expect(modelFailoverUsed).toBe(true);
    });

    it("returns null if ALL models are in cooldown", () => {
      mockProber.isModelInCooldown.mockReturnValue(true);

      const { model } = modelSelector.selectModel(
        mockBackend,
        TaskClassification.THINKING,
        TaskType.IMPLEMENT,
        mockProber as unknown as QuotaProber,
      );
      expect(model).toBeNull();
    });
  });

  describe("renderCommand", () => {
    it("injects model flag into template (TR-010)", () => {
      const model = mockBackend.models[0];
      const command = modelSelector.renderCommand(mockBackend.command, model);
      expect(command).toBe("gemini -p --model gemini-3.1-pro-preview");
    });

    it("replaces multiple occurrences of {{model}} (TR-010)", () => {
      const model = mockBackend.models[0];
      const template = "agent --model {{model}} --retry-model {{model}}";
      const command = modelSelector.renderCommand(template, model);
      expect(command).toBe(
        "agent --model gemini-3.1-pro-preview --retry-model gemini-3.1-pro-preview",
      );
    });

    it("appends effort flag if present (FR-011)", () => {
      const modelWithEffort = { ...mockBackend.models[0], effort: "max" };
      const command = modelSelector.renderCommand(
        mockBackend.command,
        modelWithEffort,
      );
      expect(command).toBe(
        "gemini -p --model gemini-3.1-pro-preview --effort max",
      );
    });
  });
});
