/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { App } from "@slack/bolt";
import type { HeaderBlock, SectionBlock } from "@slack/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SYNTHETIC_PROJECT_ALPHA,
  SYNTHETIC_PROJECT_BETA,
  SYNTHETIC_USER_VIEWER,
  SYNTHETIC_WORKSPACE_ID,
  createSyntheticRegistry,
} from "../../tests/helpers/synthetic-slack.js";
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

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  readFileSync: vi.fn(() =>
    JSON.stringify({
      featureId: "001-cli-core",
      phaseId: "phase-01",
      status: "completed",
      createdAt: new Date().toISOString(),
    }),
  ),
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
    const homeView = await buildHomeTab(mockStatus, mockConfig, "/tmp");

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
    mockIsEmpty.mockReturnValue(true);
    const homeView = await buildHomeTab(mockStatus, mockConfig, "/tmp");
    expect(
      homeView.blocks.some(
        (b) =>
          b.type === "section" &&
          (b as SectionBlock).text?.text === "_No active plans._",
      ),
    ).toBe(true);
  });

  describe("TR-012: Enrolled project visibility and role-gated startup project details", () => {
    it.each(["body", "context"] as const)(
      "uses the %s workspace on first App Home open",
      async (source) => {
        const event = vi.fn();
        const publish = vi.fn();
        vi.mocked(getStatusData).mockResolvedValue(mockStatus);
        await registerSlackHomeHandler(
          { event } as unknown as App,
          {
            config: mockConfig,
            projectRoot: SYNTHETIC_PROJECT_ALPHA.localRoot!,
            registry: createSyntheticRegistry(),
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
            user: SYNTHETIC_USER_VIEWER,
          },
          body: source === "body" ? { team_id: SYNTHETIC_WORKSPACE_ID } : {},
          context:
            source === "context" ? { teamId: SYNTHETIC_WORKSPACE_ID } : {},
          client: { views: { publish } },
          logger: { error: vi.fn() },
        });
        expect(publish).toHaveBeenCalledOnce();
        const { view } = publish.mock.calls[0][0];
        expect(JSON.stringify(view.blocks)).toContain(
          SYNTHETIC_PROJECT_ALPHA.name,
        );
        expect(JSON.stringify(view.blocks)).not.toContain(
          SYNTHETIC_PROJECT_BETA.name,
        );
      },
    );

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
      const registry = createSyntheticRegistry();
      const homeView = await buildHomeTab(
        mockStatus,
        mockConfig,
        SYNTHETIC_PROJECT_ALPHA.localRoot!,
        {
          userId: SYNTHETIC_USER_VIEWER,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          registry,
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

    it("omits startup project sections when viewer holds no role in the startup project", async () => {
      const registry = createSyntheticRegistry();
      // Startup project is Beta, but viewer is only bound to Alpha
      const homeView = await buildHomeTab(
        mockStatus,
        mockConfig,
        SYNTHETIC_PROJECT_BETA.localRoot!,
        {
          userId: SYNTHETIC_USER_VIEWER,
          workspaceId: SYNTHETIC_WORKSPACE_ID,
          registry,
        },
      );

      const sectionTexts = homeView.blocks
        .filter((b) => b.type === "section" && (b as SectionBlock).text?.text)
        .map((b) => (b as SectionBlock).text!.text);

      // Viewer still sees Alpha in enrolled projects
      expect(
        sectionTexts.some((t) => t.includes(SYNTHETIC_PROJECT_ALPHA.name)),
      ).toBe(true);
      expect(
        sectionTexts.some((t) => t.includes(SYNTHETIC_PROJECT_BETA.name)),
      ).toBe(false);

      // But does NOT see Plan DAG Status or Pulse Summary for the unauthorized startup project
      expect(sectionTexts.some((t) => t.includes("Plan DAG Status"))).toBe(
        false,
      );
      expect(sectionTexts.some((t) => t.includes("Pulse Summary"))).toBe(false);
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
  });
});
