/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createSqliteOperationsStoreAdapter } from "../../adapters/sqlite/operations.js";
import { openDatabase } from "../../db/index.js";
import { registerProject } from "../../db/runs.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import type { NotificationPort } from "../../ports/notification-port.js";
import { createOutboxDeliveryService } from "./outbox.js";

let root: string;
let db: ReturnType<typeof openDatabase>;
let store: ReturnType<typeof createSqliteOperationsStoreAdapter>;
let time: string;
const project: EnrolledProject = {
  projectId: "alpha",
  slug: "alpha",
  name: "Alpha",
  repoSlug: "org/alpha",
  trunkBranch: "main",
  localRoot: "/fixture/alpha",
  mirrorPath: null,
  runnerPolicy: { allowedKinds: ["local"] },
  slack: { workspaceId: "W1", channelId: "C1", sharedChannel: false },
  legacyProjectIds: [],
  createdAt: "2026-11-18T00:00:00Z",
  updatedAt: "2026-11-18T00:00:00Z",
};
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-outbox-service-"));
  db = openDatabase({ dbPath: join(root, "ledger.sqlite") });
  registerProject({ id: "alpha", name: "Alpha", path: root }, db);
  store = createSqliteOperationsStoreAdapter({ db });
  time = "2026-11-18T00:00:00.000Z";
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});
function setup() {
  let counter = 0;
  const notify = vi.fn<NotificationPort["notify"]>().mockResolvedValue({
    delivered: true,
    channelId: "C1",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000000",
  });
  const reconcileDelivery = vi
    .fn<NonNullable<NotificationPort["reconcileDelivery"]>>()
    .mockResolvedValue({
      status: "indeterminate",
      reason: "lookup_unavailable",
    });
  const getProject = vi.fn().mockReturnValue(project);
  const buildService = () =>
    createOutboxDeliveryService({
      store,
      registry: { getProject, getFeatureThread: () => null },
      notifier: { notify, reconcileDelivery },
      clock: { nowIso: () => time, nowMs: () => Date.parse(time) },
      newId: () => `id-${++counter}`,
    });
  const service = buildService();
  const reopen = () => {
    db.close();
    db = openDatabase({ dbPath: join(root, "ledger.sqlite") });
    store = createSqliteOperationsStoreAdapter({ db });
    return buildService();
  };
  const enqueue = (dedupeKey = "done") =>
    service.enqueueProjectNotification({
      project,
      dedupeKey,
      ownerKind: "dispatch",
      ownerOperationId: "dispatch-1",
      eventType: "dispatch_completed",
      featureId: "001-fixture",
      phaseId: "phase-01",
      recipient: {
        projectId: "alpha",
        surface: "slack",
        workspaceId: "W1",
        channelId: "C1",
        threadTs: "1700000000.000000",
      },
      message: { text: "Completed" },
    });
  return { service, enqueue, notify, reconcileDelivery, getProject, reopen };
}
it("deduplicates durable intake and sends one accepted route and metadata key", async () => {
  const { service, enqueue, notify } = setup();
  const id = enqueue();
  expect(enqueue()).toBe(id);
  await Promise.all([service.flushOutboxItem(id), service.flushOutboxItem(id)]);
  expect(notify).toHaveBeenCalledTimes(1);
  const row = store.getOutboxItem(id)!;
  expect(row.status).toBe("delivered");
  expect(notify).toHaveBeenCalledWith(
    expect.objectContaining({
      projectId: "alpha",
      clientMetadataKey: row.clientMetadataKey,
      recipient: expect.objectContaining({
        projectId: "alpha",
        workspaceId: "W1",
        channelId: "C1",
        threadTs: "1700000000.000000",
      }),
    }),
  );
});
it("leaves an ambiguous send uncertain and never blindly resends", async () => {
  const { service, enqueue, notify, reconcileDelivery } = setup();
  notify.mockRejectedValueOnce(new Error("socket timeout after acceptance"));
  const id = enqueue();
  expect((await service.flushOutboxItem(id)).status).toBe("uncertain");
  expect((await service.flushOutboxItem(id)).status).toBe("uncertain");
  expect(notify).toHaveBeenCalledTimes(1);
  expect(reconcileDelivery).toHaveBeenCalledTimes(1);
});
it.each(["found", "confirmed_absent"] as const)(
  "reconciles %s at the saved route after binding changes",
  async (status) => {
    const { service, enqueue, notify, reconcileDelivery, getProject, reopen } =
      setup();
    notify.mockRejectedValueOnce(new Error("unknown send outcome"));
    const id = enqueue();
    await service.flushOutboxItem(id);
    const key = store.getOutboxItem(id)!.clientMetadataKey;
    getProject.mockReturnValue({
      ...project,
      slack: { ...project.slack, workspaceId: "W2", channelId: "C2" },
    });
    reconcileDelivery.mockResolvedValue(
      status === "found"
        ? {
            status,
            receipt: {
              delivered: true,
              channelId: "C1",
              messageTs: "1700000000.000001",
              threadTs: "1700000000.000000",
            },
          }
        : { status },
    );
    expect((await reopen().flushOutboxItem(id)).status).toBe("delivered");
    expect(reconcileDelivery).toHaveBeenCalledWith({
      projectId: "alpha",
      workspaceId: "W1",
      channelId: "C1",
      threadTs: "1700000000.000000",
      clientMetadataKey: key,
    });
    expect(notify).toHaveBeenCalledTimes(status === "found" ? 1 : 2);
    expect(store.getOutboxItem(id)?.clientMetadataKey).toBe(key);
  },
);
it("rejects a delivery receipt from another channel without recording delivery", async () => {
  const { service, enqueue, notify } = setup();
  notify.mockResolvedValue({
    delivered: true,
    channelId: "C2",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000000",
  });
  expect((await service.flushOutboxItem(enqueue())).status).toBe("uncertain");
});
it("fences a late sender completion after another claim takes over", async () => {
  const { service, enqueue, notify } = setup();
  let resolve!: (value: {
    delivered: boolean;
    channelId: string;
    messageTs: string;
    threadTs: string;
  }) => void;
  notify.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const id = enqueue();
  const pending = service.flushOutboxItem(id);
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  time = "2026-11-18T00:02:00.000Z";
  const takeover = store.claimOutboxItem({
    outboxId: id,
    nowIso: time,
    destination: null,
  });
  expect(takeover?.action).toBe("reconcile");
  resolve({
    delivered: true,
    channelId: "C1",
    messageTs: "1700000000.000001",
    threadTs: "1700000000.000000",
  });
  expect((await pending).status).toBe("uncertain");
  expect(store.getOutboxItem(id)).toMatchObject({
    status: "sending",
    attemptCount: 2,
  });
});

it("accepts a channel-only receipt for a channel-only notice", async () => {
  const { service, enqueue, notify } = setup();
  const id = enqueue();
  db.prepare(
    "UPDATE notification_outbox SET recipient_json = ? WHERE outbox_id = ?",
  ).run(
    JSON.stringify({
      surface: "slack",
      projectId: "alpha",
      workspaceId: "W1",
      channelId: "C1",
    }),
    id,
  );
  notify.mockResolvedValue({
    delivered: true,
    channelId: "C1",
    messageTs: "1700000000.000001",
  });
  expect((await service.flushOutboxItem(id)).status).toBe("delivered");
});
it("flushes only one project's pending notices", async () => {
  const { service, enqueue, notify } = setup();
  const id = enqueue();
  registerProject({ id: "beta", name: "Beta", path: join(root, "beta") }, db);
  const notice = store.getOutboxItem(id)!;
  store.enqueueOutbox({
    ...notice,
    outboxId: "foreign",
    dedupeKey: "foreign",
    projectId: "beta",
    recipient: { ...notice.recipient, projectId: "beta" },
    clientMetadataKey: "foreign",
    nowIso: time,
  });
  expect(await service.flushPendingForProject("alpha")).toBe(1);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(store.getOutboxItem("foreign")?.status).toBe("pending");
});
