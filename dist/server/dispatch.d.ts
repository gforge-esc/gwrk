import type { AgentBackend, GwrkConfig } from "../utils/config.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchRecord } from "./types.js";
import type { DispatchOrchestrator } from "./dispatch-orchestrator.js";
export interface DispatchRequest {
    featureId: string;
    phaseId: string;
    taskId?: string;
    taskIds?: string[];
    backend?: AgentBackend;
    parallel?: boolean;
}
export declare class DispatchQueue {
    private config;
    private monitor;
    private sandbox;
    private git;
    private orchestrator;
    private projectRoot;
    private queue;
    private active;
    private history;
    private paused;
    constructor(config: GwrkConfig, monitor: SystemMonitor, sandbox: SandboxManager, git: GitManager, orchestrator: DispatchOrchestrator, projectRoot: string);
    pause(): void;
    resume(): void;
    enqueue(request: DispatchRequest): DispatchRecord;
    processNext(): Promise<void>;
    private runDispatch;
    handleCompletion(dispatchId: string, exitCode: number, stderr: string): Promise<void>;
    getQueue(): {
        active: DispatchRecord[];
        queued: DispatchRecord[];
        throttled: boolean;
        paused: boolean;
    };
    getDispatch(featureId: string, phaseId: string, taskId?: string): DispatchRecord | null;
    getQueueDepth(): number;
    getActiveCount(): number;
    getCompletedCount(): number;
    getFailedCount(): number;
}
