import { describe, expect, it, vi, beforeEach } from "vitest";
// @ts-ignore - Module does not exist yet (RED)
import { GeminiAdapter } from "./builtins/agents/gemini/adapter.js";
// @ts-ignore - Module does not exist yet (RED)
import { ClaudeAdapter } from "./builtins/agents/claude/adapter.js";

describe("FR-L1-002 / FR-L1-003 / FR-L1-010 / ADR-006: Agent Backend Adapters", () => {
  describe("Gemini Adapter (FR-L1-010)", () => {
    const adapter = new GeminiAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("gemini");
      expect(dispatch.args).toContain("--yolo");
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
        // This test would mock filesystem or verify the generated string
        const content = await adapter.syncGovernance("/tmp", governance);
        expect(content).toContain("<!-- gwrk:begin -->");
        expect(content).toContain("Rule 1: Always use tabs");
        expect(content).toContain("<!-- gwrk:end -->");
    });
  });
});
