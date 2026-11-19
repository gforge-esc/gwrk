/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrolledProject } from "../domain/project-registry.js";
import type { PlanStore } from "../engine/plan-store.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { GwrkConfig } from "../utils/config.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { notifySlack } from "./slack-notify.js";

vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue({ delivered: true }),
}));

vi.mock("../engine/drift-detector.js", () => ({
  DriftDetector: vi.fn().mockImplementation(() => ({
    verify: vi.fn().mockReturnValue([{ status: "CLEAN" }]),
  })),
}));

const baseConfig = {
  project: {
    name: "global-fallback",
    slack: {
      channelId: "C-GLOBAL-FEATURE",
      opsChannelId: "C-GLOBAL-OPS",
    },
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
    channelId: "C-ALPHA-FEATURE",
    opsChannelId: "C-ALPHA-OPS",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

const betaFeatureOnlyProject: EnrolledProject = {
  projectId: "proj-beta",
  slug: "beta",
  name: "Beta",
  repoSlug: "org/beta",
  trunkBranch: "develop",
  localRoot: "/repos/beta",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: {
    workspaceId: "W-BETA",
    channelId: "C-BETA-FEATURE",
    sharedChannel: false,
  },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00.000Z",
  updatedAt: "2026-11-18T00:00:00.000Z",
};

function makeRegistry(projects: EnrolledProject[]): ProjectRegistryPort {
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
    getFeatureThread: () => null,
    bindFeatureThread: (t) => t,
    getActionReceipt: () => null,
    claimActionReceipt: () => true,
    completeActionReceipt: () => true,
    close: () => {},
  };
}

function makeStalePlanStore(phaseId: string): PlanStore {
  return {
    isEmpty: vi.fn().mockReturnValue(false),
    getPlanStatus: vi.fn().mockReturnValue({
      features: [
        {
          id: "048-shared",
          name: "Shared",
          status: "IN_PROGRESS",
          phases: [
            {
              id: phaseId,
              name: "Phase 1",
              feature_id: "048-shared",
              status: "IN_PROGRESS",
              health: "GREEN",
              sp_estimate: 3,
              updated_at: new Date(
                Date.now() - 20 * 24 * 60 * 60 * 1000,
              ).toISOString(),
            },
          ],
        },
      ],
      edges: [],
    }),
    getSolver: vi.fn().mockResolvedValue({
      getReadyQueue: vi.fn().mockReturnValue([{ id: phaseId }]),
    }),
    updatePhase: vi.fn(),
  } as unknown as PlanStore;
}

describe("PlanHeartbeat per-project ops health (T035)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("evaluates enrolled projects independently and routes alerts with opsOnly: true only to explicit opsChannelId via notifier", async () => {
    const stores = new Map<string, PlanStore>([
      ["proj-alpha", makeStalePlanStore("P-ALPHA")],
      ["proj-beta", makeStalePlanStore("P-BETA")],
    ]);
    const createPlanStore = vi.fn(
      (projectId: string) => stores.get(projectId) as PlanStore,
    );
    const notifier: NotificationPort = {
      notify: vi.fn().mockResolvedValue({ delivered: true }),
    };
    const registry = makeRegistry([alphaProject, betaFeatureOnlyProject]);

    const heartbeat = new PlanHeartbeat(baseConfig, null, "/fallback", {
      registry,
      notifier,
      createPlanStore,
    });

    await heartbeat.runCheck();

    expect(createPlanStore).toHaveBeenCalledWith("proj-alpha");
    expect(createPlanStore).toHaveBeenCalledWith("proj-beta");
    expect(stores.get("proj-alpha")?.updatePhase).toHaveBeenCalledWith(
      "P-ALPHA",
      { health: "YELLOW" },
    );
    expect(stores.get("proj-beta")?.updatePhase).toHaveBeenCalledWith(
      "P-BETA",
      { health: "YELLOW" },
    );

    // Alpha has opsChannelId -> receives alert with opsOnly: true
    // Beta has only feature channelId and NO opsChannelId -> suppressed (no leak to feature or global channel)
    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-alpha",
        channel: "C-ALPHA-OPS",
        opsOnly: true,
        recipient: expect.objectContaining({
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-ALPHA",
          channelId: "C-ALPHA-OPS",
          opsOnly: true,
        }),
      }),
    );
    expect(notifySlack).not.toHaveBeenCalled();
  });

  it("falls back to notifySlack with opsOnly: true and registry when no notifier is injected", async () => {
    const stores = new Map<string, PlanStore>([
      ["proj-alpha", makeStalePlanStore("P-ALPHA")],
      ["proj-beta", makeStalePlanStore("P-BETA")],
    ]);
    const registry = makeRegistry([alphaProject, betaFeatureOnlyProject]);

    const heartbeat = new PlanHeartbeat(baseConfig, null, "/fallback", {
      registry,
      createPlanStore: (projectId) => stores.get(projectId) as PlanStore,
    });

    await heartbeat.runCheck();

    expect(notifySlack).toHaveBeenCalledTimes(1);
    expect(notifySlack).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C-ALPHA-OPS",
        text: expect.stringContaining("Build Plan Health Report"),
      }),
      undefined,
      expect.objectContaining({
        projectId: "proj-alpha",
        opsOnly: true,
        registry,
        recipient: expect.objectContaining({
          projectId: "proj-alpha",
          surface: "slack",
          workspaceId: "W-ALPHA",
          channelId: "C-ALPHA-OPS",
          opsOnly: true,
        }),
      }),
    );
  });
});
