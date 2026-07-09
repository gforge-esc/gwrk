import crypto from "node:crypto";
import fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { upsertIssue, updateIssue } from "../src/db/issues.js";
import { harvestFeature } from "../src/engine/harvest.js";
import {
  associateIssueWithFeature,
  notifyIssueOpened,
} from "../src/engine/issues.js";
import { githubWebhookPlugin } from "../src/server/github.js";
import * as slackNotify from "../src/server/slack-notify.js";

vi.mock("../src/engine/harvest.js", () => ({
  harvestFeature: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/db/issues.js", () => ({
  upsertIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../src/utils/project-id.js", () => ({
  resolveProjectId: vi.fn().mockReturnValue("test-proj"),
}));

vi.mock("../src/engine/issues.js", () => ({
  associateIssueWithFeature: vi.fn(),
  notifyIssueOpened: vi.fn().mockResolvedValue({}),
}));

vi.mock("../src/server/slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue({}),
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

  it("FR-H01, FR-H09: Webhook ignores non-trunk targets and sub-task PRs (TR-H01)", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        base: { ref: "feat/011-harvest" }, // TARGETING FEAT BRANCH, NOT TRUNK
        head: { ref: "task/sub-task-1" },
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

  it("FR-H11: Webhook MUST NOT duplicate Slack notification (Prevent double Done-Done)", async () => {
    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        base: { ref: "main" },
        head: { ref: "feat/011-harvest" },
      },
    };

    await app.inject({
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
        "x-hub-signature-256": sign(payload, secret),
      },
      payload,
    });

    // harvestFeature handles notification internally. Webhook handler should NOT call notifySlack.
    expect(harvestFeature).toHaveBeenCalled();
    expect(slackNotify.notifySlack).not.toHaveBeenCalled();
  });

  it("FR-H12, FR-H13, FR-H14, FR-H15: Post-Ship Issue Tracking (TR-H09, TR-H10)", async () => {
    (associateIssueWithFeature as any).mockReturnValue("011-harvest");

    const payload = {
      action: "opened",
      issue: {
        number: 123,
        title: "Harvest bug",
        state: "open",
        labels: [{ name: "gwrk:011-harvest" }],
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
    expect(upsertIssue).toHaveBeenCalled();
    expect(notifyIssueOpened).toHaveBeenCalled();
  });
});
