import type { AgentBackend } from "../utils/config.js";
export type DispatchStatus = "queued" | "running" | "completed" | "failed" | "retrying";
export type ServerLifecycle = "starting" | "ready" | "sleeping" | "degraded" | "stopping";
export type NetworkStatus = "online" | "offline" | "unknown";
export interface ComponentHealth {
    status: "ok" | "degraded" | "unavailable";
    message?: string;
}
export interface HealthResponse {
    status: "ok" | "degraded";
    components: {
        server: ComponentHealth;
        git: ComponentHealth;
        network: ComponentHealth;
        slack: ComponentHealth;
    };
}
export interface DispatchAttempt {
    attemptNumber: number;
    backend: AgentBackend;
    startedAt: string;
    completedAt?: string;
    exitCode?: number;
    stderr?: string;
    runId?: number;
}
export interface TaskRecord {
    id: string;
    status: "pending" | "running" | "completed" | "failed";
    sandboxDir: string;
    backend: AgentBackend;
    startedAt?: string;
    completedAt?: string;
    exitCode?: number;
    error?: string;
}
export interface DispatchRecord {
    id: string;
    featureId: string;
    phaseId: string;
    backend: AgentBackend;
    status: DispatchStatus;
    branchName: string;
    attempts: DispatchAttempt[];
    tasks: TaskRecord[];
    createdAt: string;
    completedAt?: string;
    prUrl?: string;
    prNumber?: number;
    workDir?: string;
}
export interface SystemResources {
    cpuPercent: number;
    memPercent: number;
    diskFreeGb: number;
}
export interface SandboxInfo {
    workDir: string;
    taskId: string;
    featureId: string;
    phaseId: string;
    backend: AgentBackend;
    status: "creating" | "running" | "stopping" | "destroyed";
    startedAt: string;
}
export interface SystemStatus {
    server: {
        status: "running" | "stopped";
        lifecycle: ServerLifecycle;
        pid?: number;
        uptime?: number;
        port?: number;
    };
    system: SystemResources;
    network: {
        status: NetworkStatus;
    };
    dispatch: {
        queueDepth: number;
        activeCount: number;
        completedCount: number;
        failedCount: number;
        paused: boolean;
    };
    sandboxes: SandboxInfo[];
}
export interface NotifyPayload {
    type: "phase_start" | "phase_complete" | "phase_fail" | "ci_result" | "review_ready" | "done_done";
    feature: string;
    phase?: string;
    prUrl?: string;
    prNumber?: number;
    gateResults?: string;
    error?: string;
    branch?: string;
    backend?: string;
    opsOnly?: boolean;
}
