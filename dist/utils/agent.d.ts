import type { AgentBackend as ConfigAgentBackend } from "./config.js";
export interface DispatchOptions {
    backend: ConfigAgentBackend | string;
    workflowPath: string;
    featureDir?: string;
    prompt?: string;
    approvalMode?: "yolo" | "auto" | "plan";
    contextPath?: string;
    workDir?: string;
    stdin?: string;
}
/** Build the command + args for a given backend. Exported for testability. */
export declare function buildCommand(opts: DispatchOptions, _workflowContent: string): Promise<{
    command: string;
    args: string[];
    stdin?: string;
}>;
export declare function dispatchAgent(opts: DispatchOptions): Promise<{
    exitCode: number;
    logPath: string;
}>;
/**
 * FR-019: Input contract for dispatchToAgent().
 * Maps to ADR-006 AgentBackend.dispatch() input.
 */
export interface TaskDispatch {
    prompt?: string;
    agent?: ConfigAgentBackend | string;
    workDir?: string;
    stdin?: string;
    env?: Record<string, string>;
    workflow?: string;
    featureDir?: string;
}
/**
 * FR-019: Output contract for dispatchToAgent().
 * Normalized result — proprietary exit codes mapped to gwrk standard.
 */
export interface TaskResult {
    exitCode: number;
    errorType?: string;
    stdout: string;
    stderr: string;
    durationS: number;
    logPath?: string;
}
/**
 * FR-019: Dispatch agent work via a single facade.
 * FR-020: Normalizes exit codes — proprietary codes mapped to gwrk standard.
 * FR-021: Context delivered via stdin pipe.
 *
 * Internals are replaced by pluginRegistry.getAgentBackend().dispatch()
 */
export declare function dispatchToAgent(task: TaskDispatch): Promise<TaskResult>;
