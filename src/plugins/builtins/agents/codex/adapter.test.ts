/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { CodexAdapter } from "./adapter.js";

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  it("declares nativeWriter = true so ShipOrchestrator recognizes disk edits", () => {
    expect(adapter.nativeWriter).toBe(true);
    expect(adapter.emitsStreamJson).toBe(false);
  });

  it("delivers multi-line or stdin-backed prompts via stdin with '-' arg", async () => {
    const result = await adapter.dispatch({
      agent: "codex",
      prompt: "Line 1\nLine 2",
      stdin: "<command_safety>Rules</command_safety>",
      model: "gpt-5-codex",
    });

    expect(result.command).toBe("codex");
    expect(result.args).toEqual([
      "--ask-for-approval",
      "never",
      "exec",
      "--sandbox",
      "workspace-write",
      "--model",
      "gpt-5-codex",
      "-",
    ]);
    expect(result.stdin).toContain("Line 1\nLine 2");
    expect(result.stdin).toContain("<command_safety>Rules</command_safety>");
  });

  it("normalizes exit codes in parseResult", () => {
    expect(adapter.parseResult("", "command not found", 127)).toMatchObject({
      exitCode: 127,
      errorType: "command_not_found",
    });
    expect(adapter.parseResult("done", "", 0)).toMatchObject({
      exitCode: 0,
      unwrappedStdout: "done",
    });
  });
  it("normalizes JSON results and failed JSONL turns", () => {
    const report = { summary: "GO", intents: [] };
    expect(
      adapter.parseResult(JSON.stringify(report, null, 2), "", 0),
    ).toMatchObject({ status: "success", structuredOutput: report });

    const message = JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: JSON.stringify(report) },
    });
    const terminal = JSON.stringify({ type: "turn.failed" });
    expect(adapter.parseResult(`${message}\n${terminal}`, "", 0)).toMatchObject(
      {
        status: "failure",
        exitCode: 1,
        unwrappedStdout: JSON.stringify(report),
      },
    );
  });
  it("forwards typed effort and records the observed model separately", async () => {
    const adapter = new CodexAdapter();
    const dispatch = await adapter.dispatch({
      effort: "high",
      prompt: "Run checks",
    });
    const [flag, value] = ["-c", 'model_reasoning_effort="high"'];
    const flagIndex = dispatch.args.indexOf(flag);
    expect(flagIndex).toBeGreaterThanOrEqual(0);
    expect(dispatch.args[flagIndex + 1]).toBe(value);
    const stdout = "ok";
    expect(adapter.parseResult(stdout, "", 0).observedModel).toBe("unknown");
  });
});
