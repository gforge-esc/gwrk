/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * src/utils/format.ts — Unified CLI output formatting
 *
 * STYLE GUIDE:
 * Every gwrk command MUST use these functions for terminal output.
 * No raw console.log/console.error with ad-hoc formatting.
 *
 * Visual language matches the shell scripts (agent-run.sh, define-until-solid.sh):
 *   - ANSI colors: bold, dim, cyan, green, yellow, red, magenta
 *   - Box headers with ──────── separators
 *   - Consistent status indicators: ✓ (green), ✗ (red), ▸ (cyan), ⚠ (yellow)
 *   - Timestamps on every run banner
 *   - Duration on every completion/failure banner
 */

import {
  logCliError,
  logCliOutput,
  writeScopedStderr,
} from "../adapters/cli/output-scope.js";
import { type ProgressHandle, startProgress } from "./progress.js";

// ANSI escape codes — matches scripts/dev/agent-run.sh exactly
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";
const RESET = "\x1b[0m";

/** Exported for callers that need raw ANSI codes (e.g. drift warnings) */
export const color = { BOLD, DIM, CYAN, GREEN, YELLOW, RED, MAGENTA, RESET };

/** Format a timestamp as HH:MM:SS */
function timeStamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

/** Print the run banner — top of every command */
export function banner(command: string, fields: Record<string, string>): void {
  const ts = timeStamp();
  const line = "─".repeat(50);
  logCliOutput(`\n${DIM}${line}${RESET}`);
  logCliOutput(`${BOLD}${CYAN}▸ gwrk ${command}${RESET}  ${DIM}${ts}${RESET}`);
  for (const [key, value] of Object.entries(fields)) {
    logCliOutput(`  ${DIM}${key.padEnd(10)}${RESET} ${value}`);
  }
  logCliOutput(`${DIM}${line}${RESET}\n`);
}

/** Format seconds as Xm Ys */
function humanDuration(s: number): string {
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

/** Print success completion — matches agent-run.sh box format */
export function success(
  command: string,
  durationS: number,
  runId?: number,
  logFile?: string,
): void {
  logCliOutput("");
  logCliOutput(
    `${CYAN}┌─────────────────────────────────────────────┐${RESET}`,
  );
  logCliOutput(
    `${CYAN}│${RESET}  ${GREEN}✓ ${BOLD}${command}${RESET} ${GREEN}complete${RESET}`,
  );
  logCliOutput(
    `${CYAN}│${RESET}  Duration: ${BOLD}${humanDuration(durationS)}${RESET}`,
  );
  if (runId !== undefined)
    logCliOutput(`${CYAN}│${RESET}  Run:      ${DIM}#${runId}${RESET}`);
  if (logFile)
    logCliOutput(`${CYAN}│${RESET}  Log:      ${DIM}${logFile}${RESET}`);
  logCliOutput(
    `${CYAN}└─────────────────────────────────────────────┘${RESET}`,
  );
}

/** Print failure — matches agent-run.sh box format */
export function fail(
  command: string,
  exitCode: number,
  durationS: number,
  runId?: number,
  logFile?: string,
): void {
  logCliError("");
  logCliError(`${CYAN}┌─────────────────────────────────────────────┐${RESET}`);
  logCliError(
    `${CYAN}│${RESET}  ${RED}✗ ${BOLD}${command}${RESET} ${RED}failed (exit ${exitCode})${RESET}`,
  );
  logCliError(
    `${CYAN}│${RESET}  Duration: ${BOLD}${humanDuration(durationS)}${RESET}`,
  );
  if (runId !== undefined)
    logCliError(`${CYAN}│${RESET}  Run:      ${DIM}#${runId}${RESET}`);
  if (logFile)
    logCliError(`${CYAN}│${RESET}  Log:      ${DIM}${logFile}${RESET}`);
  logCliError(`${CYAN}└─────────────────────────────────────────────┘${RESET}`);
}

/** Print a blocked/validation error */
export function blocked(message: string): void {
  logCliError(`${RED}✗${RESET} ${YELLOW}[BLOCKED]${RESET} ${message}`);
}

/** Print an info line */
export function info(message: string): void {
  logCliOutput(`${CYAN}▸${RESET} ${message}`);
}

/** Print a warning */
export function warn(message: string): void {
  logCliOutput(`${YELLOW}⚠${RESET} ${message}`);
}

/** Print a dry-run notice */
export function dryRun(command: string, agent?: string): void {
  const agentSuffix = agent ? ` (agent: ${agent})` : "";
  logCliOutput(
    `${MAGENTA}[DRY RUN]${RESET} Would execute: ${DIM}${command}${agentSuffix}${RESET}`,
  );
}

/**
 * Liveness indicator for a long-running command, on stderr so it never
 * pollutes a command's stdout payload.
 *
 * Delegates to {@link startProgress} so it adapts to its sink like every other
 * gwrk progress indicator: one line repainting in place on a terminal, and a
 * sparse newline-terminated heartbeat once redirected. It used to write a
 * newline-terminated line every 30s unconditionally, which scrolled a column
 * of 24 stamps down the terminal across a 12-minute research run.
 */
export function startTimer(label = "working"): ProgressHandle {
  return startProgress({
    label,
    write: (chunk) => writeScopedStderr(chunk),
    isTTY: process.stderr.isTTY === true,
    indent: "  ",
    frameMs: 150,
    formatElapsed: humanDuration,
  });
}

/** Stop the heartbeat timer */
export function stopTimer(timer: ProgressHandle): void {
  timer.stop();
}
