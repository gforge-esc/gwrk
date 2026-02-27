export interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function runGate(gateScript: string): ExecResult;
