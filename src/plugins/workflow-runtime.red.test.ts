import { describe, expect, it, vi, beforeEach } from "vitest";
import { WorkflowRuntime } from "./workflow-runtime.js";
import * as agentModule from "../utils/agent.js";
import * as gitModule from "../utils/git.js";
import { readFile } from "node:fs/promises";

vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn(),
}));

vi.mock("../utils/git.js", () => ({
  isDirty: vi.fn(),
  getCurrentCommit: vi.fn().mockReturnValue("abc123"),
  getCurrentBranch: vi.fn().mockReturnValue("develop"),
  getDiffStats: vi.fn().mockReturnValue({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("WorkflowRuntime Hardening (Phase 12 RED)", () => {
  describe("FR-029: Strict Tolerant JSON extraction", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("SHOULD throw if agent returns prose AND no files were changed (no native work detected)", async () => {
      const mockDispatch = vi.mocked(agentModule.dispatchToAgent);
      mockDispatch.mockResolvedValue({
        exitCode: 0,
        stdout: "I thought about it but decided to do nothing. No JSON here.",
        stderr: "",
        logPath: "/tmp/log",
      });

      const mockIsDirty = vi.mocked(gitModule.isDirty);
      mockIsDirty.mockResolvedValue(false); // NO WORK DETECTED

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
      
      // This SHOULD throw because no JSON was found AND no filesystem changes occurred.
      // Currently, it returns success (this is the RED state).
      await expect(runtime.executeWorkflow("dummy", "input")).rejects.toThrow("Expected JSON object in agent output");
    });
  });
});
