import crypto from "node:crypto";
import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveIssue, updateIssue } from "../src/db/issues.js";
import { harvestFeature } from "../src/engine/harvest.js";
import {
  associateIssueWithFeature,
  notifyIssueOpened,
} from "../src/engine/issues.js";
import { githubWebhookPlugin } from "../src/server/github.js";

vi.mock("../src/engine/harvest.js", () => ({
  harvestFeature: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/db/issues.js", () => ({
  saveIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../src/engine/issues.js", () => ({
  associateIssueWithFeature: vi.fn(),
  notifyIssueOpened: vi.fn().mockResolvedValue({}),
}));

function sign(payload: any, secret: string) {
  const hmac = crypto.createHmac("sha256", secret);
  return `sha256=${hmac.update(JSON.stringify(payload)).digest("hex")}`;
}

describe("GitHub Webhook Plugin", () => {
  let app: any;
  const secret = "test-secret";
  const config = {
    server: {
      githubWebhookSecret: secret,
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    app = fastify();
    await app.register(githubWebhookPlugin, {
      config,
      projectRoot: "/test",
    } as any);
  });

  it("FR-H01: Webhook ignores unmerged PRs and non-trunk targets (TR-011)", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: false,
        base: { ref: "main" },
        head: { ref: "feat/011-harvest" },
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).status).toBe("ignored");
    expect(harvestFeature).not.toHaveBeenCalled();
  });

  it("FR-H12, FR-H13, FR-H14, FR-H15: Post-Ship Issue Tracking > US-H07: Verify issues.opened associates via gwrk:002 label and inserts DB record (TR-H09)", async () => {
    (associateIssueWithFeature as any).mockReturnValue("002-build-server");

    const payload = {
      action: "opened",
      issue: {
        number: 123,
        title: "Build server crash",
        body: "It crashed",
        state: "open",
        html_url: "https://github.com/org/repo/issues/123",
        user: { login: "alice" },
        labels: [{ name: "gwrk:002-build-server" }],
        created_at: "2026-05-17T10:00:00Z",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).featureId).toBe("002-build-server");
    expect(saveIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        issue_number: 123,
        feature_id: "002-build-server",
      }),
    );
    expect(notifyIssueOpened).toHaveBeenCalled();
  });

  it("US-H07: Verify issues.opened resolves feature via title substring (TR-H10)", async () => {
    (associateIssueWithFeature as any).mockReturnValue("002");

    const payload = {
      action: "opened",
      issue: {
        number: 124,
        title: "[002] Bug in server",
        state: "open",
        user: { login: "bob" },
        created_at: "2026-05-17T10:05:00Z",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).featureId).toBe("002");
    expect(saveIssue).toHaveBeenCalled();
  });

  it("Negative path: issue with no matching label or title is not associated", async () => {
    (associateIssueWithFeature as any).mockReturnValue(undefined);

    const payload = {
      action: "opened",
      issue: {
        number: 125,
        title: "Random issue",
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "issues",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).status).toBe("ignored");
    expect(saveIssue).not.toHaveBeenCalled();
  });

  it("US-H01: Webhook triggers harvest pipeline for phase rollup PRs", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        number: 42,
        html_url: "https://github.com/org/repo/pull/42",
        merge_commit_sha: "abc",
        merged_at: "2026-05-17T10:00:00Z",
        merged_by: { login: "alice" },
        base: { ref: "main" },
        head: { ref: "feat/011-harvest-phase-1" },
      },
    };

    const response = await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload).featureId).toBe("011-harvest");
    expect(harvestFeature).toHaveBeenCalled();
  });
});
