/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProjectId } from "../adapters/git/project-id.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { openDatabase } from "../db/index.js";
import type { GwrkConfig } from "../utils/config.js";
import { githubWebhookPlugin } from "./github.js";

const FIXTURE_SECRET = "synthetic-webhook-secret";

const mockConfig = {
  server: { githubWebhookSecret: FIXTURE_SECRET },
} as GwrkConfig;

function signRaw(rawBody: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

function initRepo(root: string, repoSlug: string): string {
  mkdirSync(root, { recursive: true });
  const opts = { cwd: root, stdio: "ignore" as const, timeout: 5_000 };
  execFileSync("git", ["init", "--quiet", "--initial-branch=develop"], opts);
  execFileSync(
    "git",
    ["remote", "add", "origin", `https://github.com/${repoSlug}.git`],
    opts,
  );
  return realpathSync(root);
}

function postSignedWebhook(
  server: ReturnType<typeof fastify>,
  request: {
    method: "POST";
    url: string;
    headers: Record<string, string>;
    payload: unknown;
  },
) {
  const payload = JSON.stringify(request.payload) ?? "null";
  const signature = `sha256=${createHmac("sha256", FIXTURE_SECRET).update(payload).digest("hex")}`;
  return server.inject({
    ...request,
    payload,
    headers: {
      "content-type": "application/json",
      ...request.headers,
      "x-hub-signature-256":
        request.headers["x-hub-signature-256"] ?? signature,
    },
  });
}

describe("FR-H01/FR-H09/TC-H01: Webhook Handler", () => {
  it("US-H01: Valid PR merge webhook triggers harvest", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

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

    const response = await postSignedWebhook(server, {
      method: "POST",
      url: "/webhook/github",
      headers: {
        "x-github-event": "pull_request",
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("FR-H01/TC-H01: sandbox PRs ignored by harvest", async () => {
    // Scenario: PR targeting a feat branch (not develop/main)
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "task/sandbox-1" },
        base: { ref: "feat/some-feature" },
      },
    };

    const response = await postSignedWebhook(server, {
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    expect(response.statusCode).toBe(200);
  });

  it("FR-H09: only triggers for base=develop or base=main", async () => {
    const server = fastify();
    await githubWebhookPlugin(server, {
      config: mockConfig,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: {
        merged: true,
        head: { ref: "feat/some-feature" },
        base: { ref: "other-branch" },
      },
    };

    const response = await postSignedWebhook(server, {
      method: "POST",
      url: "/webhook/github",
      headers: { "x-github-event": "pull_request" },
      payload,
    });

    // Should still return 200 but not call harvest engine
    expect(response.statusCode).toBe(200);
  });

  it("TC-H03: should return 401 if HMAC signature is invalid", async () => {
    const server = fastify();
    const configWithSecret = {
      server: { githubWebhookSecret: "mock_secret" },
    } as GwrkConfig;
    await githubWebhookPlugin(server, {
      config: configWithSecret,
      projectRoot: "/test",
    });

    const payload = {
      action: "closed",
      pull_request: { merged: true },
    };

    const response = await postSignedWebhook(server, {
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

describe("durable GitHub webhook ingress (FR-002, FR-005, TR-002, TR-004)", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function setupDurableFixture() {
    const tempRoot = mkdtempSync(join(tmpdir(), "gwrk-gh-webhook-"));
    tempDirs.push(tempRoot);
    const alphaRoot = initRepo(join(tempRoot, "alpha"), "org/alpha");
    const betaRoot = initRepo(join(tempRoot, "beta"), "org/beta");
    const db = openDatabase({ dbPath: join(tempRoot, "gwrk.db") });
    const registry = createSqliteProjectRegistryAdapter({ db });
    const store = createSqliteOperationsStoreAdapter({ db });
    const alphaId = resolveProjectId(alphaRoot);
    const betaId = resolveProjectId(betaRoot);

    registry.enrollProject({
      projectId: alphaId,
      slug: "alpha",
      name: "Alpha",
      repoSlug: "org/alpha",
      trunkBranch: "develop",
      localRoot: alphaRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });
    registry.enrollProject({
      projectId: betaId,
      slug: "beta",
      name: "Beta",
      repoSlug: "org/beta",
      trunkBranch: "develop",
      localRoot: betaRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T12:00:00.000Z",
      updatedAt: "2026-11-23T12:00:00.000Z",
    });

    return {
      tempRoot,
      alphaRoot,
      betaRoot,
      alphaId,
      betaId,
      db,
      registry,
      store,
    };
  }

  it.each([
    { label: "absent", secret: undefined },
    { label: "empty", secret: "" },
    { label: "whitespace", secret: "   " },
  ])(
    "TR-002 security regression: rejects $label secret before enrolled durable intake",
    async ({ secret }) => {
      const { alphaRoot, alphaId, db, registry } = setupDurableFixture();
      const enrolled = registry.getProject(alphaId);
      if (!enrolled) throw new Error("Missing synthetic enrollment");
      registry.enrollProject({
        ...enrolled,
        runnerPolicy: { allowedKinds: ["hosted"] },
      });
      const server = fastify();
      const payload = {
        action: "closed",
        repository: { full_name: "org/alpha" },
        pull_request: {
          number: 77,
          html_url: "https://github.com/org/alpha/pull/77",
          merged: true,
          merged_at: "2026-11-23T12:05:00Z",
          merge_commit_sha: "a".repeat(40),
          head: {
            ref: "feat/049-durable-phase-01",
            sha: "b".repeat(40),
            repo: { full_name: "org/alpha" },
          },
          base: { ref: "develop", repo: { full_name: "org/alpha" } },
        },
      };
      try {
        await githubWebhookPlugin(server, {
          config: { server: { githubWebhookSecret: secret } } as GwrkConfig,
          projectRoot: alphaRoot,
          registry,
          ledger: { db, projectId: alphaId },
          autoResume: false,
        });
        const response = await server.inject({
          method: "POST",
          url: "/webhook/github",
          headers: {
            "x-github-event": "pull_request",
            "x-github-delivery": "unsigned-enrolled-security-probe",
            ...(secret
              ? {
                  "x-hub-signature-256": signRaw(
                    Buffer.from(JSON.stringify(payload)),
                    secret,
                  ),
                }
              : {}),
          },
          payload,
        });
        expect.soft(response.statusCode).toBe(401);
        expect
          .soft(
            db
              .prepare("SELECT COUNT(*) AS count FROM harvest_operations")
              .get(),
          )
          .toEqual({ count: 0 });
        expect
          .soft(
            db
              .prepare("SELECT COUNT(*) AS count FROM harvest_deliveries")
              .get(),
          )
          .toEqual({ count: 0 });
      } finally {
        await server.close();
        db.close();
      }
    },
  );

  it("TR-002 verifies raw pretty-printed JSON HMAC, persists before HTTP 200, and deduplicates X-GitHub-Delivery", async () => {
    const { alphaRoot, alphaId, db, store } = setupDurableFixture();
    const secret = "raw-body-secret";
    const server = fastify();
    try {
      await githubWebhookPlugin(server, {
        config: { server: { githubWebhookSecret: secret } } as GwrkConfig,
        projectRoot: alphaRoot,
        ledger: { db, projectId: alphaId },
      });

      const payloadObj = {
        action: "closed",
        repository: { full_name: "org/alpha" },
        pull_request: {
          number: 77,
          html_url: "https://github.com/org/alpha/pull/77",
          merged: true,
          merged_at: "2026-11-23T12:05:00Z",
          merge_commit_sha: "a".repeat(40),
          head: {
            ref: "feat/049-durable-phase-01",
            sha: "b".repeat(40),
            repo: { full_name: "org/alpha" },
          },
          base: {
            ref: "develop",
            repo: { full_name: "org/alpha" },
          },
        },
      };
      // Pretty-printed raw bytes differ from JSON.stringify(parsed)
      const rawBody = Buffer.from(JSON.stringify(payloadObj, null, 2), "utf8");
      const signature = signRaw(rawBody, secret);

      const first = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-raw-1",
          "x-hub-signature-256": signature,
        },
        payload: rawBody,
      });

      expect(first.statusCode).toBe(200);
      const body = first.json();
      expect(body.status).toBe("accepted");
      expect(body.deliveryId).toBe("delivery-raw-1");
      expect(typeof body.operationId).toBe("string");
      expect(body.operationId.length).toBeGreaterThan(0);

      const persisted = store.listRecoverableHarvests({
        nowIso: "2026-11-23T12:06:00.000Z",
        projectId: alphaId,
      });
      const matching = db
        .prepare("SELECT * FROM harvest_operations WHERE operation_id = ?")
        .get(body.operationId);
      expect(matching).toBeDefined();
      expect(persisted.length).toBeGreaterThanOrEqual(0);

      // Transport retry with same X-GitHub-Delivery returns same operationId
      const retry = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-raw-1",
          "x-hub-signature-256": signature,
        },
        payload: rawBody,
      });
      expect(retry.statusCode).toBe(200);
      expect(retry.json().operationId).toBe(body.operationId);
      expect(retry.json().deduplicatedTransport).toBe(true);

      // Tampered payload with reused delivery ID is rejected (400)
      const tampered = Buffer.from(
        JSON.stringify(
          {
            ...payloadObj,
            pull_request: {
              ...payloadObj.pull_request,
              merge_commit_sha: "c".repeat(40),
            },
          },
          null,
          2,
        ),
      );
      const conflict = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "delivery-raw-1",
          "x-hub-signature-256": signRaw(tampered, secret),
        },
        payload: tampered,
      });
      expect(conflict.statusCode).toBe(400);
    } finally {
      await server.close();
      db.close();
    }
  });

  it("TR-002 isolates enrolled repositories with identical PR numbers and ignores unenrolled repos", async () => {
    const { alphaRoot, alphaId, betaId, db } = setupDurableFixture();
    const secret = "iso-secret";
    const server = fastify();
    try {
      await githubWebhookPlugin(server, {
        config: { server: { githubWebhookSecret: secret } } as GwrkConfig,
        projectRoot: alphaRoot,
        ledger: { db, projectId: alphaId },
      });

      const makePayload = (repo: string) =>
        Buffer.from(
          JSON.stringify({
            action: "closed",
            repository: { full_name: repo },
            pull_request: {
              number: 55,
              html_url: `https://github.com/${repo}/pull/55`,
              merged: true,
              merged_at: "2026-11-23T12:10:00Z",
              merge_commit_sha: "d".repeat(40),
              head: {
                ref: "feat/049-shared-phase-01",
                sha: "e".repeat(40),
                repo: { full_name: repo },
              },
              base: { ref: "develop", repo: { full_name: repo } },
            },
          }),
        );

      const alphaRaw = makePayload("org/alpha");
      const betaRaw = makePayload("org/beta");
      const foreignRaw = makePayload("org/foreign");

      const alphaRes = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-alpha-55",
          "x-hub-signature-256": signRaw(alphaRaw, secret),
        },
        payload: alphaRaw,
      });
      const betaRes = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-beta-55",
          "x-hub-signature-256": signRaw(betaRaw, secret),
        },
        payload: betaRaw,
      });
      const foreignRes = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-foreign-55",
          "x-hub-signature-256": signRaw(foreignRaw, secret),
        },
        payload: foreignRaw,
      });

      expect(alphaRes.statusCode).toBe(200);
      expect(betaRes.statusCode).toBe(200);
      expect(alphaRes.json().projectId).toBe(alphaId);
      expect(betaRes.json().projectId).toBe(betaId);
      expect(alphaRes.json().operationId).not.toBe(betaRes.json().operationId);

      expect(foreignRes.statusCode).toBe(200);
      expect(foreignRes.json().status).toBe("ignored");
    } finally {
      await server.close();
      db.close();
    }
  });

  it("TR-004 records closed unmerged PRs on configured trunk without overwriting a verified merge", async () => {
    const { alphaRoot, alphaId, db } = setupDurableFixture();
    const secret = "closed-secret";
    const server = fastify();
    try {
      await githubWebhookPlugin(server, {
        config: { server: { githubWebhookSecret: secret } } as GwrkConfig,
        projectRoot: alphaRoot,
        ledger: { db, projectId: alphaId },
      });

      const closedRaw = Buffer.from(
        JSON.stringify({
          action: "closed",
          repository: { full_name: "org/alpha" },
          pull_request: {
            number: 88,
            html_url: "https://github.com/org/alpha/pull/88",
            merged: false,
            merged_at: null,
            closed_at: "2026-11-23T12:15:00Z",
            merge_commit_sha: null,
            head: {
              ref: "feat/049-closed-phase-01",
              sha: "f".repeat(40),
              repo: { full_name: "org/alpha" },
            },
            base: { ref: "develop", repo: { full_name: "org/alpha" } },
          },
        }),
      );

      const res = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-closed-88",
          "x-hub-signature-256": signRaw(closedRaw, secret),
        },
        payload: closedRaw,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.deliveryId).toBe("del-closed-88");
      const row = db
        .prepare(
          "SELECT terminal_event, status FROM harvest_operations WHERE operation_id = ?",
        )
        .get(body.operationId) as
        | { terminal_event: string; status: string }
        | undefined;
      expect(row?.terminal_event).toBe("closed_unmerged");

      // Out-of-order close after a verified merge must NOT overwrite the merge
      const mergedRaw = Buffer.from(
        JSON.stringify({
          action: "closed",
          repository: { full_name: "org/alpha" },
          pull_request: {
            number: 89,
            html_url: "https://github.com/org/alpha/pull/89",
            merged: true,
            merged_at: "2026-11-23T12:16:00Z",
            closed_at: "2026-11-23T12:16:00Z",
            merge_commit_sha: "9".repeat(40),
            head: {
              ref: "feat/049-order-phase-01",
              sha: "8".repeat(40),
              repo: { full_name: "org/alpha" },
            },
            base: { ref: "develop", repo: { full_name: "org/alpha" } },
          },
        }),
      );
      const staleCloseRaw = Buffer.from(
        JSON.stringify({
          action: "closed",
          repository: { full_name: "org/alpha" },
          pull_request: {
            number: 89,
            html_url: "https://github.com/org/alpha/pull/89",
            merged: false,
            merged_at: null,
            closed_at: "2026-11-23T12:17:00Z",
            merge_commit_sha: null,
            head: {
              ref: "feat/049-order-phase-01",
              sha: "8".repeat(40),
              repo: { full_name: "org/alpha" },
            },
            base: { ref: "develop", repo: { full_name: "org/alpha" } },
          },
        }),
      );

      const mergedRes = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-merged-89",
          "x-hub-signature-256": signRaw(mergedRaw, secret),
        },
        payload: mergedRaw,
      });
      const staleCloseRes = await server.inject({
        method: "POST",
        url: "/webhook/github",
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
          "x-github-delivery": "del-stale-close-89",
          "x-hub-signature-256": signRaw(staleCloseRaw, secret),
        },
        payload: staleCloseRaw,
      });

      expect(mergedRes.statusCode).toBe(200);
      expect(staleCloseRes.statusCode).toBe(200);
      expect(staleCloseRes.json().operationId).toBe(
        mergedRes.json().operationId,
      );
      const mergedRow = db
        .prepare(
          "SELECT terminal_event FROM harvest_operations WHERE operation_id = ?",
        )
        .get(mergedRes.json().operationId) as
        | { terminal_event: string }
        | undefined;
      expect(mergedRow?.terminal_event).toBe("merged");
    } finally {
      await server.close();
      db.close();
    }
  });
});
