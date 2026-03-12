import type { HeaderBlock, SectionBlock } from "@slack/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { buildHomeTab } from "./slack-home.js";
import type { SystemStatus } from "./types.js";

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

    // Check Active Agents section
    const activeAgentsIdx = blocks.findIndex(
      (b) =>
        b.type === "section" &&
        (b as SectionBlock).text?.text === "👷 *Active Agents*",
    );
    expect(activeAgentsIdx).toBeGreaterThan(-1);
    expect((blocks[activeAgentsIdx + 1] as SectionBlock).text?.text).toContain(
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

  it("handles empty active agents", async () => {
    const statusEmpty: SystemStatus = {
      ...mockStatus,
      sandboxes: [],
    };
    const homeView = await buildHomeTab(statusEmpty, mockConfig, "/tmp");
    expect(
      homeView.blocks.some(
        (b) =>
          b.type === "section" &&
          (b as SectionBlock).text?.text === "_No active agents._",
      ),
    ).toBe(true);
  });
});
