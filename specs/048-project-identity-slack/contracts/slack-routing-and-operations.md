# Slack routing and operations contracts

Authorize every Slack and HTTP request against an enrolled project before work starts. Stamp project and recipient context on every receipt. Blocked: none.

## Pure routing and authorization policy

Source: `src/domain/slack-routing.ts`

Phase: Phase 1

```typescript
export type RouteDenialCode =
  | "UNBOUND_WORKSPACE"
  | "UNBOUND_CHANNEL"
  | "AMBIGUOUS_PROJECT_SELECTION"
  | "UNKNOWN_PROJECT"
  | "CHANNEL_PROJECT_MISMATCH"
  | "UNAUTHORIZED_USER"
  | "INSUFFICIENT_ROLE"
  | "THREAD_PROJECT_MISMATCH"
  | "ACTION_REPLAYED"
  | "RUNNER_NOT_ALLOWED"
  | "REMOTE_AUTH_REQUIRED";

export type CommandAccessLevel = "read" | "operate" | "maintain";

export interface SlackInboundEnvelope {
  workspaceId: string;
  channelId: string;
  isDirectMessage: boolean;
  actorUserId: string;
  threadTs?: string;
  messageTs?: string;
  requestedProject?: string;
  requiredAccess: CommandAccessLevel;
}

export interface SlackActionVerificationInput extends SlackInboundEnvelope {
  actionId: string;
  payloadProjectId?: string;
  featureId: string;
  phaseId?: string;
  payloadRootTs?: string;
  storedThread?: SlackFeatureThread | null;
  priorReceipt?: SlackActionReceipt | null;
}

export type RouteDecision =
  | {
      ok: true;
      project: EnrolledProject;
      role: ProjectRole;
      recipient: DeliveryRecipient;
    }
  | {
      ok: false;
      code: RouteDenialCode;
      message: string;
      candidateSlugs?: string[];
    };

export function parseProjectSelector(rawText: string): {
  requestedProject?: string;
  cleanedText: string;
};
export function requiredAccessForSlackCommand(
  subcommand: string,
  subarg?: string,
): CommandAccessLevel;
export function requiredAccessForSlackAction(
  actionId: string,
): CommandAccessLevel;
export function evaluateSlackRoute(
  projects: readonly EnrolledProject[],
  roles: readonly ProjectRoleBinding[],
  envelope: SlackInboundEnvelope,
): RouteDecision;
export function evaluateSlackAction(
  projects: readonly EnrolledProject[],
  roles: readonly ProjectRoleBinding[],
  input: SlackActionVerificationInput,
): RouteDecision;
export function evaluateHttpProjectAccess(input: {
  projects: readonly EnrolledProject[];
  roles: readonly ProjectRoleBinding[];
  requestedProject?: string;
  localDefaultProjectId?: string;
  transport: "trusted_local" | "hosted";
  principal?: { principalType: "cli_token" | "google_sub"; principalId: string };
  requiredAccess: CommandAccessLevel;
}): RouteDecision;
```

| Surface group | Access level | Minimum role |
|---|---|---|
| Status, logs and App Home | `read` | `viewer` |
| Effort, pulse and ADR read commands | `read` | `viewer` |
| Review links and log buttons | `read` | `viewer` |
| Dispatch, ship and pause commands | `operate` | `operator` |
| Define, research and ADR record commands | `operate` | `operator` |
| Retry phase and revision buttons | `operate` | `operator` |
| Approve, reject and ADR decide commands | `maintain` | `maintainer` |
| Merge PR, approve buttons and reaction approval | `maintain` | `maintainer` |

Direct messages and shared or multi-project channels return `AMBIGUOUS_PROJECT_SELECTION` without `requestedProject`. Click-time verification rejects mismatched `payloadProjectId` or `storedThread` with `THREAD_PROJECT_MISMATCH`. Existing receipts return `ACTION_REPLAYED`. Claim atomically before executing an approved action. Scope the claim key to project, workspace, channel and message so Slack retries cannot run the effect twice.

## Application coordinator and notification port

Coordinator and port: `src/application/project-routing/index.ts` and `src/ports/notification-port.ts`

Adapter and harness: `src/adapters/notifications/index.ts` and `tests/helpers/synthetic-slack.ts`

Phases: Phase 1, Phase 3 and Phase 4

```typescript
export interface NotificationPayload {
  projectId?: string;
  featureId?: string;
  phaseId?: string;
  recipient?: DeliveryRecipient;
  text: string;
  channel?: string;
  threadTs?: string;
  blocks?: unknown[];
  opsOnly?: boolean;
  ephemeralUserId?: string;
}

export interface NotificationReceipt {
  delivered: boolean;
  channelId?: string;
  messageTs?: string;
  threadTs?: string;
  queuedForPresence?: boolean;
}

export interface SlackDeliveryStatus {
  mode: "disabled" | "socket_connected" | "webhook_fallback" | "degraded";
  workspaceId?: string;
  connected: boolean;
  lastError?: string;
}

export interface NotificationPort {
  notify(payload: NotificationPayload): Promise<NotificationReceipt | void>;
  getUserPresence?(
    workspaceId: string,
    userId: string,
  ): Promise<"active" | "away">;
  getDeliveryStatus?(): Promise<SlackDeliveryStatus>;
}

export interface ProjectRoutingService {
  authorizeCommand(envelope: SlackInboundEnvelope): RouteDecision;
  authorizeAndClaimAction(
    input: Omit<SlackActionVerificationInput, "storedThread" | "priorReceipt"> & {
      nowIso: string;
    },
  ): RouteDecision;
  deliverProjectEvent(input: {
    projectId: string;
    featureId?: string;
    phaseId?: string;
    eventType: string;
    message: { text: string; blocks?: unknown[] };
    recipient?: DeliveryRecipient;
    opsOnly?: boolean;
    nowIso: string;
  }): Promise<NotificationReceipt>;
}
```

`deliverProjectEvent` loads the enrolled project from `ProjectRegistryPort`. When `opsOnly` is `true`, delivery posts to `project.slack.opsChannelId` without binding a feature thread. Feature lifecycle delivery reads `getFeatureThread(projectId, featureId)` and posts to `project.slack.channelId`. Serialize first-thread creation per project and feature. Persist the winning delivery receipt before sending further replies. `notifySlack` ignores `process.cwd()` config when `projectId` or `recipient` is set. Presence batching keys away queues by `(projectId, recipientUserId)` instead of workspace-wide user lists. Pilot mode disables Telegram (`reason: "disabled_in_pilot"`) and makes zero Telegram network calls.

## Dispatch, HTTP, readiness and CLI contracts

Server modules: `src/server/types.ts`, `src/server/dispatch.ts` and `src/server/routes/*.ts`

CLI modules: `src/commands/project-enroll.ts` and `src/commands/status.ts`

Phases: Phase 5 and Phase 6

```typescript
export interface DispatchRequest {
  projectId?: string;
  featureId: string;
  phaseId: string;
  taskId?: string;
  taskIds?: string[];
  backend?: string;
  parallel?: boolean;
  recipient?: DeliveryRecipient;
}

export interface DispatchRecord {
  id: string;
  projectId: string;
  featureId: string;
  phaseId: string;
  backend: string;
  status: DispatchStatus;
  branchName: string;
  projectRoot: string;
  trunkBranch: string;
  recipient?: DeliveryRecipient;
  attempts: DispatchAttempt[];
  tasks: TaskRecord[];
  createdAt: string;
  completedAt?: string;
  prUrl?: string;
  prNumber?: number;
  workDir?: string;
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
    git: { status: "ok" | "degraded" | "unavailable"; message?: string };
    network: { status: "ok" | "degraded" | "unavailable"; message?: string };
    slack: { status: "ok" | "degraded" | "unavailable"; message?: string };
  };
}
```

`DispatchQueue` keys active, queued and historical dispatches by `(projectId, featureId, phaseId)`. Worktrees branch from `project.trunkBranch` inside `project.mirrorPath ?? project.localRoot`. `POST /api/notify` keeps `done_done` on the project feature thread unless the caller sets `opsOnly: true`. Hosted requests to `/api/dispatch` and `/api/notify` require a verified principal and authorized project. This applies when the gateway connects from loopback. Derive trusted local mode from listener configuration and its direct transport. Ignore caller-supplied forwarded identity and address headers outside the trusted gateway boundary. In trusted local mode, direct CLI calls resolve the enrolled project for `localRoot` or the single local enrollment.

CLI enrollment and status commands follow ADR-004 (`[exit:N | Xs]` on stderr and `--format json`):

| Command | Type | Purpose | Error navigation |
|---|---|---|---|
| `gwrk project enroll` | mutator | Enroll or update repo identity, trunk, root or mirror, runners, Slack binding and role bindings | Directs caller to pass `--repo` or run inside a git checkout |
| `gwrk project list` | query | List enrolled projects, aliases, Slack bindings and readiness | Directs caller to `gwrk project enroll` when empty |
| `gwrk project show <project>` | query | Show one enrolled project, legacy aliases and role bindings | Lists known project slugs on miss |
| `gwrk status` | query | Report local project, daemon liveness, remote reachability, project readiness and Slack delivery | Exits `1` with explicit `serverReachable: false` when a configured or running server fails health or status checks |
