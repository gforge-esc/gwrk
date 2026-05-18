import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkflowRuntime } from "./workflow-runtime.js";
import { dispatchToAgent } from "../utils/agent.js";
import fs from "node:fs";

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("./loader.js", () => ({
  PluginLoader: vi.fn().mockImplementation(() => ({
    resolvePlugin: vi.fn().mockResolvedValue({
      manifest: {
        name: "dummy",
        type: "workflow",
        outputSchema: {
          type: "object",
          required: ["summary", "intents"],
          properties: {
            summary: { type: "string" },
            intents: { type: "array" },
          },
        },
      },
      path: "/fake/path",
    }),
  })),
  PluginNotFoundError: class extends Error {},
}));

describe("WorkflowRuntime (Phase 12) (RED)", () => {
  let runtime: WorkflowRuntime;

  beforeEach(() => {
    runtime = new WorkflowRuntime();
    vi.clearAllMocks();
    (fs.readFileSync as any).mockReturnValue("Mock Prompt");
    (fs.existsSync as any).mockReturnValue(true);
  });

  describe("FR-029: Tolerant JSON extraction", () => {
    it("SHOULD return synthetic success when agent returns prose but commits artifacts natively (RED)", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: "I have created the files.",
        stderr: "",
        durationS: 1,
      });

      // Mock git status or fs to show changes exist
      (fs.readdirSync as any).mockReturnValue(["new.test.ts"]);

      const result = await runtime.executeWorkflow("dummy", "input");
      expect(result.summary).toContain("completed successfully");
      expect(result.intents).toEqual([]);
    });

    it("SHOULD THROW error when agent returns prose, exits 0, but NO artifacts were committed (RED)", async () => {
      (dispatchToAgent as any).mockResolvedValue({
        exitCode: 0,
        stdout: "I did nothing and returned prose.",
        stderr: "",
        durationS: 1,
      });

      // Mock fs to show NO changes
      (fs.readdirSync as any).mockReturnValue([]);

      // Current implementation returns success for ANY exitCode 0.
      // This test should FAIL (RED) until the artifact check is added.
      await expect(runtime.executeWorkflow("dummy", "input")).rejects.toThrow(
        /Expected JSON object/,
      );
    });
  });
});
