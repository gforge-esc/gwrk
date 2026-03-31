import { describe, expect, it, beforeEach } from "vitest";
import { GeminiAdapter } from "./builtins/agents/gemini/adapter.js";
import { ClaudeAdapter } from "./builtins/agents/claude/adapter.js";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("FR-L1-002 / FR-L1-003 / FR-L1-010 / ADR-006: Agent Backend Adapters", () => {
  describe("Gemini Adapter (FR-L1-010)", () => {
    const adapter = new GeminiAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt", workflow: "gwrk-implement.md" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("gemini");
      expect(dispatch.args).toContain("--yolo");
      expect(dispatch.args).toContain("-p");
      expect(dispatch.args).toContain("/gwrk-implement test prompt");
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

    it("FR-L1-003: normalizes Gemini 42 exit code to gwrk 2 (usage_error)", () => {
      const result = adapter.parseResult("", "", 42);
      expect(result.exitCode).toBe(2);
      expect(result.errorType).toBe("usage_error");
    });
  });

  describe("Claude Adapter (FR-L1-010)", () => {
    const adapter = new ClaudeAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("claude");
      expect(dispatch.args).toContain("-p");
      expect(dispatch.args).toContain("test prompt");
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
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
        const governance = "Rule 1: Always use tabs";
        
        await adapter.syncGovernance(tmpDir, governance);
        
        const content = await fs.readFile(path.join(tmpDir, "GEMINI.md"), "utf-8");
        expect(content).toContain("<!-- gwrk:begin -->");
        expect(content).toContain("Rule 1: Always use tabs");
        expect(content).toContain("<!-- gwrk:end -->");
        
        await fs.rm(tmpDir, { recursive: true });
    });

    it("preserves content outside boundary markers", async () => {
        const adapter = new GeminiAdapter();
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
        const filePath = path.join(tmpDir, "GEMINI.md");
        
        const initialContent = "# Header\n\nSome user content.\n\n<!-- gwrk:begin -->\nOLD\n<!-- gwrk:end -->\n\nFooter content.";
        await fs.writeFile(filePath, initialContent, "utf-8");
        
        const governance = "NEW RULE";
        await adapter.syncGovernance(tmpDir, governance);
        
        const finalContent = await fs.readFile(filePath, "utf-8");
        expect(finalContent).toContain("# Header");
        expect(finalContent).toContain("Some user content.");
        expect(finalContent).toContain("Footer content.");
        expect(finalContent).toContain("<!-- gwrk:begin -->\nNEW RULE\n<!-- gwrk:end -->");
        
        await fs.rm(tmpDir, { recursive: true });
    });
  });
});
