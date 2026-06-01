import { readFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as agentModule from "../utils/agent.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

vi.mock("../utils/git.js", () => ({
  isDirty: vi.fn(),
  getCurrentCommit: vi.fn().mockReturnValue("abc123"),
  getCurrentBranch: vi.fn().mockReturnValue("develop"),
  getDiffStats: vi
    .fn()
    .mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("WorkflowRuntime Hardening (Phase 12)", () => {
  describe("FR-029: Tolerant JSON extraction", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("SHOULD return synthetic success when agent returns prose (tolerant mode, exit 0)", async () => {
      const mockDispatch = vi.mocked(agentModule.dispatchToAgent);
      mockDispatch.mockResolvedValue({
        exitCode: 0,
        stdout: "I thought about it but decided to do nothing. No JSON here.",
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

      // FR-029: Tolerant mode returns synthetic success when agent returns prose
      // with exit 0, even if no files changed. This is by design — agents
      // that do native work (via tools) won't always produce JSON intents.
      const result = await runtime.executeWorkflow("dummy", "input");
      expect(result.summary).toContain("native execution");
      expect(result.intents).toEqual([]);
    });
  });
});
