import crypto from "node:crypto";
import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { harvestFeature } from "../src/engine/harvest.js";
import { githubWebhookPlugin } from "../src/server/github.js";
import { notifySlack } from "../src/server/slack-notify.js";

// Mock harvestFeature
vi.mock("../src/engine/harvest.js", () => ({
  harvestFeature: vi.fn().mockResolvedValue(undefined),
}));

// Mock notifySlack
vi.mock("../src/server/slack-notify.js", () => ({
  notifySlack: vi.fn(),
}));

const mockConfig = {
  server: {
    githubWebhookSecret: "test-secret",
  },
} as never;

const projectRoot = "/tmp/gwrk-test";

describe("TR-H01: GitHub Webhook Handler", () => {
  it("should ignore non-PR events", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: { server: {} } as never,
      projectRoot,
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "ping" },
      payload: { zen: "Design for failure." },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "ignored",
      reason: "not_pr_event",
    });
    expect(harvestFeature).not.toHaveBeenCalled();
  });

  it("should verify signature correctly", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, { config: mockConfig, projectRoot });

    const payload = { some: "data" };
    const hmac = crypto.createHmac("sha256", "test-secret");
    const digest = `sha256=${hmac.update(JSON.stringify(payload)).digest("hex")}`;

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": digest,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("ignored");
  });

  it("should reject invalid signature", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, { config: mockConfig, projectRoot });

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "ping",
        "x-hub-signature-256": "sha256=invalid",
      },
      payload: { some: "data" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("should ignore PR closure without merge", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: { server: {} } as never,
      projectRoot,
    });

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload: {
        action: "closed",
        pull_request: { merged: false },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("ignored");
    expect(harvestFeature).not.toHaveBeenCalled();
  });

  it("should accept valid PR merge targeting develop", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: { server: {} } as never,
      projectRoot,
    });

    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        merged: true,
        merged_at: "2026-04-01T09:15:00Z",
        merge_commit_sha: "abc1234567890",
        html_url: "https://github.com/org/repo/pull/42",
        head: { ref: "feat/011-harvest-phase-01" },
        base: { ref: "develop" },
        merged_by: { login: "tester" },
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      status: "accepted",
      featureId: "011-harvest",
      phaseId: "phase-01",
    });
    expect(harvestFeature).toHaveBeenCalled();
  });

  it("TR-H11: Webhook handler does NOT call notifySlack directly", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: { server: {} } as never,
      projectRoot,
    });

    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        merged: true,
        merged_at: "2026-04-01T09:15:00Z",
        merge_commit_sha: "abc1234567890",
        html_url: "https://github.com/org/repo/pull/42",
        head: { ref: "feat/011-harvest-phase-01" },
        base: { ref: "develop" },
        merged_by: { login: "tester" },
      },
    };

    await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    // harvestFeature should be called, but NOT notifySlack (it's handled inside harvestFeature)
    expect(harvestFeature).toHaveBeenCalled();
    expect(notifySlack).not.toHaveBeenCalled();
  });

  it("FR-H09: should ignore PRs targeting non-trunk branches", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: { server: {} } as never,
      projectRoot,
    });

    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        base: { ref: "feature-branch" }, // Not develop or main
        head: { ref: "feat/some-subtask" },
      },
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).status).toBe("ignored");
    expect(JSON.parse(response.body).reason).toBe("not_trunk_target");
  });

  describe("FR-H12: GitHub Issues Webhook", () => {
    it("US-H07: should handle issues.opened event", async () => {
      const server = fastify();
      await githubWebhookPlugin(server, {
        config: { server: {} } as never,
        projectRoot,
      });

      const payload = {
        action: "opened",
        issue: {
          number: 123,
          title: "[011] Something wrong",
          body: "Description",
          user: { login: "tester" },
          labels: [{ name: "bug" }],
        },
      };

      const response = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: { "x-github-event": "issues" },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).status).toBe("accepted");
      expect(JSON.parse(response.body).featureId).toBe("011-harvest");
    });

    it("should handle issues.closed event", async () => {
      const server = fastify();
      await githubWebhookPlugin(server, {
        config: { server: {} } as never,
        projectRoot,
      });

      const payload = {
        action: "closed",
        issue: {
          number: 123,
          title: "[011] Something wrong",
          state: "closed",
        },
      };

      const response = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: { "x-github-event": "issues" },
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.parse(response.body).status).toBe("accepted");
    });
  });
});
