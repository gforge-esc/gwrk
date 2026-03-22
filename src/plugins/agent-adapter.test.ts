import { describe, expect, it, vi, beforeEach } from "vitest";
import { GeminiAdapter } from "./builtins/agents/gemini/adapter.js";
import { ClaudeAdapter } from "./builtins/agents/claude/adapter.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

vi.mock("node:fs/promises");

describe("FR-L1-002 / FR-L1-003 / FR-L1-010 / ADR-006: Agent Backend Adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Gemini Adapter (FR-L1-010)", () => {
    const adapter = new GeminiAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("gemini");
      expect(dispatch.args).toContain("--approval-mode");
      expect(dispatch.args).toContain("-p");
    });

    it("ADR-006: delivers context via stdin (FR-021)", async () => {
        const task = { stdin: "context data" };
        const dispatch = await adapter.dispatch(task);
        expect(dispatch.stdin).toBe("context data");
    });

    it("FR-L1-003: normalizes Gemini 53 exit code to gwrk 1 (turn_limit)", () => {
      const result = adapter.parseResult("", "", 53);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBe("turn_limit");
    });
  });

  describe("Claude Adapter (FR-L1-010)", () => {
    const adapter = new ClaudeAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("claude");
      expect(dispatch.args).toContain("-p");
    });

    it("FR-L1-003: normalizes Claude 126 exit code to gwrk 1 (permission_denied)", () => {
      const result = adapter.parseResult("", "", 126);
      expect(result.exitCode).toBe(1);
      expect(result.errorType).toBe("permission_denied");
    });
  });

  describe("Governance Sync (FR-L1-004)", () => {
    it("US-L1-002: syncGovernance() generates GEMINI.md with boundary markers", async () => {
        const adapter = new GeminiAdapter();
        const governance = "Rule 1: Always use tabs";
        
        vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
        vi.mocked(fs.writeFile).mockResolvedValue(undefined);

        await adapter.syncGovernance("/fake/root", governance);
        
        const [filePath, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
        expect(filePath).toBe(path.join("/fake/root", "GEMINI.md"));
        expect(content).toContain("<!-- gwrk:begin -->");
        expect(content).toContain("Rule 1: Always use tabs");
        expect(content).toContain("<!-- gwrk:end -->");
    });

    it("US-L1-002: syncGovernance() preserves content outside boundary markers", async () => {
        const adapter = new GeminiAdapter();
        const governance = "New Rule";
        const existingContent = "User addition\n<!-- gwrk:begin -->\nOld Rule\n<!-- gwrk:end -->\nAnother addition";
        
        vi.mocked(fs.readFile).mockResolvedValue(existingContent);
        vi.mocked(fs.writeFile).mockResolvedValue(undefined);

        await adapter.syncGovernance("/fake/root", governance);
        
        const [, content] = vi.mocked(fs.writeFile).mock.calls[0] as [string, string];
        expect(content).toContain("User addition");
        expect(content).toContain("Another addition");
        expect(content).toContain("New Rule");
        expect(content).not.toContain("Old Rule");
    });
  });
});
