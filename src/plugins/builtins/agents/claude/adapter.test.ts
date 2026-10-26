/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { execCommand } from "../../../../utils/exec.js";
import { PluginLoader } from "../../../loader.js";
import { AgyAdapter } from "../agy/adapter.js";
import { ClaudeAdapter } from "./adapter.js";

vi.mock("../../../../utils/exec.js");

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  describe("dispatch()", () => {
    it("emits a stream-json event stream (--output-format stream-json --verbose) for a full run transcript", async () => {
      const result = await adapter.dispatch({
        prompt: "do the thing",
        agent: "claude",
      });

      // stream-json is what makes .runs/*.log a real per-step transcript
      // rather than a single end-of-run blob.
      const fmtIdx = result.args.indexOf("--output-format");
      expect(fmtIdx).toBeGreaterThan(-1);
      expect(result.args[fmtIdx + 1]).toBe("stream-json");
      // Claude Code requires --verbose alongside stream-json in -p mode.
      expect(result.args).toContain("--verbose");
      // The old single-envelope format must be gone.
      expect(result.args).not.toContain("json");
    });

    it("declares emitsStreamJson and nativeWriter capabilities at parity with AgyAdapter", () => {
      const agy = new AgyAdapter();
      expect(adapter.emitsStreamJson).toBe(true);
      expect(adapter.nativeWriter).toBe(true);
      expect(adapter.emitsStreamJson).toBe(agy.emitsStreamJson);
      expect(adapter.nativeWriter).toBe(agy.nativeWriter);
    });

    it("still forwards the output schema via --json-schema when provided", async () => {
      const schema = { type: "object", required: ["summary", "intents"] };
      const result = await adapter.dispatch({
        prompt: "spec it",
        agent: "claude",
        outputSchema: schema,
      });

      const idx = result.args.indexOf("--json-schema");
      expect(idx).toBeGreaterThan(-1);
      expect(JSON.parse(result.args[idx + 1])).toEqual(schema);
    });

    it("still runs with --dangerously-skip-permissions and passes the prompt", async () => {
      const result = await adapter.dispatch({
        prompt: "hello",
        agent: "claude",
      });
      expect(result.command).toBe("claude");
      expect(result.args).toContain("--dangerously-skip-permissions");
      expect(result.args).toContain("-p");
      expect(result.args).toContain("hello");
    });

    it("forwards --model and --effort (CLAUDE_EFFORT / GWRK_EFFORT) at parity with AgyAdapter", async () => {
      const result = await adapter.dispatch({
        prompt: "architect",
        agent: "claude",
        model: "claude-opus-4-6",
        env: { CLAUDE_EFFORT: "high" },
      });

      const modelIdx = result.args.indexOf("--model");
      expect(modelIdx).toBeGreaterThan(-1);
      expect(result.args[modelIdx + 1]).toBe("claude-opus-4-6");

      const effortIdx = result.args.indexOf("--effort");
      expect(effortIdx).toBeGreaterThan(-1);
      expect(result.args[effortIdx + 1]).toBe("high");
    });

    it("omits --model when ModelSelector returns the virtual 'default' sentinel for models: []", async () => {
      const result = await adapter.dispatch({
        prompt: "implement",
        agent: "claude",
        model: "default",
        env: { CLAUDE_MODEL: "default" },
      });
      expect(result.args).not.toContain("--model");
    });
  });

  describe("parseResult() & manifest parity", () => {
    it("normalizes 127 (command_not_found), 126 (permission_denied), and turn_limit / error_max_turns", () => {
      expect(adapter.parseResult("", "", 127)).toMatchObject({
        exitCode: 127,
        errorType: "command_not_found",
      });
      expect(adapter.parseResult("", "", 126)).toMatchObject({
        exitCode: 1,
        errorType: "permission_denied",
      });
      expect(
        adapter.parseResult(
          '{"type":"result","subtype":"error_max_turns"}',
          "",
          1,
        ),
      ).toMatchObject({
        exitCode: 1,
        errorType: "turn_limit",
      });
    });

    it("registers a valid agent manifest in PluginLoader with matching capabilities to agy", async () => {
      const loader = new PluginLoader({ projectDir: process.cwd() });
      const claudePlugin = await loader.resolvePlugin("claude");
      const agyPlugin = await loader.resolvePlugin("agy");

      expect(claudePlugin.manifest.type).toBe("agent");
      expect(claudePlugin.manifest.name).toBe("claude");
      const claudeCaps = (claudePlugin.manifest as any).capabilities as string[];
      const agyCaps = (agyPlugin.manifest as any).capabilities as string[];
      expect(claudeCaps).toEqual(expect.arrayContaining(agyCaps));
    });
  });

  describe("isAvailable()", () => {
    it("returns true if claude is in PATH", async () => {
      vi.mocked(execCommand).mockResolvedValue({
        exitCode: 0,
        stdout: "/usr/local/bin/claude",
        stderr: "",
      });
      expect(await adapter.isAvailable()).toBe(true);
      expect(execCommand).toHaveBeenCalledWith("which", ["claude"]);
    });
  });
});
