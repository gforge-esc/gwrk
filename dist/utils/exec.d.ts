import type { StdioOptions } from "node:child_process";
export interface RunOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: StdioOptions;
    input?: string;
}
/**
 * Run a command with streaming output (stdio: inherit by default).
 * Returns a promise that resolves on success or rejects with exit code.
 */
export declare function run(command: string, args: string[], opts?: RunOptions): Promise<void>;
export interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function execCommand(command: string, args: string[], stdin?: string): Promise<ExecResult>;
export declare function runGate(gateScript: string): ExecResult;
