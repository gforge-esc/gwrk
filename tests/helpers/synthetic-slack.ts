/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  EnrolledProject,
  ProjectRoleBinding,
  SlackActionReceipt,
  SlackFeatureThread,
} from "../../src/domain/project-registry.js";
import type {
  NotificationPayload,
  NotificationPort,
  NotificationReceipt,
  SlackDeliveryStatus,
} from "../../src/ports/notification-port.js";
import type { ProjectRegistryPort } from "../../src/ports/store-port.js";
import type { VcsPort } from "../../src/ports/vcs-port.js";

export const SYNTHETIC_WORKSPACE_ID = "T_SYNTHETIC";
export const SYNTHETIC_CHANNEL_ALPHA = "C_ALPHA";
export const SYNTHETIC_CHANNEL_BETA = "C_BETA";
export const SYNTHETIC_USER_VIEWER = "U_VIEWER";
export const SYNTHETIC_USER_OPERATOR = "U_OPERATOR";
export const SYNTHETIC_USER_MAINTAINER = "U_MAINTAINER";

export const SYNTHETIC_PROJECT_ALPHA: EnrolledProject = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Project Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/tmp/synthetic-alpha",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    channelId: SYNTHETIC_CHANNEL_ALPHA,
    opsChannelId: "C_OPS",
    sharedChannel: false,
  },
  legacyProjectIds: ["legacy-alpha"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const SYNTHETIC_PROJECT_BETA: EnrolledProject = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Project Beta",
  repoSlug: "org/beta",
  trunkBranch: "develop",
  localRoot: "/tmp/synthetic-beta",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: SYNTHETIC_WORKSPACE_ID,
    channelId: SYNTHETIC_CHANNEL_BETA,
    opsChannelId: "C_OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export const SYNTHETIC_ROLES: ProjectRoleBinding[] = [
  {
    projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
    principalType: "slack_user",
    principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
    role: "viewer",
  },
  {
    projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
    principalType: "slack_user",
    principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_OPERATOR}`,
    role: "operator",
  },
  {
    projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
    principalType: "slack_user",
    principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_MAINTAINER}`,
    role: "maintainer",
  },
  {
    projectId: SYNTHETIC_PROJECT_BETA.projectId,
    principalType: "slack_user",
    principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_MAINTAINER}`,
    role: "maintainer",
  },
];

export const SYNTHETIC_THREAD_ALPHA: SlackFeatureThread = {
  projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
  featureId: "003-slack",
  workspaceId: SYNTHETIC_WORKSPACE_ID,
  channelId: SYNTHETIC_CHANNEL_ALPHA,
  rootTs: "1731320000.000100",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export function createSyntheticRegistry(seed?: {
  projects?: EnrolledProject[];
  roles?: ProjectRoleBinding[];
  threads?: SlackFeatureThread[];
  receipts?: SlackActionReceipt[];
}): ProjectRegistryPort {
  const projects = new Map<string, EnrolledProject>();
  const roles: ProjectRoleBinding[] = [...(seed?.roles ?? SYNTHETIC_ROLES)];
  const threads = new Map<string, SlackFeatureThread>();
  const receipts = new Map<string, SlackActionReceipt>();

  for (const p of seed?.projects ?? [
    SYNTHETIC_PROJECT_ALPHA,
    SYNTHETIC_PROJECT_BETA,
  ]) {
    projects.set(p.projectId, p);
  }
  for (const t of seed?.threads ?? [SYNTHETIC_THREAD_ALPHA]) {
    threads.set(`${t.projectId}:${t.featureId}`, t);
  }
  for (const r of seed?.receipts ?? []) {
    receipts.set(r.receiptKey, r);
  }

  return {
    enrollProject(project: EnrolledProject): EnrolledProject {
      projects.set(project.projectId, project);
      return project;
    },
    getProject(idOrAliasOrSlug: string): EnrolledProject | null {
      for (const p of projects.values()) {
        if (
          p.projectId === idOrAliasOrSlug ||
          p.slug === idOrAliasOrSlug ||
          p.repoSlug === idOrAliasOrSlug ||
          p.legacyProjectIds.includes(idOrAliasOrSlug)
        ) {
          return p;
        }
      }
      return null;
    },
    findByRepoSlug(repoSlug: string): EnrolledProject | null {
      for (const p of projects.values()) {
        if (p.repoSlug === repoSlug) return p;
      }
      return null;
    },
    findByLocalRoot(localRoot: string): EnrolledProject | null {
      for (const p of projects.values()) {
        if (p.localRoot === localRoot) return p;
      }
      return null;
    },
    listBySlackChannel(
      workspaceId: string,
      channelId: string,
    ): EnrolledProject[] {
      return Array.from(projects.values()).filter(
        (p) =>
          p.slack?.workspaceId === workspaceId &&
          (p.slack.channelId === channelId ||
            p.slack.opsChannelId === channelId),
      );
    },
    listProjects(): EnrolledProject[] {
      return Array.from(projects.values());
    },
    setRoleBinding(binding: ProjectRoleBinding): void {
      const idx = roles.findIndex(
        (r) =>
          r.projectId === binding.projectId &&
          r.principalType === binding.principalType &&
          r.principalId === binding.principalId,
      );
      if (idx >= 0) roles[idx] = binding;
      else roles.push(binding);
    },
    listRoleBindings(projectId: string): ProjectRoleBinding[] {
      return roles.filter((r) => r.projectId === projectId);
    },
    getFeatureThread(
      projectId: string,
      featureId: string,
    ): SlackFeatureThread | null {
      return threads.get(`${projectId}:${featureId}`) ?? null;
    },
    bindFeatureThread(thread: SlackFeatureThread): SlackFeatureThread {
      threads.set(`${thread.projectId}:${thread.featureId}`, thread);
      return thread;
    },
    getActionReceipt(receiptKey: string): SlackActionReceipt | null {
      return receipts.get(receiptKey) ?? null;
    },
    claimActionReceipt(receipt: SlackActionReceipt): boolean {
      if (receipts.has(receipt.receiptKey)) {
        return false;
      }
      receipts.set(receipt.receiptKey, receipt);
      return true;
    },
    completeActionReceipt(
      receiptKey: string,
      outcome: Exclude<SlackActionReceipt["outcome"], "claimed">,
    ): boolean {
      const existing = receipts.get(receiptKey);
      if (!existing) return false;
      existing.outcome = outcome;
      receipts.set(receiptKey, existing);
      return true;
    },
    close(): void {},
  };
}

export function createSyntheticNotificationPort(): NotificationPort & {
  sent: NotificationPayload[];
} {
  const sent: NotificationPayload[] = [];
  return {
    sent,
    async notify(payload: NotificationPayload): Promise<NotificationReceipt> {
      sent.push(payload);
      return {
        delivered: true,
        channelId: payload.channel ?? "C_DEFAULT",
        messageTs: payload.threadTs ?? "1731320000.000999",
        threadTs: payload.threadTs,
      };
    },
    async getUserPresence(): Promise<"active"> {
      return "active";
    },
    async getDeliveryStatus(): Promise<SlackDeliveryStatus> {
      return { mode: "socket_connected", connected: true };
    },
  };
}

export function createSyntheticVcsPort(
  overrides?: Partial<VcsPort>,
): VcsPort & {
  mergedPrs: Array<{ cwd: string; prNumber: number }>;
} {
  const mergedPrs: Array<{ cwd: string; prNumber: number }> = [];
  return {
    mergedPrs,
    getCurrentBranch: () => "main",
    isDirty: () => false,
    createBranch: () => {},
    syncBranch: () => {},
    discoverIdentityFacts: (cwd: string) => ({
      projectRoot: cwd,
      remoteOriginUrl: "git@github.com:org/alpha.git",
      gitCommonDir: `${cwd}/.git`,
    }),
    resolvePullRequestUrl: (_cwd: string, query: { prNumber?: number }) =>
      `https://github.com/org/alpha/pull/${query.prNumber ?? 42}`,
    mergePullRequest: (cwd: string, prNumber: number) => {
      mergedPrs.push({ cwd, prNumber });
      return `Merged PR #${prNumber}`;
    },
    ...overrides,
  };
}
