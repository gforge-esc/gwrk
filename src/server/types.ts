/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  DispatchOperationStatus,
  DispatchReceipt,
  DurableDispatchOperation,
} from "../domain/durable-dispatch.js";
import type {
  HarvestOperationStatus,
  HarvestStageName,
  HarvestStageStatus,
} from "../domain/durable-harvest.js";
import type { DeliveryRecipient } from "../domain/project-registry.js";
import type { CompressionReport, PulseReport } from "../domain/types.js";
import type { SlackDeliveryStatus } from "../ports/notification-port.js";
import type { DurableOperationsStatus } from "../ports/operations-port.js";
import type { AgentBackendId } from "../utils/config.js";

export type {
  DeliveryRecipient,
  DispatchOperationStatus,
  DispatchReceipt,
  DurableDispatchOperation,
  DurableOperationsStatus,
  HarvestOperationStatus,
  HarvestStageName,
  HarvestStageStatus,
};

export interface HarvestPendingStage {
  operationId: string;
  featureId: string;
  phaseId: string | null;
  stage: HarvestStageName;
  status: HarvestStageStatus;
}

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

interface ComponentHealth {
  status: "ok" | "degraded" | "unavailable";
  message?: string;
}

export interface ProjectReadinessReport {
  projectId: string;
  slug: string;
  repoSlug: string | null;
  trunkBranch: string;
  checkoutPath: string | null;
  checkoutReady: boolean;
  runnerAllowed: boolean;
  slackBound: boolean;
  status: "ready" | "degraded" | "misconfigured";
  reason?: string;
}

export interface HealthResponse {
  status: "ok" | "degraded";
  daemonLiveness: "alive";
  projectReadiness: {
    status: "ready" | "degraded" | "unconfigured";
    readyCount: number;
    totalCount: number;
    projects: ProjectReadinessReport[];
  };
  slackDelivery: SlackDeliveryStatus;
  telegram: {
    enabled: false;
    reason: "disabled_in_pilot";
  };
  components: {
    server: { status: "ok" | "degraded"; message?: string };
    git: ComponentHealth;
    network: ComponentHealth;
    slack: ComponentHealth;
  };
}

export interface DispatchRequest {
  projectId?: string;
  featureId: string;
  phaseId: string;
  taskId?: string;
  taskIds?: string[];
  backend?: AgentBackendId;
  parallel?: boolean;
  recipient?: DeliveryRecipient | null;
}

export interface DispatchAttempt {
  attemptNumber: number;
  backend: AgentBackendId;
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
  backend: AgentBackendId;
  model?: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
  error?: string; // Capture stderr or error messages
}

export interface DispatchRecord {
  id: string;
  operationId?: string;
  projectId?: string;
  workKey?: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackendId;
  status: DispatchStatus;
  branchName: string;
  projectRoot: string;
  trunkBranch: string;
  attempts: DispatchAttempt[];
  attemptCount?: number;
  deduplicated?: boolean;
  recipient?: DeliveryRecipient | null;
  tasks: TaskRecord[]; // NEW: Parallel tasks within this phase
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
  projectId?: string;
  workDir: string;
  taskId: string;
  featureId: string;
  phaseId: string;
  backend: AgentBackendId;
  status: "creating" | "running" | "stopping" | "destroyed";
  startedAt: string;
}

export interface SystemStatus {
  projectId?: string;
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
  operations?: DurableOperationsStatus;
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
  projectId?: string;
  recipient?: DeliveryRecipient;
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
  pulseReport?: PulseReport;
  compressionReport?: CompressionReport;
}
