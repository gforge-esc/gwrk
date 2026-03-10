import type { AgentBackend, GwrkConfig } from "../utils/config.js";
import type { GitManager } from "./git-manager.js";
import type { SystemMonitor } from "./monitor.js";
import type { SandboxManager } from "./sandbox.js";
import type { DispatchRecord } from "./types.js";
export interface DispatchRequest {
    featureId: string;
    phaseId: string;
    backend?: AgentBackend;
}
export declare class DispatchQueue {
    private config;
    private monitor;
    private sandbox;
    private git;
    private projectRoot;
    private queue;
    private active;
    private history;
    constructor(config: GwrkConfig, monitor: SystemMonitor, sandbox: SandboxManager, git: GitManager, projectRoot: string);
    enqueue(request: DispatchRequest): DispatchRecord;
    processNext(): Promise<void>;
    private runDispatch;
    getStatus(): {
        active: DispatchRecord[];
        queued: DispatchRecord[];
        history: DispatchRecord[];
    };
    getQueueDepth(): number;
    getActiveCount(): number;
    getCompletedCount(): number;
    getFailedCount(): number;
}
