# Project registry and storage contracts

Define canonical repository enrollment, legacy identity aliases and composite SQLite keys behind `ProjectRegistryPort`. Blocked: none.

## Domain identity and enrollment schemas

Source: `src/domain/project-id.ts` and `src/domain/project-registry.ts`

Phase: Phase 1

```typescript
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

export interface SlackFeatureThread {
  projectId: string;
  featureId: string;
  workspaceId: string;
  channelId: string;
  rootTs: string;
  updatedAt: string;
}

export interface SlackActionReceipt {
  receiptKey: string;
  projectId: string;
  actionId: string;
  featureId: string;
  phaseId: string | null;
  messageTs: string;
  actorUserId: string;
  outcome: "executed" | "denied";
  recordedAt: string;
}

export function computeProjectId(facts: ProjectIdentityFacts): string;
export function computeLegacyProjectIds(facts: ProjectIdentityFacts): string[];
export function buildActionReceiptKey(input: {
  projectId: string;
  actionId: string;
  featureId: string;
  phaseId?: string | null;
  messageTs: string;
}): string;
export function validateProjectEnrollment(
  input: unknown,
): { ok: true; value: EnrolledProject } | { ok: false; error: string };
```

`computeProjectId` keeps `MD5(remote:<slug>)` when `remoteOriginUrl` exists. `computeLegacyProjectIds` returns `MD5("path:" + projectRoot)` and `MD5(projectRoot)`. Local checkouts keep historical rows after adding or normalizing a remote URL. Domain modules stay pure and accept timestamps from callers.

## SQLite schema migration

Source: `src/db/migrations/014-project-registry-and-composite-keys.sql`

Phase: Phase 2

```sql
ALTER TABLE projects ADD COLUMN slug TEXT;
ALTER TABLE projects ADD COLUMN repo_slug TEXT;
ALTER TABLE projects ADD COLUMN trunk_branch TEXT NOT NULL DEFAULT 'develop';
ALTER TABLE projects ADD COLUMN local_root TEXT;
ALTER TABLE projects ADD COLUMN mirror_path TEXT;
ALTER TABLE projects ADD COLUMN allowed_runners TEXT NOT NULL DEFAULT '["local"]';
ALTER TABLE projects ADD COLUMN slack_workspace_id TEXT;
ALTER TABLE projects ADD COLUMN slack_ops_channel_id TEXT;
ALTER TABLE projects ADD COLUMN shared_channel INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN updated_at TEXT;

CREATE TABLE IF NOT EXISTS project_aliases (
  alias_id    TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_role_bindings (
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL,
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, principal_type, principal_id)
);

CREATE TABLE IF NOT EXISTS slack_feature_threads (
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature_id   TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  channel_id   TEXT NOT NULL,
  root_ts      TEXT NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, feature_id)
);

CREATE TABLE IF NOT EXISTS slack_action_receipts (
  receipt_key   TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_id     TEXT NOT NULL,
  feature_id    TEXT NOT NULL,
  phase_id      TEXT,
  message_ts    TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  outcome       TEXT NOT NULL,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Migration `014` also rebuilds six legacy tables with composite `project_id` keys inside one foreign-key-safe transaction:

| Table | Old key | New composite key | Foreign key rule |
|---|---|---|---|
| `projects` | `id`, `path UNIQUE` | `id PRIMARY KEY` | Drop `path UNIQUE` so mirrors and aliases coexist |
| `plan_features` | `id PRIMARY KEY` | `(project_id, id)` | Reference `projects(id)` |
| `plan_phases` | `id PRIMARY KEY` | `(project_id, id)` | Reference `plan_features(project_id, id) ON DELETE CASCADE` |
| `plan_edges` | `(from_id, to_id, edge_type)` | `(project_id, from_id, to_id, edge_type)` | Scoped per project |
| `plan_proposals` | `id PRIMARY KEY` | `(project_id, id)` | Reference `plan_phases(project_id, id) ON DELETE CASCADE` |
| `gate_results` | `UNIQUE(feature_id, phase_id, task_id)` | `UNIQUE(project_id, feature_id, phase_id, task_id)` | Scoped per project |
| `issues` | `UNIQUE(issue_number)` | `UNIQUE(project_id, issue_number)` | Scoped per project |
| `routing_decisions` | Unscoped `run_id` | Add `project_id TEXT` | Indexed on `(project_id, run_id)` |

Before table rebuild, migration `014` assigns any remaining `NULL` `project_id` rows to an existing matching `projects.id` or a deterministic `legacy-local` project record. Existing local `projects` rows backfill `local_root = path`, `slug = name` and self plus path-hash rows in `project_aliases`. No historical rows are deleted.

## Store and VCS port extensions

Ports: `src/ports/store-port.ts` and `src/ports/vcs-port.ts`

Adapters: `src/adapters/sqlite/index.ts` and `src/adapters/git/index.ts`

Phases: Phase 1 through Phase 3

```typescript
export interface ProjectRegistryPort {
  enrollProject(project: EnrolledProject): EnrolledProject;
  getProject(idOrAliasOrSlug: string): EnrolledProject | null;
  findByRepoSlug(repoSlug: string): EnrolledProject | null;
  findByLocalRoot(localRoot: string): EnrolledProject | null;
  listBySlackChannel(workspaceId: string, channelId: string): EnrolledProject[];
  listProjects(): EnrolledProject[];
  setRoleBinding(binding: ProjectRoleBinding): void;
  listRoleBindings(projectId: string): ProjectRoleBinding[];
  getFeatureThread(
    projectId: string,
    featureId: string,
  ): SlackFeatureThread | null;
  bindFeatureThread(thread: SlackFeatureThread): SlackFeatureThread;
  getActionReceipt(receiptKey: string): SlackActionReceipt | null;
  recordActionReceipt(receipt: SlackActionReceipt): boolean;
  close(): void;
}

export interface PullRequestSummary {
  prNumber: number;
  prUrl: string | null;
}

export interface VcsPort {
  getCurrentBranch(cwd: string): Promise<string> | string;
  isDirty(cwd: string): Promise<boolean> | boolean;
  createBranch(branchName: string, cwd: string): Promise<void> | void;
  syncBranch(branchName: string, cwd: string): Promise<void> | void;
  discoverIdentityFacts(cwd: string): ProjectIdentityFacts;
  resolvePullRequestUrl(
    cwd: string,
    query: { prNumber?: number; headBranch?: string },
  ): Promise<string | null> | string | null;
  mergePullRequest(cwd: string, prNumber: number): Promise<string> | string;
}

export function createSqliteProjectRegistryAdapter(
  options?: SqliteStoreOptions,
): ProjectRegistryPort;
```

`recordActionReceipt` uses `INSERT OR IGNORE` on `receipt_key`. Replayed button clicks and reactions return `false`. `getProject` checks `projects.id` and `projects.slug`, then `projects.repo_slug` and `project_aliases.alias_id`. SQLite read helpers match canonical IDs and registered aliases without duplicating rows.
