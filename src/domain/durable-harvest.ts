import { z } from "zod";
// RED scaffolding. Signatures copied from the Phase 1 contract.
export type ProjectRole = "viewer" | "operator" | "maintainer";

export type AllowedRunnerKind = "local" | "hosted";

export interface ProjectIdentityFacts {
  projectRoot: string;
  remoteOriginUrl?: string | null;
  gitCommonDir?: string | null;
}

export interface ProjectRunnerPolicy {
  allowedKinds: AllowedRunnerKind[];
  runnerIds?: string[];
}

export interface ProjectSlackBinding {
  workspaceId: string;
  channelId: string;
  channelName?: string;
  opsChannelId?: string;
  sharedChannel: boolean;
}

export interface ProjectRoleBinding {
  projectId: string;
  principalType: "slack_user" | "cli_token" | "google_sub";
  principalId: string;
  role: ProjectRole;
}

export interface EnrolledProject {
  projectId: string;
  slug: string;
  name: string;
  repoSlug: string | null;
  trunkBranch: string;
  localRoot: string | null;
  mirrorPath: string | null;
  runnerPolicy: ProjectRunnerPolicy;
  slack: ProjectSlackBinding | null;
  legacyProjectIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRecipient {
  projectId: string;
  surface: "slack" | "local_cli" | "http";
  workspaceId?: string;
  channelId?: string;
  threadTs?: string;
  actorUserId?: string;
  opsOnly?: boolean;
}

export type DeliverySource = "github_webhook" | "github_poller" | "manual_cli";

export type HarvestTerminalEvent = "merged" | "closed_unmerged";

export type HarvestStageName =
  | "git_sync"
  | "gate_verify"
  | "learning_record"
  | "slack_delivery"
  | "branch_cleanup";

export type HarvestStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "gate_failed"
  | "forecast_missing"
  | "uncertain"
  | "blocked_tip_mismatch"
  | "skipped_no_target"
  | "failed";

export type HarvestOperationStatus =
  | "accepted"
  | "running"
  | "completed"
  | "gate_failed"
  | "delivery_pending"
  | "cleanup_blocked"
  | "closed_unmerged"
  | "failed";

export interface HarvestCandidateInput {
  source: DeliverySource;
  deliveryId: string;
  repoSlug: string | null;
  baseBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
  prNumber: number;
  prUrl: string | null;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  terminalAt: string;
  explicitFeatureId?: string;
  explicitPhaseId?: string;
  recipient?: DeliveryRecipient | null;
}

export interface HarvestStageReceipt {
  operationId: string;
  phaseKey: string;
  stage: HarvestStageName;
  status: HarvestStageStatus;
  leaseEpoch: number;
  attemptCount: number;
  evidenceJson: string | null;
  error: string | null;
  updatedAt: string;
  completedAt: string | null;
}

export function computeHarvestWorkKey(input: {
  prNumber: number;
  terminalEvent: HarvestTerminalEvent;
  mergeCommitSha: string | null;
  featureId: string;
  phaseId: string | null;
}): string {
  throw new Error("Not implemented");
}

export function verifyHarvestTarget(
  project: EnrolledProject,
  candidate: HarvestCandidateInput,
):
  | {
      ok: true;
      featureId: string;
      phaseId: string | null;
      workKey: string;
    }
  | {
      ok: false;
      code:
        | "REPO_MISMATCH"
        | "NOT_CONFIGURED_TRUNK"
        | "NOT_FEATURE_BRANCH"
        | "MISSING_MERGE_SHA"
        | "PHASE_MISMATCH";
      reason: string;
    } {
  throw new Error("Not implemented");
}

export function planHarvestStages(input: {
  terminalEvent: HarvestTerminalEvent;
  phaseIds: readonly string[];
  hasSlackTarget: boolean;
  hasRemoteBranchTarget: boolean;
}): Array<{
  phaseKey: string;
  stage: HarvestStageName;
  initialStatus: HarvestStageStatus;
}> {
  throw new Error("Not implemented");
}

export function deriveHarvestTerminalStatus(input: {
  terminalEvent: HarvestTerminalEvent;
  stages: readonly HarvestStageReceipt[];
}): HarvestOperationStatus {
  throw new Error("Not implemented");
}

export function evaluateBranchCleanupSafety(input: {
  projectRepoSlug: string | null;
  candidateRepoSlug: string | null;
  trunkBranch: string;
  headBranch: string | null;
  expectedHeadSha: string | null;
  observedRemoteHeadSha: string | null;
}):
  | { action: "already_deleted" }
  | { action: "delete_at_tip"; branch: string; expectedSha: string }
  | {
      action: "block_cleanup";
      code:
        | "REPO_MISMATCH"
        | "PROTECTED_BRANCH"
        | "MISSING_EXPECTED_TIP"
        | "TIP_MOVED";
    } {
  throw new Error("Not implemented");
}

export const DeliverySourceSchema = z.never();

export const HarvestTerminalEventSchema = z.never();

export const HarvestOperationStatusSchema = z.never();

export const HarvestStageNameSchema = z.never();

export const HarvestStageStatusSchema = z.never();

export const OutboxStatusSchema = z.never();
