/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_POLICY,
  GIB,
  type InventoryItem,
  installRequiredBytes,
  parseReleasePointer,
  planPreflight,
  planRetention,
  verificationRequirements,
} from "./retention-policy.js";

const release = (
  id: string,
  completedAt: string,
  extra: Partial<InventoryItem> = {},
): InventoryItem => ({
  kind: "release",
  id,
  path: `/opt/gwrk/releases/${id}`,
  owned: true,
  completedAt,
  identity: `sha-${id}`,
  bytes: 100,
  ...extra,
});

const run = (
  id: string,
  completedAt: string,
  extra: Partial<InventoryItem> = {},
): InventoryItem => ({
  kind: "verification-run",
  id,
  path: `/opt/gwrk-verification/${id}`,
  owned: true,
  completedAt,
  identity: `sha-${id}`,
  bytes: 10,
  heavyBytes: 1000,
  ...extra,
});

const noProtection = { releases: [], runs: [], images: [] };

describe("planRetention", () => {
  it("keeps protected releases plus the two newest unprotected", () => {
    const items = [
      release("1.0.0", "2026-01-01T00:00:00Z"),
      release("1.1.0", "2026-02-01T00:00:00Z"),
      release("1.2.0", "2026-03-01T00:00:00Z"),
      release("1.3.0", "2026-04-01T00:00:00Z"),
      release("1.4.0", "2026-05-01T00:00:00Z"),
    ];
    const plan = planRetention({
      items,
      protections: { ...noProtection, releases: ["1.0.0", "1.1.0"] },
      policy: DEFAULT_RETENTION_POLICY,
    });
    expect(plan.actions.map((a) => a.item.id)).toEqual(["1.2.0"]);
    expect(plan.reclaimableBytes).toBe(100);
    expect(plan.kept.map((k) => [k.item.id, k.reason])).toEqual([
      ["1.0.0", "protected"],
      ["1.1.0", "protected"],
      ["1.3.0", "recent"],
      ["1.4.0", "recent"],
    ]);
  });

  it("never deletes unknown items and reports them", () => {
    const plan = planRetention({
      items: [
        release("0.1.0", "2025-01-01T00:00:00Z", {
          owned: false,
          unknownReason: "symlink",
        }),
        release("0.2.0", "2025-01-02T00:00:00Z", {
          owned: false,
          unknownReason: "missing manifest",
        }),
      ],
      protections: noProtection,
      policy: { keepReleases: 0, keepRuns: 0 },
    });
    expect(plan.actions).toEqual([]);
    expect(plan.unknown.map((u) => u.reason)).toEqual([
      "symlink",
      "missing manifest",
    ]);
  });

  it("prunes heavy payloads past the run bound and keeps receipts", () => {
    const plan = planRetention({
      items: [
        run("a".repeat(24), "2026-01-01T00:00:00Z"),
        run("b".repeat(24), "2026-01-02T00:00:00Z"),
        run("c".repeat(24), "2026-01-03T00:00:00Z"),
        run("d".repeat(24), "2026-01-04T00:00:00Z", { heavyBytes: 0 }),
        run("e".repeat(24), "2026-01-05T00:00:00Z"),
      ],
      protections: { ...noProtection, runs: ["a".repeat(24)] },
      policy: DEFAULT_RETENTION_POLICY,
    });
    expect(plan.actions).toEqual([
      expect.objectContaining({
        action: "prune-run-heavy",
        item: expect.objectContaining({ id: "b".repeat(24) }),
      }),
    ]);
    expect(plan.reclaimableBytes).toBe(1000);
  });

  it("deletes only owned, unreferenced images of pruned runs", () => {
    const oldRun = "a".repeat(24);
    const keptRun = "b".repeat(24);
    const image = (
      id: string,
      extra: Partial<InventoryItem>,
    ): InventoryItem => ({
      kind: "docker-image",
      id,
      owned: true,
      runId: oldRun,
      identity: id,
      bytes: 500,
      ...extra,
    });
    const plan = planRetention({
      items: [
        run(oldRun, "2026-01-01T00:00:00Z"),
        run(keptRun, "2026-01-02T00:00:00Z"),
        image("sha256:01", {}),
        image("sha256:02", { inUse: true }),
        image("sha256:03", { owned: false, unknownReason: "foreign label" }),
        image("sha256:04", { runId: keptRun }),
        image("sha256:05", {}),
      ],
      protections: { ...noProtection, images: ["sha256:05"] },
      policy: { keepReleases: 2, keepRuns: 1 },
    });
    expect(plan.actions.map((a) => [a.action, a.item.id])).toEqual([
      ["prune-run-heavy", oldRun],
      ["delete-image", "sha256:01"],
    ]);
    expect(plan.unknown.map((u) => u.item.id)).toEqual(["sha256:03"]);
    expect(
      plan.kept
        .filter((k) => k.item.kind === "docker-image")
        .map((k) => [k.item.id, k.reason]),
    ).toEqual([
      ["sha256:02", "in-use"],
      ["sha256:04", "run-kept"],
      ["sha256:05", "protected"],
    ]);
  });

  it("keeps owned items with no completion time", () => {
    const plan = planRetention({
      items: [run("f".repeat(24), "", { completedAt: undefined })],
      protections: noProtection,
      policy: { keepReleases: 0, keepRuns: 0 },
    });
    expect(plan.actions).toEqual([]);
    expect(plan.kept[0]?.reason).toBe("incomplete");
  });

  it("returns equal plans for equal inputs regardless of order", () => {
    const items = [
      release("1.0.0", "2026-01-01T00:00:00Z"),
      release("1.1.0", "2026-02-01T00:00:00Z"),
      release("1.2.0", "2026-03-01T00:00:00Z"),
    ];
    const input = {
      protections: noProtection,
      policy: DEFAULT_RETENTION_POLICY,
    };
    expect(planRetention({ ...input, items })).toEqual(
      planRetention({ ...input, items: [...items].reverse() }),
    );
  });
});

describe("planPreflight", () => {
  it("sums requirements that share one filesystem", () => {
    const result = planPreflight(
      [
        { label: "root minimum", path: "/", requiredBytes: 8 * GIB },
        { label: "build workspace", path: "/opt", requiredBytes: 2 * GIB },
        { label: "data", path: "/var/lib/gwrk", requiredBytes: 4 * GIB },
      ],
      [
        { path: "/", device: "root", availableBytes: 9 * GIB },
        { path: "/opt", device: "root", availableBytes: 9 * GIB },
        { path: "/var/lib/gwrk", device: "data", availableBytes: 5 * GIB },
      ],
    );
    expect(result).toEqual({
      ok: false,
      shortfalls: [
        {
          device: "root",
          labels: ["root minimum", "build workspace"],
          requiredBytes: 10 * GIB,
          availableBytes: 9 * GIB,
          missingBytes: 1 * GIB,
        },
      ],
    });
  });

  it("fails closed when a path has no sample", () => {
    const result = planPreflight(
      [{ label: "root", path: "/", requiredBytes: 1 }],
      [],
    );
    expect(result.ok).toBe(false);
  });

  it("passes with enough space", () => {
    expect(
      planPreflight(
        [{ label: "root", path: "/", requiredBytes: 8 * GIB }],
        [{ path: "/", device: "root", availableBytes: 8 * GIB }],
      ),
    ).toEqual({ ok: true, shortfalls: [] });
  });

  it("sizes installs from the uncompressed archive", () => {
    expect(installRequiredBytes(GIB)).toBe(5 * GIB);
  });

  it("keeps the 8 GiB root floor on top of build bytes on a shared root", () => {
    const requirements = verificationRequirements({
      rootPath: "/",
      runsRoot: "/opt/gwrk-verification",
      dataRoot: "/var/lib/gwrk/verification-fixtures",
      buildBytes: 3 * GIB,
      dataBytes: 6 * GIB,
    });
    const result = planPreflight(requirements, [
      { path: "/", device: "root", availableBytes: 10 * GIB },
      {
        path: "/opt/gwrk-verification",
        device: "root",
        availableBytes: 10 * GIB,
      },
      {
        path: "/var/lib/gwrk/verification-fixtures",
        device: "data",
        availableBytes: 10 * GIB,
      },
    ]);
    expect(result.shortfalls.map((s) => [s.device, s.missingBytes])).toEqual([
      ["root", 1 * GIB],
    ]);
  });
});

describe("parseReleasePointer", () => {
  it.each([
    ["releases/1.6.0-beta.2", { ok: true, version: "1.6.0-beta.2" }],
    ["../releases/1.0.0", { ok: false }],
    ["/opt/gwrk/releases/1.0.0", { ok: false }],
    ["releases/../x", { ok: false }],
    ["releases/1.0.0/", { ok: false }],
    ["releases/..", { ok: false }],
    ["", { ok: false }],
  ])("parses %s", (text, expected) => {
    expect(parseReleasePointer(text)).toMatchObject(expected);
  });
});
