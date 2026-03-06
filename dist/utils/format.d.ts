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
/** Exported for callers that need raw ANSI codes (e.g. drift warnings) */
export declare const color: {
    BOLD: string;
    DIM: string;
    CYAN: string;
    GREEN: string;
    YELLOW: string;
    RED: string;
    MAGENTA: string;
    RESET: string;
};
/** Print the run banner — top of every command */
export declare function banner(command: string, fields: Record<string, string>): void;
/** Print success completion — matches agent-run.sh box format */
export declare function success(command: string, durationS: number, runId?: number, logFile?: string): void;
/** Print failure — matches agent-run.sh box format */
export declare function fail(command: string, exitCode: number, durationS: number, runId?: number, logFile?: string): void;
/** Print a blocked/validation error */
export declare function blocked(message: string): void;
/** Print an info line */
export declare function info(message: string): void;
/** Print a warning */
export declare function warn(message: string): void;
/** Print a dry-run notice */
export declare function dryRun(command: string): void;
/** Elapsed time heartbeat — prints every 30s so user knows the command is alive */
export declare function startTimer(): NodeJS.Timeout;
/** Stop the heartbeat timer */
export declare function stopTimer(timer: NodeJS.Timeout): void;
