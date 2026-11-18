/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { execCommand } from "../../../../utils/exec.js";
import { AgyAdapter } from "./adapter.js";

vi.mock("../../../../utils/exec.js");
vi.mock("node:fs/promises");

describe("AgyAdapter", () => {
  const adapter = new AgyAdapter();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true if agy is in PATH", async () => {
      vi.mocked(execCommand).mockResolvedValue({
        exitCode: 0,
        stdout: "/usr/local/bin/agy",
        stderr: "",
      });
      const available = await adapter.isAvailable();
      expect(available).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("which", ["agy"]);
    });

    it("returns false if agy is not in PATH", async () => {
      vi.mocked(execCommand).mockResolvedValue({
        exitCode: 1,
        stdout: "",
        stderr: "agy not found",
      });
      const available = await adapter.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe("syncGovernance", () => {
    it("creates AGENTS.md with markers if it doesn't exist", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await adapter.syncGovernance("/project", "Rule 1\nRule 2");

      expect(result).toContain("<!-- gwrk:begin -->");
      expect(result).toContain("Rule 1\nRule 2");
      expect(result).toContain("<!-- gwrk:end -->");
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("AGENTS.md"),
        expect.any(String),
        "utf-8",
      );
    });

    it("updates existing markers in AGENTS.md", async () => {
      const existing =
        "# Header\n<!-- gwrk:begin -->\nOld Rules\n<!-- gwrk:end -->\nFooter";
      vi.mocked(fs.readFile).mockResolvedValue(existing);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await adapter.syncGovernance("/project", "New Rules");

      expect(result).toBe(
        "# Header\n<!-- gwrk:begin -->\nNew Rules\n<!-- gwrk:end -->\nFooter",
      );
    });
  });

  describe("dispatch", () => {
    it("formats headless CLI flags with stream-json output", async () => {
      const result = await adapter.dispatch({
        workflow: "plan",
        featureDir: "specs/001-cli-core",
        prompt: "Generate a plan",
        agent: "agy",
      });

      expect(adapter.emitsStreamJson).toBe(true);
      expect(result.command).toBe("agy");
      expect(result.args).toEqual([
        "-p",
        "/plan specs/001-cli-core Generate a plan",
        "--output-format",
        "stream-json",
        "--dangerously-skip-permissions",
      ]);
    });

    it("omits --model flag for legacy 1.5/2.0 model names (FR-004)", async () => {
      const result = await adapter.dispatch({
        prompt: "Test",
        model: "gemini-1.5-pro",
        agent: "agy",
      });

      expect(result.args).not.toContain("--model");
      expect(result.args).not.toContain("gemini-1.5-pro");
    });

    it("passes --model and --json-schema when Antigravity 2.0 model and outputSchema are provided", async () => {
      const schema = {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      };
      const result = await adapter.dispatch({
        prompt: "Implement T001",
        model: "gemini-4-argon-high",
        outputSchema: schema,
        env: { AGY_EFFORT: "high" },
        agent: "agy",
      });

      expect(result.args).toContain("--json-schema");
      expect(result.args).toContain(JSON.stringify(schema));
      expect(result.args).toContain("--model");
      expect(result.args).toContain("gemini-4-argon-high");
      expect(result.args).toContain("--effort");
      expect(result.args).toContain("high");
    });

    it("does not append positional 'false' token for write workflows", async () => {
      const result = await adapter.dispatch({
        workflow: "gwrk-implement",
        prompt: "Run unsandboxed",
        agent: "agy",
      });

      expect(result.args).not.toContain("--sandbox");
      expect(result.args).not.toContain("false");
    });

    it("delivers expanded multi-line prompts via stdin without slash-command prefix", async () => {
      const result = await adapter.dispatch({
        workflow: "gwrk-plan",
        featureDir: "specs/031-unified-agent-port",
        prompt:
          "# Workflow Prompt\nStep 1: Read spec.md\nStep 2: Write plan.md",
        stdin: "<command_safety>Rules</command_safety>",
        model: "claude-sonnet-4-6",
        agent: "agy",
      });

      expect(result.args).toContain("-p");
      expect(result.args).toContain(
        "Execute gwrk-plan instructions from stdin",
      );
      expect(result.args).toContain("--model");
      expect(result.args).toContain("claude-sonnet-4-6");
      expect(result.stdin).toContain("# Workflow Prompt");
      expect(result.stdin).toContain("<command_safety>Rules</command_safety>");
      expect(result.stdin).not.toContain("/gwrk-plan");
    });

    it("unwraps stream-json output and detects turn_limit in parseResult", () => {
      const stream = [
        JSON.stringify({
          type: "assistant",
          message: { content: [{ type: "text", text: "Partial" }] },
        }),
        JSON.stringify({
          type: "result",
          result: "Final Answer",
          structured_output: { ok: true },
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ].join("\n");

      const parsed = adapter.parseResult(stream, "", 0);
      expect(parsed.unwrappedStdout).toBe("Final Answer");
      expect(parsed.structuredOutput).toEqual({ ok: true });
      expect(parsed.usage).toEqual({
        tokensIn: 100,
        tokensOut: 50,
        costUsd: undefined,
      });

      const turnLimit = adapter.parseResult(
        '{"type":"result","subtype":"error_max_turns"}',
        "",
        1,
      );
      expect(turnLimit.errorType).toBe("turn_limit");
    });
  });
  it("unwraps the observed Antigravity result event and rejects failed terminal status", () => {
    const adapter = new AgyAdapter();
    const stdout = JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: '{"summary":"Assessment","intents":[]}',
        usage: { input_tokens: 12, output_tokens: 8 },
      },
    });
    const result = adapter.parseResult(stdout, "", 0);
    expect(result.unwrappedStdout).toBe(
      '{"summary":"Assessment","intents":[]}',
    );
    expect(result.usage?.tokensIn).toBe(12);
    expect(
      adapter.parseResult(
        JSON.stringify({
          event: "result",
          result: { status: "FAILED", response: "Incomplete" },
        }),
        "",
        0,
      ).exitCode,
    ).toBe(1);
  });
  it("rejects a failed terminal without response even after a success payload", () => {
    const adapter = new AgyAdapter();
    const stdout = [
      { event: "result", result: { status: "SUCCESS", response: "GO" } },
      {
        event: "result",
        result: {
          status: "ERROR",
          error: "Your AI credits balance is too low to continue.",
        },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n");

    expect(adapter.parseResult(stdout, "", 0)).toMatchObject({
      status: "failure",
      errorType: "rate_limit",
      exitCode: 1,
      unwrappedStdout: "GO",
    });
  });
});
