export interface ExecResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
export declare function execCommand(command: string, args: string[], stdin?: string): Promise<ExecResult>;
export declare function runGate(gateScript: string): ExecResult;
