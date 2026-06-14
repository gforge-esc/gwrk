import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveModelForTask } from "./resolve-model.js";

// Mock loadRegistry to return a controlled backend config
vi.mock("../server/agent-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/agent-registry.js")>();
  return {
    ...actual,
    loadRegistry: vi.fn(() => ({
      backends: {
        gemini: {
          name: "gemini",
          type: "local-cli" as const,
          command: "gemini",
          quotaProbe: { method: "optimistic" as const, cacheTTLMinutes: 5 },
          maxConcurrent: 2,
          models: [
            { name: "gemini-3-flash-preview", tier: "fast" },
            { name: "gemini-3.1-pro-preview", tier: "thinking" },
            { name: "gemini-2.5-pro", tier: "high-context" },
          ],
        },
      },
      fallbackOrder: ["gemini"],
    })),
  };
});

describe("resolveModelForTask", () => {
  it("selects a thinking-tier model for define tasks", () => {
    const model = resolveModelForTask("define", "gemini", "/fake/project");
    expect(model).toBe("gemini-3.1-pro-preview");
  });

  it("selects a fast-tier model for implement tasks", () => {
    const model = resolveModelForTask("implement", "gemini", "/fake/project");
    expect(model).toBe("gemini-3-flash-preview");
  });

  it("selects a thinking-tier model for review tasks", () => {
    const model = resolveModelForTask("review", "gemini", "/fake/project");
    expect(model).toBe("gemini-3.1-pro-preview");
  });

  it("selects a fast-tier model for remediation tasks", () => {
    const model = resolveModelForTask("remediation", "gemini", "/fake/project");
    expect(model).toBe("gemini-3-flash-preview");
  });

  it("returns undefined for unknown backend", () => {
    const model = resolveModelForTask("define", "nonexistent", "/fake/project");
    expect(model).toBeUndefined();
  });
});
