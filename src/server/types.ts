import type { AgentBackend } from "../utils/config.js";

export type DispatchStatus = "queued" | "running" | "completed" | "failed" | "retrying";

export interface DispatchAttempt {
  backend: AgentBackend;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number;
  logFile?: string;
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
}

export interface SystemStatus {
  cpuPercent: number;
  memPercent: number;
  diskFreeGb: number;
}

export interface SandboxInfo {
  containerId: string;
  featureId: string;
  phaseId: string;
  status: string;
}
