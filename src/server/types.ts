import type { AgentBackend } from "../utils/config.js";

export type DispatchStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "retrying";

export type ServerLifecycle =
  | "starting"
  | "ready"
  | "sleeping"
  | "degraded"
  | "stopping";

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
  id: string; // e.g., "T001"
  status: "pending" | "running" | "completed" | "failed";
  sandboxDir: string; // Path to git worktree: .runs/sandboxes/<feature>-<task>-<uuid>
  backend: AgentBackend;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string; // Capture stderr or error messages
}

export interface DispatchRecord {
  id: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackend;
  status: DispatchStatus;
  branchName: string;
  attempts: DispatchAttempt[];
  tasks: TaskRecord[]; // NEW: Parallel tasks within this phase
  createdAt: string;
  completedAt?: string;
  prUrl?: string;
  prNumber?: number;
  workDir?: string; // Keep workDir for backward compatibility if needed, though data-model doesn't show it for phase record
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
  type:
    | "phase_start"
    | "phase_complete"
    | "phase_fail"
    | "ci_result"
    | "review_ready"
    | "done_done"
    | "define_spec_ready"
    | "define_plan_ready"
    | "pulse";
  feature: string;
  phase?: string;
  prUrl?: string;
  prNumber?: number;
  gateResults?: string;
  error?: string;
  branch?: string;
  backend?: string;
  opsOnly?: boolean;
  specPath?: string;
  planPath?: string;
  phaseCount?: number;
  pulseReport?: any; // PulseReport
  compressionReport?: any; // CompressionReport
}
