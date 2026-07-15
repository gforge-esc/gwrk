/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "./builtins/agents/claude/adapter.js";
import { GeminiAdapter } from "./builtins/agents/gemini/adapter.js";

describe("FR-L1-002 / FR-L1-003 / FR-L1-010 / ADR-006: Agent Backend Adapters", () => {
  describe("Gemini Adapter (FR-L1-010)", () => {
    const adapter = new GeminiAdapter();

    it("US-L1-001: dispatches tasks with correct CLI arguments (FR-L1-002)", async () => {
      const task = { prompt: "test prompt", workflow: "gwrk-implement.md" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.command).toBe("gemini");
      expect(dispatch.args).toContain("--approval-mode");
      expect(dispatch.args).toContain("-p");
      expect(dispatch.args).toContain("/gwrk-implement test prompt");
    });

    it("ADR-006: delivers context via stdin (FR-021)", async () => {
      const task = { stdin: "context data" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.stdin).toBe("context data");
    });

    it("passes --model when GEMINI_MODEL is set in env", async () => {
      const task = {
        prompt: "test",
        env: { GEMINI_MODEL: "gemini-3-flash-preview" },
      };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.args).toContain("--model");
      expect(dispatch.args).toContain("gemini-3-flash-preview");
    });

    it("omits --model when GEMINI_MODEL is not set", async () => {
      const task = { prompt: "test" };
      const dispatch = await adapter.dispatch(task);
      expect(dispatch.args).not.toContain("--model");
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

    it("passes --json-schema to enforce the output contract when task.outputSchema is set", async () => {
      const schema = {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      };
      const dispatch = await adapter.dispatch({ prompt: "p", outputSchema: schema });
      expect(dispatch.args).toContain("--json-schema");
      const idx = dispatch.args.indexOf("--json-schema");
      expect(JSON.parse(dispatch.args[idx + 1])).toEqual(schema);
    });

    it("omits --json-schema when no outputSchema is provided", async () => {
      const dispatch = await adapter.dispatch({ prompt: "p" });
      expect(dispatch.args).not.toContain("--json-schema");
    });
  });

  describe("Governance Sync (FR-L1-004)", () => {
    it("US-L1-002: syncGovernance() generates GEMINI.md with boundary markers", async () => {
      const adapter = new GeminiAdapter();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
      const governance = "Rule 1: Always use tabs";

      await adapter.syncGovernance(tmpDir, governance);

      const content = await fs.readFile(
        path.join(tmpDir, "GEMINI.md"),
        "utf-8",
      );
      expect(content).toContain("<!-- gwrk:begin -->");
      expect(content).toContain("Rule 1: Always use tabs");
      expect(content).toContain("<!-- gwrk:end -->");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("preserves content outside boundary markers", async () => {
      const adapter = new GeminiAdapter();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
      const filePath = path.join(tmpDir, "GEMINI.md");

      const initialContent =
        "# Header\n\nSome user content.\n\n<!-- gwrk:begin -->\nOLD\n<!-- gwrk:end -->\n\nFooter content.";
      await fs.writeFile(filePath, initialContent, "utf-8");

      const governance = "NEW RULE";
      await adapter.syncGovernance(tmpDir, governance);

      const finalContent = await fs.readFile(filePath, "utf-8");
      expect(finalContent).toContain("# Header");
      expect(finalContent).toContain("Some user content.");
      expect(finalContent).toContain("Footer content.");
      expect(finalContent).toContain(
        "<!-- gwrk:begin -->\nNEW RULE\n<!-- gwrk:end -->",
      );

      await fs.rm(tmpDir, { recursive: true });
    });
  });
});
