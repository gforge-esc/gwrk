import type { AgentBackend } from "./config.js";
export interface DispatchOptions {
    backend: AgentBackend;
    workflowPath: string;
    featureDir?: string;
    prompt?: string;
    approvalMode?: "yolo" | "auto" | "plan";
}
/** Build the command + args for a given backend. Exported for testability. */
export declare function buildCommand(opts: DispatchOptions, _workflowContent: string): {
    command: string;
    args: string[];
    stdin?: string;
};
export declare function dispatchAgent(opts: DispatchOptions): Promise<{
    exitCode: number;
    logPath: string;
}>;
