/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Module does not exist yet (RED)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../../utils/config.js";
import * as slackClient from "../../utils/slack-client.js";
import * as dockerUtils from "../docker.js";
import { startServer } from "../index.js";
import { removePid } from "../pid.js";
import * as slackNotify from "../slack-notify.js";

// Mock dependencies
vi.mock("dockerode");
vi.mock("../slack-notify.js");
vi.mock("../../utils/slack-client.js", () => ({
  loadSlackConfig: vi.fn().mockReturnValue(null),
}));
vi.mock("../docker.js", () => ({
  ensureDocker: vi.fn().mockResolvedValue({ installed: true, running: true }),
}));

const mockConfig: GwrkConfig = {
  project: {
    name: "test",
    slack: {
      channelId: "C123",
      channelName: "test-channel",
    },
  },
  agents: { define: "gemini", implement: "codex-cloud" },
  server: {
    githubWebhookSecret: "mock_secret",
    port: 0,
    host: "localhost",
    heartbeatIntervalMs: 1000,
    networkCheckIntervalMs: 1000,
  },
  parallelism: {
    local: { maxCpu: 80, maxMem: 80, minDiskGb: 10, maxClones: 2 },
    cloud: { maxConcurrent: 10 },
  },
};

describe("notify routes (FR-003, FR-007, US-003, US-007)", () => {
  beforeEach(() => {
    removePid();
    vi.clearAllMocks();
  });

  afterEach(() => {
    removePid();
  });

  it("US-003, US-007: should post a notification via POST /api/notify", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      const response = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          feature: "test-feature",
          phase: "phase-1",
          backend: "gemini",
          branch: "main",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
      expect(spy).toHaveBeenCalled();

      const callArgs = spy.mock.calls[0];
      expect(callArgs[0].text).toContain(
        "Phase phase-1 started for test-feature",
      );
      expect(callArgs[1]?.type).toBe("phase_start");
    } finally {
      await server.close();
    }
  });

  it("FR-003, US-003: should return 400 for missing required fields", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          // missing feature
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().ok).toBe(false);
    } finally {
      await server.close();
    }
  });

  it("FR-004, US-004: should handle opsOnly flag", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "phase_start",
          feature: "test-feature",
          opsOnly: true,
        },
      });

      expect(spy).toHaveBeenCalled();
      const options = spy.mock.calls[0][2];
      expect(options?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("FR-016: should handle define_spec_ready notification", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "define_spec_ready",
          feature: "003-slack",
          specPath: "specs/003-slack/spec.md",
        },
      });

      expect(spy).toHaveBeenCalled();
      const callArgs = spy.mock.calls[0];
      expect(callArgs[0].text).toContain("Spec Ready");
      expect(callArgs[0].text).toContain("003-slack");
    } finally {
      await server.close();
    }
  });

  it("FR-016: should handle define_plan_ready notification", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "define_plan_ready",
          feature: "003-slack",
          planPath: "specs/003-slack/plan.md",
          phaseCount: 5,
        },
      });

      expect(spy).toHaveBeenCalled();
      const callArgs = spy.mock.calls[0];
      expect(callArgs[0].text).toContain("Plan Ready");
      expect(callArgs[0].text).toContain("5 phases");
    } finally {
      await server.close();
    }
  });

  it("TR-005: should route done_done to ops channel", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "done_done",
          feature: "003-slack",
        },
      });

      expect(spy).toHaveBeenCalled();
      const options = spy.mock.calls[0][2];
      expect(options?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });

  it("TR-005: should route pulse to ops channel", async () => {
    const server = await startServer(mockConfig, { handleSignals: false });
    try {
      const spy = vi.spyOn(slackNotify, "notifySlack");

      await server.inject({
        method: "POST",
        url: "/api/notify",
        payload: {
          type: "pulse",
          feature: "003-slack",
          pulseReport: {
            generatedAt: new Date().toISOString(),
            repositories: [],
            specProgress: { totalSpecs: 10, totalPlans: 5 },
          },
        },
      });

      expect(spy).toHaveBeenCalled();
      const options = spy.mock.calls[0][2];
      expect(options?.opsOnly).toBe(true);
    } finally {
      await server.close();
    }
  });
});
