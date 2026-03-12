import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../../utils/config.js";
import { startServer } from "../index.js";
import { removePid } from "../pid.js";
import * as slackNotify from "../slack-notify.js";

// Mock dependencies
vi.mock("dockerode");
vi.mock("../slack-notify.js");

const mockConfig: GwrkConfig = {
  project: { 
    name: "test",
    slack: {
        channelId: "C123",
        channelName: "test-channel"
    }
  },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: {
    port: 18794,
    host: "localhost",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("notify routes", () => {
  beforeEach(() => {
    removePid();
    vi.clearAllMocks();
  });

  afterEach(() => {
    removePid();
  });

  it("should post a notification via POST /api/notify", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    const spy = vi.spyOn(slackNotify, "notifySlack");

    const response = await server.inject({
      method: "POST",
      url: "/api/notify",
      payload: {
        type: "phase_start",
        feature: "test-feature",
        phase: "phase-1",
        backend: "gemini",
        branch: "main"
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    
    const callArgs = spy.mock.calls[0];
    expect(callArgs[0].text).toContain("Phase phase-1 started for test-feature");
    expect(callArgs[1].type).toBe("phase_start");

    await server.close();
  });

  it("should return 400 for missing required fields", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });

    const response = await server.inject({
      method: "POST",
      url: "/api/notify",
      payload: {
        type: "phase_start"
        // missing feature
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().ok).toBe(false);

    await server.close();
  });

  it("should handle masterOnly flag", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    const spy = vi.spyOn(slackNotify, "notifySlack");

    await server.inject({
      method: "POST",
      url: "/api/notify",
      payload: {
        type: "phase_start",
        feature: "test-feature",
        masterOnly: true
      },
    });

    expect(spy).toHaveBeenCalled();
    const options = spy.mock.calls[0][2];
    expect(options?.master).toBe(true);

    await server.close();
  });
});
