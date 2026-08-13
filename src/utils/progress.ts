/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Long-running-operation progress that adapts to where stdout actually goes.
 *
 * On a TTY, `\r` parks the cursor at column 0 so each frame repaints over the
 * last one — one animated line, no matter how long the wait. Redirected to a
 * file or a pipe, `\r` is just byte 0x0D: nothing is overwritten and every
 * frame is appended. A 68-minute agent stage at 200ms once left 20,284 frames
 * in a redirected ship log — ~92% of a 774 KB file with 131 real newlines.
 *
 * So: animate only when a terminal is there to animate on. Off a TTY, emit a
 * sparse newline-terminated heartbeat instead, which still shows liveness and
 * still makes a stall visible by wall clock, at ~1 line per minute.
 */

// ANSI — must match format.ts
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Cursor-to-start + erase-to-end-of-line. TTY-only: pure noise in a file. */
const CLEAR_LINE = "\r\x1b[K";

export interface ProgressOptions {
  /** Operation description, e.g. "agent running". */
  label: string;
  /** Sink for progress output — normally `process.stdout.write`. */
  write: (chunk: string) => void;
  /** Whether `write` lands on a terminal. Normally `process.stdout.isTTY`. */
  isTTY: boolean;
  /** Leading whitespace matching the caller's output tree. */
  indent?: string;
  /** Animation cadence on a TTY. */
  frameMs?: number;
  /** Heartbeat cadence off a TTY. */
  heartbeatMs?: number;
  /** Renders elapsed seconds; defaults to `"3m 7s"`. */
  formatElapsed?: (seconds: number) => string;
}

export interface ProgressHandle {
  /**
   * Halt progress output and leave the cursor ready for the caller's own
   * completion line. Idempotent. On a TTY this erases the spinner line; off a
   * TTY it writes nothing, since the heartbeats are already complete lines.
   */
  stop(): void;
}

function defaultElapsed(seconds: number): string {
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function startProgress(opts: ProgressOptions): ProgressHandle {
  const indent = opts.indent ?? "";
  const format = opts.formatElapsed ?? defaultElapsed;
  const start = Date.now();
  const elapsed = () => format(Math.floor((Date.now() - start) / 1000));

  let idx = 0;
  let stopped = false;

  const interval = opts.isTTY
    ? setInterval(() => {
        const frame = FRAMES[idx % FRAMES.length];
        idx++;
        opts.write(
          `\r${DIM}${indent}${frame} ${opts.label}... ${elapsed()}${RESET}  `,
        );
      }, opts.frameMs ?? 150)
    : setInterval(() => {
        opts.write(`${indent}${DIM}⋯ ${opts.label}... ${elapsed()}${RESET}\n`);
      }, opts.heartbeatMs ?? 60_000);

  // Progress is decoration — never hold the event loop open for it.
  interval.unref?.();

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      if (opts.isTTY) {
        opts.write(CLEAR_LINE);
      }
    },
  };
}
