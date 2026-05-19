import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkflowRuntime } from "./workflow-runtime.js";
import * as agentModule from "../utils/agent.js";
import { readFile } from "node:fs/promises";

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("WorkflowRuntime (Phase 12)", () => {
  describe("FR-029: Tolerant JSON extraction", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("SHOULD return synthetic success when agent returns prose but commits artifacts natively", async () => {
      const mockDispatch = vi.mocked(agentModule.dispatchToAgent);
      mockDispatch.mockResolvedValue({
        exitCode: 0,
        stdout: "I have updated the files natively. No JSON here.",
        stderr: "",
        logPath: "/tmp/log",
      });

      const mockReadFile = vi.mocked(readFile);
      mockReadFile.mockResolvedValue("Mock Prompt");

      const mockLoader = {
        resolvePlugin: vi.fn().mockResolvedValue({
          path: "/tmp/plugin",
          manifest: {
            name: "dummy",
            type: "workflow",
            outputSchema: { type: "object", required: ["summary", "intents"] },
          },
        }),
      };

      const runtime = new WorkflowRuntime(mockLoader as any);
      const result = await runtime.executeWorkflow("dummy", "input");

      expect(result.summary).toContain("Agent completed successfully (native execution, no JSON intents)");
      expect(result.intents).toEqual([]);
    });
  });
});
