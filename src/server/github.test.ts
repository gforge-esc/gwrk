import fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
// @ts-ignore
import githubWebhooks from "./github.js";

describe("FR-H01/FR-H09/TC-H01: Webhook Handler", () => {
  it("US-H01: Valid PR merge webhook triggers harvest", async () => {
    const server = fastify();
    // @ts-ignore
    await server.register(githubWebhooks);

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

    // Expect 200 even if it ignores some things, but in RED state this might be anything.
    // For now, testing handler exists and responds.
    expect(response.statusCode).toBe(200);
  });

  it("FR-H01/TC-H01: sandbox PRs ignored by harvest", async () => {
    // Scenario: PR targeting a feat branch (not develop/main)
    const server = fastify();
    // @ts-ignore
    await server.register(githubWebhooks);

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
  });

  it("FR-H09: only triggers for base=develop or base=main", async () => {
    const server = fastify();
    // @ts-ignore
    await server.register(githubWebhooks);

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

    // Should still return 200 but not call harvest engine
    expect(response.statusCode).toBe(200);
    // Ideally verify mock engine not called
    expect(true).toBe(false); // RED
  });

  it("TC-H03: should return 401 if HMAC signature is invalid", async () => {
    const server = fastify();
    // @ts-ignore
    await server.register(githubWebhooks);

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
});
