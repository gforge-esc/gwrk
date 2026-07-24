/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "./builtins/agents/claude/adapter.js";

describe("FR-L1-002 / FR-L1-003 / FR-L1-010 / ADR-006: Agent Backend Adapters", () => {
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
    it("US-L1-002: syncGovernance() generates CLAUDE.md with boundary markers", async () => {
      const adapter = new ClaudeAdapter();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
      const governance = "Rule 1: Always use tabs";

      await adapter.syncGovernance(tmpDir, governance);

      const content = await fs.readFile(
        path.join(tmpDir, "CLAUDE.md"),
        "utf-8",
      );
      expect(content).toContain("<!-- gwrk:begin -->");
      expect(content).toContain("Rule 1: Always use tabs");
      expect(content).toContain("<!-- gwrk:end -->");

      await fs.rm(tmpDir, { recursive: true });
    });

    it("preserves content outside boundary markers", async () => {
      const adapter = new ClaudeAdapter();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "gwrk-test-"));
      const filePath = path.join(tmpDir, "CLAUDE.md");

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
