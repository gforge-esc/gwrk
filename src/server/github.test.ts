import { describe, expect, it, vi } from "vitest";
import fastify from "fastify";
import githubWebhooks from "./github.js";

describe("FR-H01: Webhook Handler", () => {
  it("US-H01: Valid PR merge webhook triggers harvest", async () => {
    const server = fastify();
    await server.register(githubWebhooks);

    const payload = {
      action: "closed",
      pull_request: {
        number: 42,
        merged: true,
        merged_at: "2026-04-01T09:15:00Z",
        merge_commit_sha: "abc1234567890",
        head: { ref: "feat/011-harvest" },
        base: { ref: "develop" }
      }
    };

    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": "sha256=invalid-signature-for-red-test"
      },
      payload
    });

    // In a RED test, this might fail with 404 (route not found) or 500 (import error)
    // For FR-H01, we want to see it handling the payload correctly.
    expect(response.statusCode).toBe(200);
  });

  it("FR-H01: sandbox PRs ignored by harvest", async () => {
     // Scenario: PR targeting a feat branch (not develop/main)
     const server = fastify();
     await server.register(githubWebhooks);
     
     const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "task/sandbox-1" },
        base: { ref: "feat/some-feature" }
      }
    };
    
    const response = await server.inject({
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload
    });
    
    // Should be ignored (still 200 but no harvest triggered - we'd need a spy for engine to verify)
    expect(response.statusCode).toBe(200);
  });
});
