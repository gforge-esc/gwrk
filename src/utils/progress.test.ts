/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startProgress } from "./progress.js";

/** Collect every write so assertions can inspect the raw byte stream. */
function recorder() {
  const chunks: string[] = [];
  return {
    chunks,
    write: (s: string) => {
      chunks.push(s);
    },
    get text() {
      return chunks.join("");
    },
  };
}

describe("startProgress on a TTY", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repaints one carriage-returned frame per tick", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: true,
      frameMs: 200,
    });

    vi.advanceTimersByTime(600);
    p.stop();

    // 3 frames + the clear on stop
    expect(out.chunks).toHaveLength(4);
    expect(out.chunks[0]).toMatch(/^\r/);
    expect(out.chunks[0]).toContain("agent running");
  });

  it("never emits a newline while animating", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: true,
      frameMs: 200,
    });

    vi.advanceTimersByTime(2000);
    p.stop();

    expect(out.text).not.toContain("\n");
  });

  it("clears the spinner line when stopped", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: true,
      frameMs: 200,
    });

    vi.advanceTimersByTime(400);
    p.stop();

    expect(out.chunks.at(-1)).toBe("\r\x1b[K");
  });
});

describe("startProgress when stdout is not a TTY", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing at the animation cadence", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(59_000);
    p.stop();

    expect(out.chunks).toHaveLength(0);
  });

  it("never emits a carriage return", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(10 * 60_000);
    p.stop();

    expect(out.text).not.toContain("\r");
  });

  it("emits one newline-terminated heartbeat per interval", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(5 * 60_000);
    p.stop();

    expect(out.chunks).toHaveLength(5);
    for (const chunk of out.chunks) {
      expect(chunk.endsWith("\n")).toBe(true);
    }
    expect(out.chunks[0]).toContain("agent running");
  });

  it("reports elapsed wall clock in each heartbeat", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(3 * 60_000);
    p.stop();

    expect(out.chunks[0]).toContain("1m 0s");
    expect(out.chunks[2]).toContain("3m 0s");
  });

  it("writes no escape sequence when stopped", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(60_000);
    const before = out.chunks.length;
    p.stop();

    expect(out.chunks).toHaveLength(before);
  });

  // The incident this fix exists for: a 68-minute UAT_REVIEW redirected to a
  // file left 20,284 spinner frames — ~92% of a 774 KB log — because `\r`
  // overwrites nothing in a file.
  it("keeps a 68-minute run to minutes of lines, not thousands of frames", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: false,
      frameMs: 200,
      heartbeatMs: 60_000,
    });

    vi.advanceTimersByTime(68 * 60_000);
    p.stop();

    expect(out.chunks).toHaveLength(68);
    expect(out.text.length).toBeLessThan(4000);
  });
});

describe("startProgress lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing more after stop()", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: true,
      frameMs: 200,
    });

    vi.advanceTimersByTime(400);
    p.stop();
    const after = out.chunks.length;
    vi.advanceTimersByTime(10_000);

    expect(out.chunks).toHaveLength(after);
  });

  it("is idempotent across repeated stop() calls", () => {
    const out = recorder();
    const p = startProgress({
      label: "agent running",
      write: out.write,
      isTTY: true,
      frameMs: 200,
    });

    vi.advanceTimersByTime(400);
    p.stop();
    const after = out.chunks.length;
    p.stop();

    expect(out.chunks).toHaveLength(after);
  });

  it("applies the caller's indent to the label", () => {
    const out = recorder();
    const p = startProgress({
      label: "waiting for CI",
      write: out.write,
      isTTY: false,
      heartbeatMs: 60_000,
      indent: "    ",
    });

    vi.advanceTimersByTime(60_000);
    p.stop();

    expect(out.chunks[0]).toContain("    ");
    expect(out.chunks[0]).toContain("waiting for CI");
  });
});
