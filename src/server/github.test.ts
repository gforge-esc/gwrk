/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  EnrolledProject,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { VcsPort } from "../ports/vcs-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { githubWebhookPlugin } from "./github.js";

const {
  harvestFeatureMock,
  syncTrunkForHarvestMock,
  upsertIssueMock,
  updateIssueMock,
  notifyIssueOpenedMock,
} = vi.hoisted(() => ({
  harvestFeatureMock: vi.fn().mockResolvedValue(undefined),
  syncTrunkForHarvestMock: vi.fn(),
  upsertIssueMock: vi.fn(),
  updateIssueMock: vi.fn(),
  notifyIssueOpenedMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../engine/harvest.js", () => ({
  harvestFeature: harvestFeatureMock,
}));

vi.mock("../utils/git.js", async () => {
  const actual =
    await vi.importActual<typeof import("../utils/git.js")>("../utils/git.js");
  return {
    ...actual,
    syncTrunkForHarvest: syncTrunkForHarvestMock,
  };
});

vi.mock("../db/issues.js", () => ({
  upsertIssue: upsertIssueMock,
  updateIssue: updateIssueMock,
}));

vi.mock("../engine/issues.js", async () => {
  const actual = await vi.importActual<typeof import("../engine/issues.js")>(
    "../engine/issues.js",
  );
  return {
    ...actual,
    notifyIssueOpened: notifyIssueOpenedMock,
  };
});

const mockConfig = {
  server: {},
} as GwrkConfig;

const enrolledProject: EnrolledProject = {
  projectId: "proj-custom",
  slug: "custom",
  name: "Custom Repo",
  repoSlug: "org/custom-repo",
  trunkBranch: "release",
  localRoot: "/repos/custom-repo",
  mirrorPath: "/mirrors/custom-repo",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W-CUSTOM",
    channelId: "C-CUSTOM",
    opsChannelId: "C-CUSTOM-OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

function makeRegistry(
  projects: EnrolledProject[],
  threads: Record<string, SlackFeatureThread> = {},
): ProjectRegistryPort {
  return {
    enrollProject: (p) => p,
    getProject: (id) =>
      projects.find((p) => p.projectId === id || p.slug === id) ?? null,
    findByRepoSlug: (slug) => projects.find((p) => p.repoSlug === slug) ?? null,
    findByLocalRoot: (root) =>
      projects.find((p) => p.localRoot === root) ?? null,
    listBySlackChannel: () => [],
    listProjects: () => projects,
    setRoleBinding: () => {},
    listRoleBindings: () => [],
    getFeatureThread: (projectId, featureId) =>
      threads[`${projectId}:${featureId}`] ?? null,
    bindFeatureThread: (t) => t,
    getActionReceipt: () => null,
    claimActionReceipt: () => true,
    completeActionReceipt: () => true,
    close: () => {},
  };
}

describe("FR-H01/FR-H09/TC-H01: Webhook Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("US-H01: Valid PR merge webhook triggers harvest", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        merged: true,
        merged_at: "2026-04-01T09:15:00Z",
        merge_commit_sha: "abc1234567890",
        head: { ref: "feat/011-harvest" },
        base: { ref: "develop" },
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=invalid-signature-for-red-test",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("FR-H01/TC-H01: sandbox PRs ignored by harvest", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "task/sandbox-1" },
        base: { ref: "feat/some-feature" },
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(harvestFeatureMock).not.toHaveBeenCalled();
  });

  it("FR-H09: only triggers for base=develop or base=main", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "feat/some-feature" },
        base: { ref: "other-branch" },
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(harvestFeatureMock).not.toHaveBeenCalled();
  });

  it("TC-H03: should return 401 if HMAC signature is invalid", async () => {
    const server = fastify();
    const configWithSecret = {
      server: { githubWebhookSecret: "mock_secret" },
    } as GwrkConfig;
    await githubWebhookPlugin(server, {
      config: configWithSecret,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: { merged: true },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=invalid-signature",
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("T033: fails closed for unenrolled repositories when registry is provided", async () => {
    const registry = makeRegistry([enrolledProject]);
    const vcs = {
      resolvePullRequestUrl: vi.fn(),
    } as unknown as VcsPort;

    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
      registry,
      vcs,
    });

    const prResponse = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload: {
        action: "closed",
        repository: { full_name: "org/unenrolled" },
        pull_request: {
          number: 99,
          merged: true,
          head: { ref: "feat/048-shared-phase-01" },
          base: { ref: "main" },
        },
      },
    });

    expect(prResponse.statusCode).toBe(200);
    expect(prResponse.json()).toEqual({
      status: "ignored",
      reason: "unenrolled_repository",
    });
    expect(vcs.resolvePullRequestUrl).not.toHaveBeenCalled();
    expect(harvestFeatureMock).not.toHaveBeenCalled();

    const issueResponse = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "issues" },
      payload: {
        action: "opened",
        repository: { full_name: "org/unenrolled" },
        issue: {
          number: 7,
          title: "[048-shared] Bug",
          body: "desc",
          state: "open",
          html_url: "https://github.com/org/unenrolled/issues/7",
          created_at: "2026-11-18T00:00:00Z",
          user: { login: "alice" },
          labels: [{ name: "feature:048-shared" }],
        },
      },
    });

    expect(issueResponse.statusCode).toBe(200);
    expect(issueResponse.json()).toEqual({
      status: "ignored",
      reason: "unenrolled_repository",
    });
    expect(upsertIssueMock).not.toHaveBeenCalled();
  });

  it("T033: validates baseRef against enrolled trunkBranch, verifies PR via VcsPort, and attaches projectId and thread recipient", async () => {
    const storedThread: SlackFeatureThread = {
      projectId: "proj-custom",
      featureId: "048-shared",
      workspaceId: "W-CUSTOM",
      channelId: "C-CUSTOM",
      rootTs: "1700000123.000456",
      updatedAt: "2026-11-18T01:00:00.000Z",
    };
    const registry = makeRegistry([enrolledProject], {
      "proj-custom:048-shared": storedThread,
    });
    const vcs = {
      resolvePullRequestUrl: vi
        .fn()
        .mockResolvedValue("https://github.com/org/custom-repo/pull/88"),
    } as unknown as VcsPort;

    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/fallback",
      registry,
      vcs,
    });

    // 'develop' does NOT match enrolled trunkBranch 'release' -> ignored
    const wrongTrunkRes = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload: {
        action: "closed",
        repository: { full_name: "org/custom-repo" },
        pull_request: {
          number: 88,
          merged: true,
          head: { ref: "feat/048-shared-phase-01" },
          base: { ref: "develop" },
        },
      },
    });
    expect(wrongTrunkRes.json()).toEqual({
      status: "ignored",
      reason: "not_trunk_target",
    });
    expect(harvestFeatureMock).not.toHaveBeenCalled();

    // 'release' matches enrolled trunkBranch -> resolves via VcsPort and harvests in enrolled checkout
    const res = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload: {
        action: "closed",
        repository: { full_name: "org/custom-repo" },
        pull_request: {
          number: 88,
          merged: true,
          html_url: "https://unverified.invalid/pull/88",
          merged_at: "2026-11-18T02:00:00Z",
          merge_commit_sha: "deadbeef",
          merged_by: { login: "alice" },
          head: { ref: "feat/048-shared-phase-01" },
          base: { ref: "release" },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: "accepted",
      featureId: "048-shared",
      phaseId: "phase-01",
    });
    expect(vcs.resolvePullRequestUrl).toHaveBeenCalledWith(
      "/mirrors/custom-repo",
      {
        prNumber: 88,
        headBranch: "feat/048-shared-phase-01",
        expectedRepository: "org/custom-repo",
      },
    );
    expect(syncTrunkForHarvestMock).toHaveBeenCalledWith(
      "/mirrors/custom-repo",
      "release",
    );
    expect(harvestFeatureMock).toHaveBeenCalledWith(
      "/mirrors/custom-repo",
      expect.objectContaining({
        projectId: "proj-custom",
        featureId: "048-shared",
        phaseId: "phase-01",
        prNumber: 88,
        prUrl: "https://github.com/org/custom-repo/pull/88",
        recipient: {
          projectId: "proj-custom",
          surface: "slack",
          workspaceId: "W-CUSTOM",
          channelId: "C-CUSTOM",
          threadTs: "1700000123.000456",
        },
      }),
    );
  });

  it("T033: scopes issue upsert and closure to enrolled projectId", async () => {
    const registry = makeRegistry([enrolledProject]);
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/fallback",
      registry,
    });

    const opened = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "issues" },
      payload: {
        action: "opened",
        repository: { full_name: "org/custom-repo" },
        issue: {
          number: 15,
          title: "[048-shared] Fix routing",
          body: "details",
          state: "open",
          html_url: "https://github.com/org/custom-repo/issues/15",
          created_at: "2026-11-18T00:00:00Z",
          user: { login: "alice" },
          labels: [{ name: "feature:048-shared" }],
        },
      },
    });

    expect(opened.statusCode).toBe(200);
    expect(upsertIssueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 15,
        feature_id: "048-shared",
      }),
      "proj-custom",
    );

    const closed = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "issues" },
      payload: {
        action: "closed",
        repository: { full_name: "org/custom-repo" },
        issue: {
          number: 15,
          title: "[048-shared] Fix routing",
          body: "details",
          state: "closed",
          html_url: "https://github.com/org/custom-repo/issues/15",
          created_at: "2026-11-18T00:00:00Z",
          closed_at: "2026-11-18T03:00:00Z",
          user: { login: "alice" },
          labels: [{ name: "feature:048-shared" }],
        },
      },
    });

    expect(closed.statusCode).toBe(200);
    expect(updateIssueMock).toHaveBeenCalledWith(
      15,
      "proj-custom",
      expect.objectContaining({
        state: "closed",
        closed_at: "2026-11-18T03:00:00Z",
      }),
    );
  });
});
