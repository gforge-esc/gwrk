/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startTimer, stopTimer } from "./format.js";

/**
 * Capture stderr writes and control whether stderr looks like a terminal.
 * `startTimer` reads `isTTY` when it is called, so set it before starting.
 */
function stderrHarness(isTTY: boolean) {
  const chunks: string[] = [];
  const original = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", {
    value: isTTY,
    configurable: true,
  });
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    chunks,
    get text() {
      return chunks.join("");
    },
    restore() {
      spy.mockRestore();
      Object.defineProperty(process.stderr, "isTTY", {
        value: original,
        configurable: true,
      });
    },
  };
}

describe("startTimer on a terminal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("repaints the elapsed line in place instead of appending lines", () => {
    const err = stderrHarness(true);
    try {
      const timer = startTimer("gwrk-research-technical");
      // Twelve minutes — the length of the run that motivated this.
      vi.advanceTimersByTime(12 * 60_000);
      stopTimer(timer);

      // The whole point: one repainting line, never a scrolling column.
      expect(err.text).not.toContain("\n");
      expect(err.chunks.length).toBeGreaterThan(1);
      for (const frame of err.chunks.slice(0, -1)) {
        expect(frame).toMatch(/^\r/);
      }
    } finally {
      err.restore();
    }
  });

  it("shows the label and a growing elapsed stamp", () => {
    const err = stderrHarness(true);
    try {
      const timer = startTimer("gwrk-research-technical");
      vi.advanceTimersByTime(90_000);
      stopTimer(timer);

      expect(err.text).toContain("gwrk-research-technical");
      expect(err.text).toContain("1m 30s");
    } finally {
      err.restore();
    }
  });

  it("erases the line when stopped so the result can print cleanly", () => {
    const err = stderrHarness(true);
    try {
      const timer = startTimer("working");
      vi.advanceTimersByTime(1_000);
      stopTimer(timer);

      expect(err.chunks.at(-1)).toBe("\r\x1b[K");
    } finally {
      err.restore();
    }
  });
});

describe("startTimer when stderr is redirected", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits a sparse newline-terminated heartbeat, not one line per tick", () => {
    const err = stderrHarness(false);
    try {
      const timer = startTimer("gwrk-research-technical");
      vi.advanceTimersByTime(5 * 60_000);
      stopTimer(timer);

      const lines = err.text.split("\n").filter((l) => l.length > 0);
      // Five minutes of waiting must not cost more than ~1 line per minute.
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect(line).toContain("gwrk-research-technical");
      }
      expect(err.text.endsWith("\n")).toBe(true);
    } finally {
      err.restore();
    }
  });

  it("leaves no carriage returns or clear sequences in a log", () => {
    const err = stderrHarness(false);
    try {
      const timer = startTimer("working");
      vi.advanceTimersByTime(3 * 60_000);
      stopTimer(timer);

      expect(err.text).not.toContain("\r");
      expect(err.text).not.toContain("\x1b[K");
    } finally {
      err.restore();
    }
  });
});
