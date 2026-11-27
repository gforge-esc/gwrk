/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App } from "@slack/bolt";
import type { HeaderBlock, SectionBlock } from "@slack/types";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_ROLES,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { generatePulseReport } from "../engine/pulse.js";
import type { GwrkConfig } from "../utils/config.js";
import { getStatusData } from "./routes/status.js";
import { buildHomeTab, registerSlackHomeHandler } from "./slack-home.js";
import type { SystemStatus } from "./types.js";

vi.mock("./routes/status.js", () => ({ getStatusData: vi.fn() }));

vi.mock("../engine/pulse.js", () => ({
  generatePulseReport: vi.fn(() => ({
    generatedAt: new Date().toISOString(),
    repositories: [
      {
        repoName: "test-repo",
        mainLoc: 1000,
        draftLoc: 50,
      },
    ],
    specProgress: {
      totalSpecs: 10,
      totalPlans: 5,
    },
  })),
}));

const { mockGetPlanStatus, mockIsEmpty } = vi.hoisted(() => ({
  mockGetPlanStatus: vi.fn().mockReturnValue({
    features: [
      {
        id: "001-cli-core",
        status: "DEFINED",
        phases: [{ id: "phase-01", status: "DEFINED" }],
      },
    ],
    edges: [],
  }),
  mockIsEmpty: vi.fn().mockReturnValue(false),
}));

vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    getPlanStatus: mockGetPlanStatus,
    isEmpty: mockIsEmpty,
  })),
}));

function initCheckout(
  project: typeof SYNTHETIC_PROJECT_ALPHA,
  localRoot: string,
) {
  mkdirSync(localRoot, { recursive: true });
  const gitOptions = {
    cwd: localRoot,
    stdio: "ignore" as const,
    timeout: 5_000,
  };
  execFileSync("git", ["init", "--quiet"], gitOptions);
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${project.repoSlug}.git`],
    gitOptions,
  );
  execFileSync(
    "git",
    ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"],
    gitOptions,
  );
  return { ...project, projectId: resolveProjectId(localRoot), localRoot };
}

function homeRegistry(
  alpha: typeof SYNTHETIC_PROJECT_ALPHA,
  beta: typeof SYNTHETIC_PROJECT_ALPHA,
  roles = SYNTHETIC_ROLES,
) {
  return createSyntheticRegistry({
    projects: [alpha, beta],
    roles: roles.map((role) => ({
      ...role,
      projectId:
        role.projectId === SYNTHETIC_PROJECT_ALPHA.projectId
          ? alpha.projectId
          : beta.projectId,
    })),
  });
}

function createHomeCheckouts() {
  const root = mkdtempSync(join(tmpdir(), "gwrk-home-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return {
    alpha: initCheckout(SYNTHETIC_PROJECT_ALPHA, join(root, "alpha")),
    beta: initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta")),
  };
}

describe("slack-home", () => {
  const mockStatus: SystemStatus = {
    server: {
      status: "running",
      lifecycle: "ready",
      uptime: 3600,
    },
    system: {
      cpuPercent: 10,
      memPercent: 20,
      diskFreeGb: 50,
    },
    network: {
      status: "online",
    },
    dispatch: {
      queueDepth: 1,
      activeCount: 1,
      completedCount: 10,
      failedCount: 2,
      paused: false,
    },
    sandboxes: [
      {
        containerId: "test-container",
        featureId: "001-cli-core",
        phaseId: "phase-02",
        backend: "docker",
        status: "running",
        startedAt: new Date().toISOString(),
        cpuPercent: 5,
        memMb: 128,
      },
    ],
  };

  const mockConfig: GwrkConfig = {
    server: {
      host: "localhost",
      port: 3000,
      heartbeatIntervalMs: 1000,
      networkCheckIntervalMs: 1000,
      parallelism: 1,
    },
    agents: { docker: { image: "gwrk-sandbox" } },
  } as unknown as GwrkConfig;

  it("builds the home tab with all expected sections", async () => {
    const { alpha, beta } = createHomeCheckouts();
    const homeView = await buildHomeTab(
      mockStatus,
      mockConfig,
      alpha.localRoot,
      {
        userId: SYNTHETIC_USER_VIEWER,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        registry: homeRegistry(alpha, beta),
        queueProjectId: alpha.projectId,
      },
    );

    expect(homeView.type).toBe("home");
    const blocks = homeView.blocks;

    // Check Header
    expect(blocks[0].type).toBe("header");
    expect((blocks[0] as HeaderBlock).text.text).toContain(
      "gwrk Operations Dashboard",
    );

    // Check Server Status
    const serverStatusBlock = blocks[1] as SectionBlock;
    expect(serverStatusBlock.text?.text).toContain("🟢 Online");
    expect(serverStatusBlock.text?.text).toContain("🌐 Online");

    // Check Plan DAG Status section
    const planDagIdx = blocks.findIndex(
      (b) =>
        b.type === "section" &&
        (b as SectionBlock).text?.text === "📐 *Plan DAG Status*",
    );
    expect(planDagIdx).toBeGreaterThan(-1);
    expect((blocks[planDagIdx + 1] as SectionBlock).text?.text).toContain(
      "001-cli-core",
    );

    // Check Dispatch Queue section
    const dispatchIdx = blocks.findIndex(
      (b) =>
        b.type === "section" &&
        (b as SectionBlock).text?.text === "📥 *Dispatch Queue*",
    );
    expect(dispatchIdx).toBeGreaterThan(-1);
    expect((blocks[dispatchIdx + 1] as SectionBlock).fields?.[0].text).toMatch(
      /Queue Depth.*1/,
    );

    // Check System Resources section
    const resourcesIdx = blocks.findIndex(
      (b) =>
        b.type === "section" &&
        (b as SectionBlock).text?.text === "📊 *System Resources*",
    );
    expect(resourcesIdx).toBeGreaterThan(-1);
    expect((blocks[resourcesIdx + 1] as SectionBlock).fields?.[0].text).toMatch(
      /CPU.*10\.0%/,
    );

    // Check Pulse Summary
    const pulseIdx = blocks.findIndex(
      (b) =>
        b.type === "section" &&
        (b as SectionBlock).text?.text === "📉 *Pulse Summary*",
    );
    expect(pulseIdx).toBeGreaterThan(-1);
    expect((blocks[pulseIdx + 1] as SectionBlock).text?.text).toContain(
      "test-repo",
    );
  });

  it("handles empty plan dag", async () => {
    const { alpha, beta } = createHomeCheckouts();
    mockIsEmpty.mockReturnValueOnce(true);
    const homeView = await buildHomeTab(
      mockStatus,
      mockConfig,
      alpha.localRoot,
      {
        userId: SYNTHETIC_USER_VIEWER,
        workspaceId: SYNTHETIC_WORKSPACE_ID,
        registry: homeRegistry(alpha, beta),
        queueProjectId: alpha.projectId,
      },
    );
    expect(
      homeView.blocks.some(
        (b) =>
          b.type === "section" &&
          (b as SectionBlock).text?.text === "_No active plans._",
      ),
    ).toBe(true);
  });

  describe("TR-012: Enrolled project visibility and role-gated startup project details", () => {
    it.each([
      {
        source: "body",
        userId: SYNTHETIC_USER_VIEWER,
        project: SYNTHETIC_PROJECT_ALPHA,
      },
      {
        source: "context",
        userId: SYNTHETIC_USER_VIEWER,
        project: SYNTHETIC_PROJECT_ALPHA,
      },
      { source: "body", userId: "U_BETA", project: SYNTHETIC_PROJECT_BETA },
      { source: "body", userId: "U_UNBOUND", project: undefined },
      { source: "body", userId: "U_BARE", project: undefined },
    ])(
      "uses the $source workspace and checks $userId on first App Home open",
      async ({ source, userId, project }) => {
        const { alpha, beta } = createHomeCheckouts();
        const event = vi.fn();
        const publish = vi.fn();
        vi.mocked(getStatusData).mockImplementation(
          async (
            _monitor,
            _queue,
            _sandbox,
            _lifecycle,
            _network,
            _server,
            scope,
          ) => ({
            ...mockStatus,
            ...(scope?.projectId ? { projectId: scope.projectId } : {}),
          }),
        );
        await registerSlackHomeHandler(
          { event } as unknown as App,
          {
            config: mockConfig,
            projectRoot: alpha.localRoot,
            registry: homeRegistry(alpha, beta, [
              ...SYNTHETIC_ROLES,
              {
                projectId: SYNTHETIC_PROJECT_BETA.projectId,
                principalType: "slack_user",
                principalId: `${SYNTHETIC_WORKSPACE_ID}:U_BETA`,
                role: "viewer",
              },
              {
                projectId: SYNTHETIC_PROJECT_ALPHA.projectId,
                principalType: "slack_user",
                principalId: "U_BARE",
                role: "viewer",
              },
            ]),
          } as Parameters<typeof registerSlackHomeHandler>[1],
        );
        expect(event).toHaveBeenCalledWith(
          "app_home_opened",
          expect.any(Function),
        );
        await event.mock.calls[0][1]({
          event: {
            type: "app_home_opened",
            tab: "home",
            user: userId,
          },
          body: source === "body" ? { team_id: SYNTHETIC_WORKSPACE_ID } : {},
          context:
            source === "context" ? { teamId: SYNTHETIC_WORKSPACE_ID } : {},
          client: { views: { publish } },
          logger: { error: vi.fn() },
        });
        expect(publish).toHaveBeenCalledOnce();
        const { view } = publish.mock.calls[0][0];
        const blocks = JSON.stringify(view.blocks);
        if (project === SYNTHETIC_PROJECT_ALPHA) {
          expect(blocks).toContain(SYNTHETIC_PROJECT_ALPHA.name);
          expect(blocks).not.toContain(SYNTHETIC_PROJECT_BETA.name);
          expect(blocks).toContain("001-cli-core");
          expect(blocks).toContain("Queue Depth");
        } else {
          expect(blocks).toContain(
            project?.name ?? "No enrolled projects accessible",
          );
          expect(blocks).not.toContain(SYNTHETIC_PROJECT_ALPHA.name);
          expect(blocks).not.toContain("001-cli-core");
          expect(blocks).not.toContain("Queue Depth");
          expect(blocks).not.toContain("Plan DAG Status");
        }
      },
    );

    it("scans Pulse repositories and spec progress only for visible checkouts", async () => {
      const actual =
        await vi.importActual<typeof import("../engine/pulse.js")>(
          "../engine/pulse.js",
        );
      vi.mocked(generatePulseReport).mockImplementationOnce(
        actual.generatePulseReport,
      );
      const root = mkdtempSync(join(tmpdir(), "gwrk-home-pulse-"));
      onTestFinished(() => rmSync(root, { recursive: true, force: true }));
      const alpha = initCheckout(
        SYNTHETIC_PROJECT_ALPHA,
        join(root, "alpha-pulse"),
      );
      const beta = initCheckout(
        SYNTHETIC_PROJECT_BETA,
        join(root, "beta-pulse"),
      );
      for (const [project, features] of [
        [alpha, ["001-alpha", "002-alpha"]],
        [beta, ["001-beta", "002-beta", "003-beta"]],
      ] as const) {
        for (const feature of features) {
          const specRoot = join(project.localRoot, "specs", feature);
          mkdirSync(specRoot, { recursive: true });
          writeFileSync(join(specRoot, "spec.md"), "# Spec\n");
        }
        writeFileSync(
          join(project.localRoot, "specs", features[0], "plan.md"),
          "# Plan\n",
        );
      }
      mkdirSync(join(alpha.localRoot, "specs/004-foreign"));
      symlinkSync(
        join(beta.localRoot, "specs/001-beta/plan.md"),
        join(alpha.localRoot, "specs/004-foreign/plan.md"),
      );
      const alphaAlias = join(root, "alpha-alias");
      symlinkSync(alpha.localRoot, alphaAlias, "dir");
      const view = await buildHomeTab(
        mockStatus,
        {
          ...mockConfig,
          pulse: { repos: [alphaAlias, beta.localRoot] },
        },
        alpha.localRoot,
        {
          registry: homeRegistry(alpha, beta),
          queueProjectId: alpha.projectId,
          userId: SYNTHETIC_USER_VIEWER,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
        },
      );
      const blocks = JSON.stringify(view.blocks);
      expect.soft(blocks).toContain("*alpha-pulse*:");
      expect.soft(blocks).not.toContain("beta-pulse");
      expect(blocks).toContain("Spec Progress: 1/2 plans ready");
    });

    it.each([false, true])(
      "hides replacement checkout status and scopes Pulse with verified mirror available: %s",
      async (useMirror) => {
        const actual =
          await vi.importActual<typeof import("../engine/pulse.js")>(
            "../engine/pulse.js",
          );
        vi.mocked(generatePulseReport).mockImplementationOnce(
          actual.generatePulseReport,
        );
        const root = mkdtempSync(join(tmpdir(), "gwrk-home-replacement-"));
        onTestFinished(() => rmSync(root, { recursive: true, force: true }));
        const alpha = initCheckout(
          SYNTHETIC_PROJECT_ALPHA,
          join(root, "alpha-enrolled-path"),
        );
        const beta = initCheckout(SYNTHETIC_PROJECT_BETA, join(root, "beta"));
        const betaFeature = join(beta.localRoot, "specs", "001-beta");
        mkdirSync(betaFeature, { recursive: true });
        writeFileSync(join(betaFeature, "spec.md"), "# Beta spec");
        renameSync(alpha.localRoot, join(root, "saved-alpha"));
        renameSync(beta.localRoot, alpha.localRoot);

        const repos = [alpha.localRoot];
        let mirrorPath: string | null = null;
        if (useMirror) {
          const mirror = initCheckout(
            SYNTHETIC_PROJECT_ALPHA,
            join(root, "alpha-mirror"),
          );
          const alphaFeature = join(mirror.localRoot, "specs", "001-alpha");
          mkdirSync(alphaFeature, { recursive: true });
          writeFileSync(join(alphaFeature, "spec.md"), "# Alpha spec");
          writeFileSync(join(alphaFeature, "plan.md"), "# Alpha plan");
          mirrorPath = mirror.localRoot;
          repos.push(mirror.localRoot);
        }
        const view = await buildHomeTab(
          {
            ...mockStatus,
            dispatch: { ...mockStatus.dispatch, queueDepth: 17 },
            sandboxes: [{ ...mockStatus.sandboxes[0], featureId: "001-beta" }],
          },
          {
            ...mockConfig,
            pulse: { repos },
          },
          alpha.localRoot,
          {
            registry: homeRegistry({ ...alpha, mirrorPath }, beta),
            userId: SYNTHETIC_USER_VIEWER,
            workspaceId: SYNTHETIC_WORKSPACE_ID,
          },
        );
        const blocks = JSON.stringify(view.blocks);
        expect.soft(blocks).toContain(alpha.name);
        expect.soft(blocks).not.toContain(beta.name);
        expect.soft(blocks).not.toContain("Active Agents");
        expect.soft(blocks).not.toContain("001-beta");
        expect.soft(blocks).not.toContain("Dispatch Queue");
        expect.soft(blocks).not.toContain("*Queue Depth:* 17");
        expect.soft(blocks).not.toContain("Plan DAG Status");
        expect.soft(blocks).not.toContain("*alpha-enrolled-path*:");
        expect
          .soft(blocks)
          .toContain(
            useMirror
              ? "Spec Progress: 1/1 plans ready"
              : "Spec Progress: 0/0 plans ready",
          );
        if (useMirror) expect(blocks).toContain("*alpha-mirror*:");
      },
    );

    it.each([false, true])(
      "does not reassign cached Alpha status to a Beta-only viewer after checkout replacement with provenance %s",
      async (withProvenance) => {
        const { alpha, beta } = createHomeCheckouts();
        const queueProjectId = withProvenance ? alpha.projectId : undefined;
        const saved = `${alpha.localRoot}-saved`;
        renameSync(alpha.localRoot, saved);
        renameSync(beta.localRoot, alpha.localRoot);
        const registry = homeRegistry(
          alpha,
          { ...beta, localRoot: alpha.localRoot },
          [
            {
              projectId: beta.projectId,
              principalType: "slack_user",
              principalId: `${SYNTHETIC_WORKSPACE_ID}:U_BETA`,
              role: "viewer",
            },
          ],
        );
        const view = await buildHomeTab(
          {
            ...mockStatus,
            dispatch: { ...mockStatus.dispatch, queueDepth: 17 },
            sandboxes: [
              { ...mockStatus.sandboxes[0], featureId: "001-alpha-private" },
            ],
          },
          mockConfig,
          alpha.localRoot,
          {
            registry,
            userId: "U_BETA",
            workspaceId: SYNTHETIC_WORKSPACE_ID,
            queueProjectId,
          },
        );
        const blocks = JSON.stringify(view.blocks);
        expect.soft(blocks).not.toContain("001-alpha-private");
        expect.soft(blocks).not.toContain("Active Agents");
        expect.soft(blocks).not.toContain("*Queue Depth:* 17");
        expect.soft(blocks).not.toContain("Plan DAG Status");
      },
    );

    it("retains startup status ownership across the App Home event boundary", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const event = vi.fn();
      const publish = vi.fn();
      let projects = [alpha, beta];
      const registry = {
        ...homeRegistry(alpha, beta, [
          {
            projectId: beta.projectId,
            principalType: "slack_user",
            principalId: `${SYNTHETIC_WORKSPACE_ID}:U_BETA`,
            role: "viewer",
          },
        ]),
        listProjects: () => projects,
      };
      vi.mocked(getStatusData).mockResolvedValue({
        ...mockStatus,
        dispatch: { ...mockStatus.dispatch, queueDepth: 17 },
        sandboxes: [
          { ...mockStatus.sandboxes[0], featureId: "001-alpha-private" },
        ],
      });
      await registerSlackHomeHandler(
        { event } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry,
        } as Parameters<typeof registerSlackHomeHandler>[1],
      );
      renameSync(alpha.localRoot, `${alpha.localRoot}-saved`);
      renameSync(beta.localRoot, alpha.localRoot);
      projects = [alpha, { ...beta, localRoot: alpha.localRoot }];
      await event.mock.calls[0][1]({
        event: { type: "app_home_opened", tab: "home", user: "U_BETA" },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      expect(publish).toHaveBeenCalledOnce();
      const blocks = JSON.stringify(publish.mock.calls[0][0].view.blocks);
      expect.soft(blocks).not.toContain("001-alpha-private");
      expect.soft(blocks).not.toContain("*Queue Depth:* 17");
    });

    it("hides sandbox details and queue counts from an unbound user", async () => {
      const view = await buildHomeTab(
        mockStatus,
        mockConfig,
        SYNTHETIC_PROJECT_ALPHA.localRoot!,
        {
          registry: createSyntheticRegistry(),
          userId: "U_STRANGER",
          workspaceId: SYNTHETIC_WORKSPACE_ID,
        },
      );
      const blocks = JSON.stringify(view.blocks);
      expect(blocks).toContain("No enrolled projects accessible");
      expect(blocks).not.toContain("001-cli-core");
      expect(blocks).not.toContain("Queue Depth");
    });

    it("renders only projects where viewer holds a role and includes startup project sections when authorized", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const homeView = await buildHomeTab(
        mockStatus,
        mockConfig,
        alpha.localRoot,
        {
          userId: SYNTHETIC_USER_VIEWER,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          registry: homeRegistry(alpha, beta),
          queueProjectId: alpha.projectId,
        },
      );

      const enrolledTexts = homeView.blocks
        .filter((b) => b.type === "section" && (b as SectionBlock).text?.text)
        .map((b) => (b as SectionBlock).text!.text);

      expect(
        enrolledTexts.some((t) => t.includes(SYNTHETIC_PROJECT_ALPHA.name)),
      ).toBe(true);
      expect(
        enrolledTexts.some((t) => t.includes(SYNTHETIC_PROJECT_BETA.name)),
      ).toBe(false);

      expect(enrolledTexts.some((t) => t.includes("Plan DAG Status"))).toBe(
        true,
      );
      expect(enrolledTexts.some((t) => t.includes("Pulse Summary"))).toBe(true);
    });

    it("shows Alpha Pulse and hides Beta startup status for an Alpha-only viewer", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const actual =
        await vi.importActual<typeof import("../engine/pulse.js")>(
          "../engine/pulse.js",
        );
      vi.mocked(generatePulseReport).mockImplementationOnce(
        actual.generatePulseReport,
      );
      const homeView = await buildHomeTab(
        mockStatus,
        { ...mockConfig, pulse: { repos: [alpha.localRoot, beta.localRoot] } },
        beta.localRoot,
        {
          userId: SYNTHETIC_USER_VIEWER,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          registry: homeRegistry(alpha, beta),
          queueProjectId: alpha.projectId,
        },
      );

      const blocks = JSON.stringify(homeView.blocks);
      expect.soft(blocks).toContain(alpha.name);
      expect.soft(blocks).not.toContain(beta.name);
      expect.soft(blocks).not.toContain("Active Agents");
      expect.soft(blocks).not.toContain("Dispatch Queue");
      expect.soft(blocks).not.toContain("Plan DAG Status");
      expect.soft(blocks).toContain("Pulse Summary");
      expect.soft(blocks).toContain("*alpha*:");
      expect(blocks).not.toContain("*beta*:");
    });

    it("returns no projects and omits startup sections when userId or workspaceId is missing", async () => {
      const registry = createSyntheticRegistry();
      const homeView = await buildHomeTab(
        mockStatus,
        mockConfig,
        SYNTHETIC_PROJECT_ALPHA.localRoot!,
        {
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          registry,
        },
      );

      const sectionTexts = homeView.blocks
        .filter((b) => b.type === "section" && (b as SectionBlock).text?.text)
        .map((b) => (b as SectionBlock).text!.text);

      expect(
        sectionTexts.some((t) =>
          t.includes("_No enrolled projects accessible for your account._"),
        ),
      ).toBe(true);
      expect(
        sectionTexts.some((t) => t.includes(SYNTHETIC_PROJECT_ALPHA.name)),
      ).toBe(false);
      expect(sectionTexts.some((t) => t.includes("Plan DAG Status"))).toBe(
        false,
      );
      expect(sectionTexts.some((t) => t.includes("Pulse Summary"))).toBe(false);
    });

    it.each(["opened", "select-startup"])(
      "isolates startup project status from other projects when Home is %s",
      async (trigger) => {
        const { alpha, beta } = createHomeCheckouts();
        const actual =
          await vi.importActual<typeof import("./routes/status.js")>(
            "./routes/status.js",
          );
        vi.mocked(getStatusData).mockImplementation(actual.getStatusData);
        const event = vi.fn();
        const action = vi.fn();
        const publish = vi.fn();
        const agents = [
          {
            ...mockStatus.sandboxes[0],
            projectId: alpha.projectId,
            featureId: "001-alpha-visible",
            workDir: alpha.localRoot,
          },
          {
            ...mockStatus.sandboxes[0],
            projectId: beta.projectId,
            featureId: "052-beta-private",
            workDir: beta.localRoot,
          },
        ];
        const records = agents.map((agent) => ({
          projectId: agent.projectId,
          workDir: agent.workDir,
          projectRoot: agent.workDir,
        }));
        await registerSlackHomeHandler(
          { event, action } as unknown as App,
          {
            config: mockConfig,
            projectRoot: alpha.localRoot,
            registry: homeRegistry(alpha, beta, SYNTHETIC_ROLES),
            queueProjectId: alpha.projectId,
            monitor: { getResources: () => mockStatus.system },
            queue: {
              getQueue: (id?: string) => ({
                active: records.filter((r) => !id || r.projectId === id),
                queued: [],
                paused: false,
              }),
              getQueueDepth: (id?: string) => (id === alpha.projectId ? 1 : 77),
              getActiveCount: (id?: string) => (id === alpha.projectId ? 1 : 2),
              getCompletedCount: () => 0,
              getFailedCount: () => 0,
            },
            sandbox: { listSandboxes: async () => agents },
            lifecycle: { getStatus: () => mockStatus.server.lifecycle },
            network: { getStatus: () => mockStatus.network.status },
          } as unknown as Parameters<typeof registerSlackHomeHandler>[1],
        );
        const context = {
          body: {
            team_id: SYNTHETIC_WORKSPACE_ID,
            team: { id: SYNTHETIC_WORKSPACE_ID },
            user: { id: SYNTHETIC_USER_VIEWER },
            actions: [
              { value: JSON.stringify({ projectId: alpha.projectId }) },
            ],
          },
          event: {
            type: "app_home_opened",
            tab: "home",
            user: SYNTHETIC_USER_VIEWER,
          },
          context: {},
          ack: vi.fn(),
          client: { views: { publish } },
          logger: { error: vi.fn() },
        };
        if (trigger === "opened") await event.mock.calls[0][1](context);
        else await action.mock.calls[0][1](context);
        expect(publish).toHaveBeenCalledOnce();
        const blocks = JSON.stringify(publish.mock.calls[0][0].view.blocks);
        expect(blocks).toContain("001-alpha-visible");
        expect(blocks).not.toContain("052-beta-private");
        expect(blocks).toContain("*Queue Depth:* 1");
        expect(blocks).not.toContain("*Queue Depth:* 77");
      },
    );

    it("handles switching back to startup project, reopening, and revoked selection safely", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const actual =
        await vi.importActual<typeof import("./routes/status.js")>(
          "./routes/status.js",
        );
      vi.mocked(getStatusData).mockImplementation(actual.getStatusData);
      const event = vi.fn();
      const action = vi.fn();
      const publish = vi.fn();
      const agents = [
        {
          ...mockStatus.sandboxes[0],
          projectId: alpha.projectId,
          featureId: "001-alpha-visible",
          workDir: alpha.localRoot,
        },
        {
          ...mockStatus.sandboxes[0],
          projectId: beta.projectId,
          featureId: "052-beta-private",
          workDir: beta.localRoot,
        },
      ];
      const records = agents.map((agent) => ({
        projectId: agent.projectId,
        workDir: agent.workDir,
        projectRoot: agent.workDir,
      }));
      let userRoles = [
        {
          projectId: alpha.projectId,
          principalType: "slack_user" as const,
          principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
          role: "viewer" as const,
        },
        {
          projectId: beta.projectId,
          principalType: "slack_user" as const,
          principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
          role: "viewer" as const,
        },
      ];
      const registry = {
        ...homeRegistry(alpha, beta),
        listRoleBindings: (projectId: string) =>
          userRoles.filter((r) => r.projectId === projectId),
      };
      await registerSlackHomeHandler(
        { event, action } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry,
          queueProjectId: alpha.projectId,
          monitor: { getResources: () => mockStatus.system },
          queue: {
            getQueue: (id?: string) => ({
              active: records.filter((r) => !id || r.projectId === id),
              queued: [],
              paused: false,
            }),
            getQueueDepth: (id?: string) =>
              id === alpha.projectId ? 1 : id === beta.projectId ? 2 : 77,
            getActiveCount: (id?: string) => (id ? 1 : 2),
            getCompletedCount: () => 0,
            getFailedCount: () => 0,
          },
          sandbox: { listSandboxes: async () => agents },
          lifecycle: { getStatus: () => mockStatus.server.lifecycle },
          network: { getStatus: () => mockStatus.network.status },
        } as unknown as Parameters<typeof registerSlackHomeHandler>[1],
      );

      const selectAction = action.mock.calls[0][1];
      const openEvent = event.mock.calls[0][1];

      // 1. Select Beta: scopes to Beta
      await selectAction({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [{ value: JSON.stringify({ projectId: beta.projectId }) }],
        },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      let blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).toContain("052-beta-private");
      expect(blocks).not.toContain("001-alpha-visible");
      expect(blocks).toContain("*Queue Depth:* 2");

      // 2. Switch back to Alpha: scopes to Alpha
      await selectAction({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [{ value: JSON.stringify({ projectId: alpha.projectId }) }],
        },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).toContain("001-alpha-visible");
      expect(blocks).not.toContain("052-beta-private");
      expect(blocks).toContain("*Queue Depth:* 1");
      expect(blocks).not.toContain("*Queue Depth:* 77");

      // 3. Reopening preserves Alpha selection
      await openEvent({
        event: {
          type: "app_home_opened",
          tab: "home",
          user: SYNTHETIC_USER_VIEWER,
        },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).toContain("001-alpha-visible");
      expect(blocks).not.toContain("052-beta-private");
      expect(blocks).toContain("*Queue Depth:* 1");

      // 4. Select Beta again, then revoke Beta role -> reopening fails closed
      await selectAction({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [{ value: JSON.stringify({ projectId: beta.projectId }) }],
        },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      userRoles = userRoles.filter((r) => r.projectId !== beta.projectId);
      await openEvent({
        event: {
          type: "app_home_opened",
          tab: "home",
          user: SYNTHETIC_USER_VIEWER,
        },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).not.toContain("052-beta-private");
      expect(blocks).not.toContain("001-alpha-visible");
      expect(blocks).not.toContain("Active Agents");
      expect(blocks).not.toContain("Dispatch Queue");
    });

    it("fails closed on reopening when the selected checkout path is replaced", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const actual =
        await vi.importActual<typeof import("./routes/status.js")>(
          "./routes/status.js",
        );
      vi.mocked(getStatusData).mockImplementation(actual.getStatusData);
      const event = vi.fn();
      const action = vi.fn();
      const publish = vi.fn();
      const agents = [
        {
          ...mockStatus.sandboxes[0],
          projectId: alpha.projectId,
          featureId: "001-alpha-visible",
          workDir: alpha.localRoot,
        },
      ];
      await registerSlackHomeHandler(
        { event, action } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry: homeRegistry(alpha, beta),
          queueProjectId: alpha.projectId,
          monitor: { getResources: () => mockStatus.system },
          queue: {
            getQueue: () => ({ active: [], queued: [], paused: false }),
            getQueueDepth: () => 1,
            getActiveCount: () => 1,
            getCompletedCount: () => 0,
            getFailedCount: () => 0,
          },
          sandbox: { listSandboxes: async () => agents },
          lifecycle: { getStatus: () => mockStatus.server.lifecycle },
          network: { getStatus: () => mockStatus.network.status },
        } as unknown as Parameters<typeof registerSlackHomeHandler>[1],
      );

      // Startup selection made
      await action.mock.calls[0][1]({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [{ value: JSON.stringify({ projectId: alpha.projectId }) }],
        },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      let blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).toContain("001-alpha-visible");

      // Replace checkout with a foreign folder
      renameSync(alpha.localRoot, `${alpha.localRoot}-backup`);
      mkdirSync(alpha.localRoot);

      // Reopening fails closed
      await event.mock.calls[0][1]({
        event: {
          type: "app_home_opened",
          tab: "home",
          user: SYNTHETIC_USER_VIEWER,
        },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      blocks = JSON.stringify(publish.mock.calls.at(-1)[0].view.blocks);
      expect(blocks).not.toContain("001-alpha-visible");
      expect(blocks).not.toContain("Active Agents");
      expect(blocks).not.toContain("Dispatch Queue");
    });

    it("supports interactive project selection in App Home and scopes status to the authorized selected project", async () => {
      const { alpha, beta } = createHomeCheckouts();
      const event = vi.fn();
      const action = vi.fn();
      const publish = vi.fn();
      const multiAccessRoles = [
        ...SYNTHETIC_ROLES,
        {
          projectId: beta.projectId,
          principalType: "slack_user" as const,
          principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
          role: "viewer" as const,
        },
      ];
      const registry = homeRegistry(alpha, beta, multiAccessRoles);

      vi.mocked(getStatusData).mockImplementation(
        async (_m, _q, _s, _l, _n, _f, opts) => ({
          ...mockStatus,
          ...(opts?.projectId ? { projectId: opts.projectId } : {}),
          dispatch: {
            ...mockStatus.dispatch,
            queueDepth: opts?.projectId === beta.projectId ? 4 : 1,
          },
          sandboxes: [
            {
              ...mockStatus.sandboxes[0],
              featureId:
                opts?.projectId === beta.projectId
                  ? "052-beta-feature"
                  : "001-cli-core",
            },
          ],
        }),
      );

      await registerSlackHomeHandler(
        { event, action } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry,
          queueProjectId: alpha.projectId,
        } as Parameters<typeof registerSlackHomeHandler>[1],
      );

      expect(action).toHaveBeenCalledWith(
        "select_home_project",
        expect.any(Function),
      );
      const selectHandler = action.mock.calls[0][1];
      const ack = vi.fn();

      // Viewer authorized for both alpha and beta selects beta in App Home
      await selectHandler({
        ack,
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [
            {
              value: JSON.stringify({
                projectId: beta.projectId,
                projectSlug: beta.slug,
              }),
            },
          ],
        },
        context: { teamId: SYNTHETIC_WORKSPACE_ID },
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });

      expect(ack).toHaveBeenCalledOnce();
      expect(publish).toHaveBeenCalledOnce();
      const selectedBlocks = JSON.stringify(
        publish.mock.calls[0][0].view.blocks,
      );
      expect(selectedBlocks).toContain(
        `*${beta.name}* (\`${beta.slug}\`) · *Selected*`,
      );
      expect(selectedBlocks).toContain("052-beta-feature");
      expect(selectedBlocks).toContain("*Queue Depth:* 4");

      // Subsequent app_home_opened preserves the authorized selection for that user
      publish.mockClear();
      await event.mock.calls[0][1]({
        event: {
          type: "app_home_opened",
          tab: "home",
          user: SYNTHETIC_USER_VIEWER,
        },
        body: { team_id: SYNTHETIC_WORKSPACE_ID },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      expect(publish).toHaveBeenCalledOnce();
      const reopenedBlocks = JSON.stringify(
        publish.mock.calls[0][0].view.blocks,
      );
      expect(reopenedBlocks).toContain(
        `*${beta.name}* (\`${beta.slug}\`) · *Selected*`,
      );
      expect(reopenedBlocks).toContain("052-beta-feature");

      // User without role on beta cannot select beta
      publish.mockClear();
      const alphaOnlyRegistry = homeRegistry(alpha, beta, SYNTHETIC_ROLES);
      const actionAlphaOnly = vi.fn();
      await registerSlackHomeHandler(
        { event: vi.fn(), action: actionAlphaOnly } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry: alphaOnlyRegistry,
          queueProjectId: alpha.projectId,
        } as Parameters<typeof registerSlackHomeHandler>[1],
      );
      await actionAlphaOnly.mock.calls[0][1]({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [
            {
              value: JSON.stringify({
                projectId: beta.projectId,
                projectSlug: beta.slug,
              }),
            },
          ],
        },
        context: { teamId: SYNTHETIC_WORKSPACE_ID },
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      const deniedBlocks = JSON.stringify(publish.mock.calls[0][0].view.blocks);
      expect(deniedBlocks).not.toContain("052-beta-feature");
      expect(deniedBlocks).not.toContain(`*${beta.name}*`);
    });
  });

  it.each([false, true])(
    "excludes replaced scope roots during async Home loading with startup selection %s",
    async (startup) => {
      const { alpha, beta } = createHomeCheckouts();
      const selected = startup ? alpha : beta;
      const mirror = initCheckout(
        startup ? SYNTHETIC_PROJECT_ALPHA : SYNTHETIC_PROJECT_BETA,
        join(selected.localRoot, "..", "verified-mirror"),
      );
      const selectedProject = { ...selected, mirrorPath: mirror.localRoot };
      const replacedRoot = startup ? mirror.localRoot : beta.localRoot;
      const canonicalRoot = realpathSync(replacedRoot);
      const actual =
        await vi.importActual<typeof import("./routes/status.js")>(
          "./routes/status.js",
        );
      vi.mocked(getStatusData).mockImplementation(actual.getStatusData);
      const event = vi.fn();
      const action = vi.fn();
      const publish = vi.fn();
      const roles = [
        ...SYNTHETIC_ROLES,
        {
          projectId: beta.projectId,
          principalType: "slack_user" as const,
          principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
          role: "viewer" as const,
        },
      ];
      await registerSlackHomeHandler(
        { event, action } as unknown as App,
        {
          config: mockConfig,
          projectRoot: alpha.localRoot,
          registry: homeRegistry(
            startup ? selectedProject : alpha,
            startup ? beta : selectedProject,
            roles,
          ),
          queueProjectId: alpha.projectId,
          monitor: { getResources: () => mockStatus.system },
          queue: {
            getQueue: () => ({ active: [], queued: [], paused: false }),
            getQueueDepth: () => 0,
            getActiveCount: () => 0,
            getCompletedCount: () => 0,
            getFailedCount: () => 0,
          },
          sandbox: {
            listSandboxes: async () => {
              renameSync(replacedRoot, `${replacedRoot}-original`);
              mkdirSync(replacedRoot);
              return [
                {
                  ...mockStatus.sandboxes[0],
                  projectId: undefined,
                  workDir: join(canonicalRoot, "foreign-checkout"),
                  featureId: "FOREIGN-REPLACEMENT-PRIVATE",
                },
              ];
            },
          },
          lifecycle: { getStatus: () => mockStatus.server.lifecycle },
          network: { getStatus: () => mockStatus.network.status },
        } as unknown as Parameters<typeof registerSlackHomeHandler>[1],
      );
      await action.mock.calls[0][1]({
        ack: vi.fn(),
        body: {
          team: { id: SYNTHETIC_WORKSPACE_ID },
          user: { id: SYNTHETIC_USER_VIEWER },
          actions: [
            { value: JSON.stringify({ projectId: selected.projectId }) },
          ],
        },
        context: {},
        client: { views: { publish } },
        logger: { error: vi.fn() },
      });
      expect(publish).toHaveBeenCalledOnce();
      const blocks = JSON.stringify(publish.mock.calls[0][0].view.blocks);
      expect(blocks).toContain(`*${selectedProject.name}*`);
      expect(blocks).not.toContain("FOREIGN-REPLACEMENT-PRIVATE");
    },
  );

  it("independent: hides selected project when its role is revoked during async status load", async () => {
    const { alpha, beta } = createHomeCheckouts();
    const actual =
      await vi.importActual<typeof import("./routes/status.js")>(
        "./routes/status.js",
      );
    vi.mocked(getStatusData).mockImplementation(actual.getStatusData);
    const event = vi.fn();
    const action = vi.fn();
    const publish = vi.fn();
    const roles = [
      ...SYNTHETIC_ROLES,
      {
        projectId: beta.projectId,
        principalType: "slack_user" as const,
        principalId: `${SYNTHETIC_WORKSPACE_ID}:${SYNTHETIC_USER_VIEWER}`,
        role: "viewer" as const,
      },
    ];
    const baseRegistry = homeRegistry(alpha, beta, roles);
    let revoked = false;
    const registry = {
      ...baseRegistry,
      listRoleBindings: (id: string) =>
        revoked && id === beta.projectId
          ? []
          : baseRegistry.listRoleBindings(id),
    };
    await registerSlackHomeHandler(
      { event, action } as unknown as App,
      {
        config: mockConfig,
        projectRoot: alpha.localRoot,
        registry,
        queueProjectId: alpha.projectId,
        monitor: { getResources: () => mockStatus.system },
        queue: {
          getQueue: () => ({ active: [], queued: [], paused: false }),
          getQueueDepth: () => 0,
          getActiveCount: () => 0,
          getCompletedCount: () => 0,
          getFailedCount: () => 0,
        },
        sandbox: {
          listSandboxes: async () => {
            revoked = true;
            return [
              {
                ...mockStatus.sandboxes[0],
                projectId: beta.projectId,
                workDir: beta.localRoot,
                featureId: "BETA-REVOKED-DURING-LOAD",
              },
            ];
          },
        },
        lifecycle: { getStatus: () => mockStatus.server.lifecycle },
        network: { getStatus: () => mockStatus.network.status },
      } as unknown as Parameters<typeof registerSlackHomeHandler>[1],
    );
    await action.mock.calls[0][1]({
      ack: vi.fn(),
      body: {
        team: { id: SYNTHETIC_WORKSPACE_ID },
        user: { id: SYNTHETIC_USER_VIEWER },
        actions: [{ value: JSON.stringify({ projectId: beta.projectId }) }],
      },
      context: {},
      client: { views: { publish } },
      logger: { error: vi.fn() },
    });
    expect(publish).toHaveBeenCalledOnce();
    const blocks = JSON.stringify(publish.mock.calls[0][0].view.blocks);
    expect(blocks).not.toContain("BETA-REVOKED-DURING-LOAD");
    expect(blocks).not.toContain("Active Agents");
    expect(blocks).not.toContain("Dispatch Queue");
  });
});
