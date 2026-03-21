import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import { githubWebhookPlugin } from "../src/server/github.js";
import { harvestFeature } from "../src/engine/harvest.js";

// Mock harvestFeature
vi.mock("../src/engine/harvest.js", () => ({
  harvestFeature: vi.fn().mockResolvedValue(undefined),
}));

const mockConfig = {
  server: {
    githubWebhookSecret: "test-secret",
  },
} as any;

const projectRoot = "/tmp/gwrk-test";

describe("TR-H01: GitHub Webhook Handler", () => {
  it("should ignore non-PR events", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, { config: { server: {} } } as any, projectRoot);

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
    await githubWebhookPlugin(server, { config: { server: {} } } as any, projectRoot);

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
    await githubWebhookPlugin(server, { config: { server: {} } } as any, projectRoot);

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
});
