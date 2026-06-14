import { describe, expect, it } from "vitest";
import { TaskClassification, classifyTask, TaskType } from "../server/task-classifier.js";
import type { AgentBackendConfig, ModelEntry } from "../server/agent-registry.js";
import { ModelSelector } from "../server/model-selector.js";

/**
 * Model Tier Routing Tests
 *
 * Validates that:
 * - define (spec, plan, tests) → THINKING tier → selects thinking models
 * - implement/ship → FAST tier → selects fast models
 * - review → THINKING tier → selects thinking models
 *
 * These are the semantic contracts gwrk enforces:
 *   "Define should be using thinking models. Ship should be using fast models."
 */

// Mock backend config that mirrors .gwrkrc.json structure
const mockBackend: AgentBackendConfig = {
  name: "gemini",
  type: "local-cli",
  command: "gemini",
  discoveryMethod: "manual",
  quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
  maxConcurrent: 2,
  models: [
    { name: "gemini-3-flash-preview", tier: TaskClassification.FAST },
    { name: "gemini-3.1-flash-lite-preview", tier: TaskClassification.FAST },
    { name: "gemini-3.1-pro-preview", tier: TaskClassification.THINKING },
    { name: "gemini-2.5-pro", tier: TaskClassification.HIGH_CONTEXT },
    { name: "gemini-2.5-flash", tier: TaskClassification.FAST },
  ],
};

// Mock prober that reports no cooldowns
const mockProber = {
  isModelInCooldown: () => false,
  probeQuota: async () => ({ percent: 100, status: "available" as const }),
};

describe("Model Tier Routing", () => {
  const selector = new ModelSelector();

  describe("define → thinking model", () => {
    it("classifies all define sub-stages as THINKING", () => {
      // The classifier should map "define" to THINKING
      expect(classifyTask(TaskType.DEFINE)).toBe(TaskClassification.THINKING);
      expect(classifyTask("define")).toBe(TaskClassification.THINKING);
    });

    it("selects a thinking-tier model for define tasks", () => {
      const classification = classifyTask(TaskType.DEFINE);
      const { model } = selector.selectModel(
        mockBackend,
        classification,
        TaskType.DEFINE,
        mockProber as any,
      );
      expect(model).not.toBeNull();
      expect(model!.tier).toBe(TaskClassification.THINKING);
      expect(model!.name).toBe("gemini-3.1-pro-preview");
    });
  });

  describe("implement → fast model", () => {
    it("classifies implement as FAST", () => {
      expect(classifyTask(TaskType.IMPLEMENT)).toBe(TaskClassification.FAST);
    });

    it("selects a fast-tier model for implement tasks", () => {
      const classification = classifyTask(TaskType.IMPLEMENT);
      const { model } = selector.selectModel(
        mockBackend,
        classification,
        TaskType.IMPLEMENT,
        mockProber as any,
      );
      expect(model).not.toBeNull();
      expect(model!.tier).toBe(TaskClassification.FAST);
    });
  });

  describe("review → thinking model", () => {
    it("classifies review as THINKING", () => {
      expect(classifyTask(TaskType.REVIEW)).toBe(TaskClassification.THINKING);
    });

    it("selects a thinking-tier model for review tasks", () => {
      const classification = classifyTask(TaskType.REVIEW);
      const { model } = selector.selectModel(
        mockBackend,
        classification,
        TaskType.REVIEW,
        mockProber as any,
      );
      expect(model).not.toBeNull();
      expect(model!.tier).toBe(TaskClassification.THINKING);
    });
  });

  describe("remediation → fast model", () => {
    it("classifies remediation as FAST", () => {
      expect(classifyTask(TaskType.REMEDIATION)).toBe(TaskClassification.FAST);
    });

    it("selects a fast-tier model for remediation tasks", () => {
      const classification = classifyTask(TaskType.REMEDIATION);
      const { model } = selector.selectModel(
        mockBackend,
        classification,
        TaskType.REMEDIATION,
        mockProber as any,
      );
      expect(model).not.toBeNull();
      expect(model!.tier).toBe(TaskClassification.FAST);
    });
  });
});
