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
        docker: ComponentHealth;
        network: ComponentHealth;
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
export interface DispatchRecord {
    id: string;
    featureId: string;
    phaseId: string;
    backend: AgentBackend;
    status: DispatchStatus;
    containerId?: string;
    branchName: string;
    attempts: DispatchAttempt[];
    createdAt: string;
    completedAt?: string;
}
export interface SystemResources {
    cpuPercent: number;
    memPercent: number;
    diskFreeGb: number;
}
export interface SandboxInfo {
    containerId: string;
    featureId: string;
    phaseId: string;
    backend: AgentBackend;
    status: "creating" | "running" | "stopping" | "destroyed";
    startedAt: string;
    cpuPercent?: number;
    memMb?: number;
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
