/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { execCommand } from "../../../../utils/exec.js";
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

    it("declares the emitsStreamJson capability so the runner renders a transcript", () => {
      expect(adapter.emitsStreamJson).toBe(true);
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
