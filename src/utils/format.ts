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
  console.log(`\n${DIM}${line}${RESET}`);
  console.log(`${BOLD}${CYAN}▸ gwrk ${command}${RESET}  ${DIM}${ts}${RESET}`);
  for (const [key, value] of Object.entries(fields)) {
    console.log(`  ${DIM}${key.padEnd(10)}${RESET} ${value}`);
  }
  console.log(`${DIM}${line}${RESET}\n`);
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
  console.log("");
  console.log(`${CYAN}┌─────────────────────────────────────────────┐${RESET}`);
  console.log(
    `${CYAN}│${RESET}  ${GREEN}✓ ${BOLD}${command}${RESET} ${GREEN}complete${RESET}`,
  );
  console.log(
    `${CYAN}│${RESET}  Duration: ${BOLD}${humanDuration(durationS)}${RESET}`,
  );
  if (runId !== undefined)
    console.log(`${CYAN}│${RESET}  Run:      ${DIM}#${runId}${RESET}`);
  if (logFile)
    console.log(`${CYAN}│${RESET}  Log:      ${DIM}${logFile}${RESET}`);
  console.log(`${CYAN}└─────────────────────────────────────────────┘${RESET}`);
}

/** Print failure — matches agent-run.sh box format */
export function fail(
  command: string,
  exitCode: number,
  durationS: number,
  runId?: number,
  logFile?: string,
): void {
  console.error("");
  console.error(
    `${CYAN}┌─────────────────────────────────────────────┐${RESET}`,
  );
  console.error(
    `${CYAN}│${RESET}  ${RED}✗ ${BOLD}${command}${RESET} ${RED}failed (exit ${exitCode})${RESET}`,
  );
  console.error(
    `${CYAN}│${RESET}  Duration: ${BOLD}${humanDuration(durationS)}${RESET}`,
  );
  if (runId !== undefined)
    console.error(`${CYAN}│${RESET}  Run:      ${DIM}#${runId}${RESET}`);
  if (logFile)
    console.error(`${CYAN}│${RESET}  Log:      ${DIM}${logFile}${RESET}`);
  console.error(
    `${CYAN}└─────────────────────────────────────────────┘${RESET}`,
  );
}

/** Print a blocked/validation error */
export function blocked(message: string): void {
  console.error(`${RED}✗${RESET} ${YELLOW}[BLOCKED]${RESET} ${message}`);
}

/** Print an info line */
export function info(message: string): void {
  console.log(`${CYAN}▸${RESET} ${message}`);
}

/** Print a warning */
export function warn(message: string): void {
  console.log(`${YELLOW}⚠${RESET} ${message}`);
}

/** Print a dry-run notice */
export function dryRun(command: string): void {
  console.log(
    `${MAGENTA}[DRY RUN]${RESET} Would execute: ${DIM}${command}${RESET}`,
  );
}

/** Elapsed time heartbeat — prints every 30s so user knows the command is alive */
export function startTimer(): NodeJS.Timeout {
  const start = Date.now();
  return setInterval(() => {
    const elapsed = Math.round((Date.now() - start) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const display = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    process.stderr.write(`${DIM}  ⏱ ${display} elapsed${RESET}\n`);
  }, 30_000);
}

/** Stop the heartbeat timer */
export function stopTimer(timer: NodeJS.Timeout): void {
  clearInterval(timer);
}
