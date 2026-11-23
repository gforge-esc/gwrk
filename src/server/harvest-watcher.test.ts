/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeProjectId } from "../domain/project-id.js";
import type {
  EnrolledProject,
  SlackFeatureThread,
} from "../domain/project-registry.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { type HarvestPullRequest, HarvestWatcher } from "./harvest-watcher.js";

const { getCompressionRecordMock, execCommandMock } = vi.hoisted(() => ({
  getCompressionRecordMock: vi.fn(),
  execCommandMock: vi.fn(),
}));

vi.mock("../db/compression.js", () => ({
  getCompressionRecord: getCompressionRecordMock,
}));

vi.mock("../utils/exec.js", () => ({
  execCommand: execCommandMock,
}));

const baseConfig = {
  project: { name: "gwrk" },
  server: {
    port: 18790,
    host: "localhost",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
} as unknown as GwrkConfig;

const alphaProject: EnrolledProject = {
  projectId: "proj-alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/repos/alpha",
  mirrorPath: "/mirrors/alpha",
  runnerPolicy: { allowedKinds: ["local", "hosted"] },
  slack: {
    workspaceId: "W-ALPHA",
    channelId: "C-ALPHA",
    opsChannelId: "C-ALPHA-OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const betaProject: EnrolledProject = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Beta",
  repoSlug: "org/beta",
  trunkBranch: "release",
  localRoot: "/repos/beta",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: "W-BETA",
    channelId: "C-BETA",
    opsChannelId: "C-BETA-OPS",
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

function createVerifiedProject(
  tmpBase: string,
  base: EnrolledProject,
  dirName: string,
): { project: EnrolledProject; checkout: string } {
  const dir = path.join(tmpBase, dirName);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  const remoteUrl = `https://github.com/${base.repoSlug}.git`;
  execFileSync("git", ["remote", "add", "origin", remoteUrl], {
    cwd: dir,
    stdio: "ignore",
  });
  const canonicalDir = fs.realpathSync(dir);
  const project: EnrolledProject = {
    ...base,
    projectId: computeProjectId({
      projectRoot: canonicalDir,
      remoteOriginUrl: remoteUrl,
    }),
    localRoot: canonicalDir,
    mirrorPath: null,
  };
  return { project, checkout: canonicalDir };
}

describe("HarvestWatcher multi-project enrollment (T034)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCompressionRecordMock.mockReturnValue(undefined);
  });

  it("watches multiple enrolled project roots using each project's trunkBranch and attaches projectId and thread recipients", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hw-multi-"));
    try {
      const alpha = createVerifiedProject(tmpBase, alphaProject, "alpha");
      const beta = createVerifiedProject(tmpBase, betaProject, "beta");

      const alphaThread: SlackFeatureThread = {
        projectId: alpha.project.projectId,
        featureId: "048-shared",
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        rootTs: "1700000001.000100",
        updatedAt: "2026-11-18T01:00:00.000Z",
      };
      const betaThread: SlackFeatureThread = {
        projectId: beta.project.projectId,
        featureId: "048-shared",
        workspaceId: "W-BETA",
        channelId: "C-BETA",
        rootTs: "1700000002.000200",
        updatedAt: "2026-11-18T01:00:00.000Z",
      };
      const registry = makeRegistry([alpha.project, beta.project], {
        [`${alpha.project.projectId}:048-shared`]: alphaThread,
        [`${beta.project.projectId}:048-shared`]: betaThread,
      });

      const listPullRequests = vi.fn(
        async (target: {
          projectId: string;
          projectRoot: string;
          baseBranch: string;
          repoSlug: string | null;
        }): Promise<HarvestPullRequest[]> => [
          {
            number: target.projectId === alpha.project.projectId ? 11 : 22,
            headRefName: "feat/048-shared-phase-01",
            mergedAt: "2026-11-18T02:00:00.000Z",
            closedAt: "2026-11-18T02:00:00.000Z",
            state: "MERGED",
            mergeCommit: { oid: `sha-${target.projectId}` },
            url: `https://github.com/${target.repoSlug}/pull/${target.projectId === alpha.project.projectId ? 11 : 22}`,
          },
        ],
      );
      const harvest = vi.fn().mockResolvedValue(undefined);
      const syncTrunk = vi.fn();

      const watcher = new HarvestWatcher(
        baseConfig,
        null,
        "/fallback",
        undefined,
        undefined,
        {
          registry,
          listPullRequests,
          harvest,
          syncTrunk,
        },
      );

      await watcher.runCheck();

      expect(listPullRequests).toHaveBeenCalledTimes(2);
      expect(listPullRequests).toHaveBeenNthCalledWith(1, {
        projectId: alpha.project.projectId,
        projectRoot: alpha.checkout,
        baseBranch: "main",
        repoSlug: "org/alpha",
      });
      expect(listPullRequests).toHaveBeenNthCalledWith(2, {
        projectId: beta.project.projectId,
        projectRoot: beta.checkout,
        baseBranch: "release",
        repoSlug: "org/beta",
      });

      expect(getCompressionRecordMock).toHaveBeenCalledWith(
        "048-shared",
        "phase-01",
        alpha.project.projectId,
        undefined,
      );
      expect(getCompressionRecordMock).toHaveBeenCalledWith(
        "048-shared",
        "phase-01",
        beta.project.projectId,
        undefined,
      );

      expect(syncTrunk).toHaveBeenCalledWith(alpha.checkout, "main", undefined);
      expect(syncTrunk).toHaveBeenCalledWith(
        beta.checkout,
        "release",
        undefined,
      );

      expect(harvest).toHaveBeenCalledTimes(2);
      expect(harvest).toHaveBeenNthCalledWith(
        1,
        alpha.checkout,
        expect.objectContaining({
          projectId: alpha.project.projectId,
          featureId: "048-shared",
          phaseId: "phase-01",
          prNumber: 11,
          recipient: {
            projectId: alpha.project.projectId,
            surface: "slack",
            workspaceId: "W-ALPHA",
            channelId: "C-ALPHA",
            threadTs: "1700000001.000100",
          },
        }),
        expect.objectContaining({ projectId: expect.any(String) }),
        undefined,
      );
      expect(harvest).toHaveBeenNthCalledWith(
        2,
        beta.checkout,
        expect.objectContaining({
          projectId: beta.project.projectId,
          featureId: "048-shared",
          phaseId: "phase-01",
          prNumber: 22,
          recipient: {
            projectId: beta.project.projectId,
            surface: "slack",
            workspaceId: "W-BETA",
            channelId: "C-BETA",
            threadTs: "1700000002.000200",
          },
        }),
        expect.objectContaining({ projectId: expect.any(String) }),
        undefined,
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("scopes idempotency by projectId so an already-harvested feature in Alpha still harvests in Beta", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hw-idem-"));
    try {
      const alpha = createVerifiedProject(tmpBase, alphaProject, "alpha");
      const beta = createVerifiedProject(tmpBase, betaProject, "beta");
      const registry = makeRegistry([alpha.project, beta.project]);
      getCompressionRecordMock.mockImplementation(
        (_featureId: string, _phaseId: string, projectId: string) =>
          projectId === alpha.project.projectId
            ? { feature_id: "048-shared" }
            : undefined,
      );

      const listPullRequests = vi.fn().mockResolvedValue([
        {
          number: 77,
          headRefName: "feat/048-shared-phase-01",
          mergedAt: "2026-11-18T02:00:00.000Z",
          closedAt: "2026-11-18T02:00:00.000Z",
          state: "MERGED",
          mergeCommit: { oid: "abc123" },
          url: "https://github.com/org/repo/pull/77",
        },
      ]);
      const harvest = vi.fn().mockResolvedValue(undefined);
      const syncTrunk = vi.fn();

      const watcher = new HarvestWatcher(
        baseConfig,
        null,
        "/fallback",
        undefined,
        undefined,
        {
          registry,
          listPullRequests,
          harvest,
          syncTrunk,
        },
      );

      await watcher.runCheck();

      expect(harvest).toHaveBeenCalledTimes(1);
      expect(harvest).toHaveBeenCalledWith(
        beta.checkout,
        expect.objectContaining({
          projectId: beta.project.projectId,
          featureId: "048-shared",
          phaseId: "phase-01",
        }),
        expect.objectContaining({ projectId: expect.any(String) }),
        undefined,
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("passes --repo <repoSlug> and project trunkBranch to gh pr list by default", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hw-gh-"));
    try {
      const alpha = createVerifiedProject(tmpBase, alphaProject, "alpha");
      const registry = makeRegistry([alpha.project]);
      execCommandMock.mockResolvedValue({
        exitCode: 0,
        stdout: "[]",
        stderr: "",
      });

      const watcher = new HarvestWatcher(
        baseConfig,
        null,
        "/fallback",
        undefined,
        undefined,
        {
          registry,
        },
      );

      await watcher.runCheck();

      expect(execCommandMock).toHaveBeenCalledWith(
        "gh",
        expect.arrayContaining([
          "pr",
          "list",
          "--repo",
          "org/alpha",
          "--base",
          "main",
        ]),
        undefined,
        { cwd: alpha.checkout, env: undefined, timeoutMs: 5_000 },
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it("T034 regression: skips enrolled projects whose checkout fails verification and ignores stale cross-channel threads", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hw-reg-"));
    const replacedAlphaDir = path.join(tmpBase, "alpha");
    const validBetaDir = path.join(tmpBase, "beta");
    fs.mkdirSync(replacedAlphaDir, { recursive: true });
    fs.mkdirSync(validBetaDir, { recursive: true });
    try {
      execFileSync("git", ["init"], {
        cwd: replacedAlphaDir,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["remote", "add", "origin", "https://github.com/org/beta.git"],
        { cwd: replacedAlphaDir, stdio: "ignore" },
      );

      execFileSync("git", ["init"], { cwd: validBetaDir, stdio: "ignore" });
      execFileSync(
        "git",
        ["remote", "add", "origin", "https://github.com/org/beta.git"],
        { cwd: validBetaDir, stdio: "ignore" },
      );

      const alphaEnrolled: EnrolledProject = {
        ...alphaProject,
        projectId: computeProjectId({
          projectRoot: replacedAlphaDir,
          remoteOriginUrl: "https://github.com/org/alpha.git",
        }),
        localRoot: replacedAlphaDir,
        mirrorPath: null,
      };
      const betaEnrolled: EnrolledProject = {
        ...betaProject,
        projectId: computeProjectId({
          projectRoot: validBetaDir,
          remoteOriginUrl: "https://github.com/org/beta.git",
        }),
        localRoot: validBetaDir,
        mirrorPath: null,
      };
      const staleBetaThread: SlackFeatureThread = {
        projectId: betaEnrolled.projectId,
        featureId: "048-shared",
        workspaceId: "W-BETA",
        channelId: "C-OLD-UNBOUND",
        rootTs: "1700000999.000100",
        updatedAt: "2026-11-18T00:00:00.000Z",
      };

      const registry = makeRegistry([alphaEnrolled, betaEnrolled], {
        [`${betaEnrolled.projectId}:048-shared`]: staleBetaThread,
      });
      const listPullRequests = vi.fn().mockResolvedValue([
        {
          number: 91,
          headRefName: "feat/048-shared-phase-01",
          mergedAt: "2026-11-18T02:00:00.000Z",
          closedAt: "2026-11-18T02:00:00.000Z",
          state: "MERGED",
          mergeCommit: { oid: "sha-beta" },
          url: "https://github.com/org/beta/pull/91",
        },
      ]);
      const harvest = vi.fn().mockResolvedValue(undefined);
      const syncTrunk = vi.fn();

      const watcher = new HarvestWatcher(
        baseConfig,
        null,
        "/fallback",
        undefined,
        undefined,
        {
          registry,
          listPullRequests,
          harvest,
          syncTrunk,
        },
      );

      await watcher.runCheck();

      expect(listPullRequests).toHaveBeenCalledTimes(1);
      expect(listPullRequests).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: betaEnrolled.projectId,
          projectRoot: fs.realpathSync(validBetaDir),
        }),
      );
      expect(harvest).toHaveBeenCalledTimes(1);
      expect(harvest).toHaveBeenCalledWith(
        fs.realpathSync(validBetaDir),
        expect.objectContaining({
          projectId: betaEnrolled.projectId,
          recipient: {
            projectId: betaEnrolled.projectId,
            surface: "slack",
            workspaceId: "W-BETA",
            channelId: "C-BETA",
            threadTs: undefined,
          },
        }),
        expect.objectContaining({ projectId: expect.any(String) }),
        undefined,
      );
    } finally {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
  it("drains an enrolled-project poll on stop and suppresses harvest and later project polls", async () => {
    const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-hw-stop-"));
    let release!: (prs: HarvestPullRequest[]) => void;
    const pending = new Promise<HarvestPullRequest[]>((resolve) => {
      release = resolve;
    });
    const listPullRequests = vi.fn().mockReturnValue(pending);
    const harvest = vi.fn();
    let watcher: HarvestWatcher | undefined;
    try {
      const alpha = createVerifiedProject(tmpBase, alphaProject, "alpha");
      const beta = createVerifiedProject(tmpBase, betaProject, "beta");
      watcher = new HarvestWatcher(
        baseConfig,
        null,
        "/fallback",
        undefined,
        undefined,
        {
          registry: makeRegistry([alpha.project, beta.project]),
          listPullRequests,
          harvest,
          syncTrunk: vi.fn(),
        },
      );
      watcher.start();
      expect(listPullRequests).toHaveBeenCalledTimes(1);
      let drained = false;
      const stopping = Promise.resolve(watcher.stop()).then(() => {
        drained = true;
      });
      await Promise.resolve();
      expect(drained).toBe(false);
      release([
        {
          number: 1,
          headRefName: "feat/048-shared-phase-01",
          state: "MERGED",
          mergedAt: "2026-11-18T00:00:00Z",
          closedAt: null,
          mergeCommit: { oid: "abc123" },
          url: "https://github.com/org/alpha/pull/1",
        },
      ]);
      await stopping;
      expect(drained).toBe(true);
      expect(listPullRequests).toHaveBeenCalledTimes(1);
      expect(harvest).not.toHaveBeenCalled();
      expect(getCompressionRecordMock).not.toHaveBeenCalled();
    } finally {
      release([]);
      await watcher?.stop();
      fs.rmSync(tmpBase, { recursive: true, force: true });
    }
  });
});
