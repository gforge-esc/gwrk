/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { renderStreamEvent, formatResultError, renderStreamStdoutLine } from "./agent-log.js";

describe("renderStreamEvent", () => {
  it("renders a session init line with the model", () => {
    const line = renderStreamEvent({
      type: "system",
      subtype: "init",
      model: "claude-opus-4-8",
      tools: ["Bash", "Write"],
    });
    expect(line).toContain("session");
    expect(line).toContain("claude-opus-4-8");
  });

  it("renders assistant narration text", () => {
    const line = renderStreamEvent({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Reworking the spec now." }] },
    });
    expect(line).toContain("Reworking the spec now.");
  });

  it("renders a Bash tool call with its command", () => {
    const line = renderStreamEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run build" } }],
      },
    });
    expect(line).toContain("Bash");
    expect(line).toContain("npm run build");
  });

  it("summarizes a Write tool call by path and size, not full content", () => {
    const big = "x".repeat(84055);
    const line = renderStreamEvent({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "t2", name: "Write", input: { file_path: "specs/008/spec.md", content: big } }],
      },
    });
    expect(line).toContain("Write");
    expect(line).toContain("specs/008/spec.md");
    expect(line).toContain("84055");
    // Must NOT inline 84k of content into the transcript line.
    expect(line!.length).toBeLessThan(200);
  });

  it("renders a successful tool result as a truncated preview", () => {
    const line = renderStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "build succeeded", is_error: false }],
      },
    });
    expect(line).toContain("build succeeded");
  });

  it("marks a failed tool result", () => {
    const line = renderStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "command not found", is_error: true }],
      },
    });
    expect(line).toContain("command not found");
    expect(line).toMatch(/✗|error|ERROR/);
  });

  it("indents continuation lines of a multi-line tool result under the marker", () => {
    const line = renderStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "line-one\nline-two", is_error: false }],
      },
    });
    const rows = line!.split("\n");
    expect(rows[0]).toContain("↳");
    expect(rows[0]).toContain("line-one");
    // Continuation aligned under the ↳, not flush-left (readability in the log).
    expect(rows[1]).toBe("    line-two");
  });

  it("truncates very long tool results but marks the truncation", () => {
    const huge = "line\n".repeat(5000);
    const line = renderStreamEvent({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: huge, is_error: false }],
      },
    });
    expect(line!.length).toBeLessThan(huge.length);
    expect(line).toMatch(/truncat/i);
  });

  it("renders a successful result event with turns and duration", () => {
    const line = renderStreamEvent({
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 851_000,
      num_turns: 42,
      total_cost_usd: 0.42,
    });
    expect(line).toMatch(/success|✓/);
    expect(line).toContain("42");
    expect(line).toContain("14m"); // 851000ms ≈ 14m 11s
  });

  it("renders an error result event with its subtype", () => {
    const line = renderStreamEvent({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      num_turns: 100,
    });
    expect(line).toMatch(/✗|error/i);
    expect(line).toContain("error_max_turns");
  });

  it("returns null for unknown event types so the caller can fall back to raw", () => {
    expect(renderStreamEvent({ type: "totally_new_event", foo: 1 })).toBeNull();
  });

  it("returns null for non-object / non-event input", () => {
    expect(renderStreamEvent("just a string")).toBeNull();
    expect(renderStreamEvent(null)).toBeNull();
    expect(renderStreamEvent(42)).toBeNull();
  });
});

describe("formatResultError", () => {
  it("returns a concise error summary for a failed result event", () => {
    const summary = formatResultError({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      result: "Ran out of turns before finishing.",
    });
    expect(summary).toContain("error_max_turns");
    expect(summary).toContain("Ran out of turns");
  });

  it("returns null for a successful result event", () => {
    expect(
      formatResultError({ type: "result", subtype: "success", is_error: false, result: "ok" }),
    ).toBeNull();
  });

  it("returns null for non-result events", () => {
    expect(formatResultError({ type: "assistant" })).toBeNull();
  });
});

describe("renderStreamStdoutLine", () => {
  it("mirrors the raw line to the sidecar and renders the transcript for a known event", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "hello there" }] },
    });
    const out = renderStreamStdoutLine(line);
    expect(out.jsonl).toBe(line); // lossless sidecar keeps the exact raw line
    expect(out.log).toContain("hello there");
    expect(out.resultEvent).toBeUndefined();
  });

  it("reports the terminal result event so the runner can surface errors", () => {
    const line = JSON.stringify({
      type: "result",
      subtype: "error_max_turns",
      is_error: true,
      num_turns: 100,
    });
    const out = renderStreamStdoutLine(line);
    expect(out.jsonl).toBe(line);
    expect(out.resultEvent).toMatchObject({ type: "result", subtype: "error_max_turns" });
  });

  it("falls back to the raw line for an unknown event type (nothing dropped)", () => {
    const line = JSON.stringify({ type: "brand_new_event", data: 1 });
    const out = renderStreamStdoutLine(line);
    expect(out.jsonl).toBe(line);
    expect(out.log).toBe(line);
    expect(out.resultEvent).toBeUndefined();
  });

  it("passes non-JSON lines through verbatim to both sidecar and transcript", () => {
    const line = "warning: something non-JSON on stdout";
    const out = renderStreamStdoutLine(line);
    expect(out.jsonl).toBe(line);
    expect(out.log).toBe(line);
    expect(out.resultEvent).toBeUndefined();
  });
});
