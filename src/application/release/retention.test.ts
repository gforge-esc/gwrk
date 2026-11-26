/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReleaseRootAdapter } from "../../adapters/release/retention-fs.js";
import { GIB, type SpaceSample } from "../../domain/retention-policy.js";
import type { DiskSpacePort } from "../../ports/retention-port.js";
import { runRetentionStep } from "./retention.js";

let root: string;
let outside: string;
const noService = {
  discover: async () => ({ releases: [], configuredPaths: [] }),
};
const held = { assertHeld: async () => {} };

const install = (version: string, builtAt: string, bytes = 1000) => {
  const dir = join(root, "releases", version);
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "release-manifest.json"),
    JSON.stringify({ version, builtAt, tarballSha256: "a".repeat(64) }),
  );
  writeFileSync(join(dir, "dist/payload.bin"), Buffer.alloc(bytes));
};
const point = (name: "current" | "previous", version: string) => {
  rmSync(join(root, name), { force: true });
  symlinkSync(`releases/${version}`, join(root, name));
};
const releases = () =>
  readdirSync(join(root, "releases"))
    .filter((n) => !n.startsWith("."))
    .sort();

/** Free space grows by every byte removed under the release root. */
const fakeDisk = (initialFree: number): DiskSpacePort & { freed: number } => {
  const disk = {
    freed: 0,
    async sample(paths: readonly string[]): Promise<SpaceSample[]> {
      return paths.map((path) => ({
        path,
        device: "root",
        availableBytes: initialFree + disk.freed,
      }));
    },
  };
  return disk;
};

const step = (
  disk: DiskSpacePort & { freed: number },
  requiredBytes: number,
  candidate = "9.9.9",
) => {
  const adapter = createReleaseRootAdapter(root, {
    service: noService,
    candidate,
    onRemoved: (bytes) => {
      disk.freed += bytes;
    },
  });
  return runRetentionStep({
    inventory: adapter,
    effects: adapter,
    disk,
    receipts: adapter,
    lock: held,
    policy: { keepReleases: 2, keepRuns: 2 },
    requirements: [{ label: "install", path: root, requiredBytes }],
    now: () => "2026-11-26T16:30:00.000Z",
  });
};

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "gwrk-retention-"));
  root = join(base, "opt-gwrk");
  outside = join(base, "outside");
  mkdirSync(join(root, "releases"), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(outside, "gwrk.db"), "ledger");
});
afterEach(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

describe("release retention step", () => {
  it("keeps old active and rollback releases and frees owned history", async () => {
    install("1.0.0", "2026-01-01T00:00:00Z");
    install("1.1.0", "2026-02-01T00:00:00Z");
    install("1.2.0", "2026-03-01T00:00:00Z");
    install("1.3.0", "2026-04-01T00:00:00Z");
    install("1.4.0", "2026-05-01T00:00:00Z");
    install("1.5.0", "2026-06-01T00:00:00Z");
    point("current", "1.0.0");
    point("previous", "1.1.0");
    const disk = fakeDisk(0);

    const result = await step(disk, 2000);

    expect(result.ok).toBe(true);
    expect(releases()).toEqual(["1.0.0", "1.1.0", "1.4.0", "1.5.0"]);
    expect(disk.freed).toBeGreaterThanOrEqual(2000);
    expect(readFileSync(join(outside, "gwrk.db"), "utf8")).toBe("ledger");
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.deleted.map((d: { id: string }) => d.id)).toEqual([
      "1.2.0",
      "1.3.0",
    ]);
  });

  it("is idempotent on a second run", async () => {
    for (const [v, m] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ])
      install(v, `2026-${m}-01T00:00:00Z`);
    point("current", "1.3.0");
    const disk = fakeDisk(10 * GIB);
    await step(disk, 1);
    const before = releases();
    const second = await step(disk, 1);
    expect(second.ok).toBe(true);
    expect(releases()).toEqual(before);
    expect(second.deleted).toEqual([]);
  });

  it("fails before work with specifics when protected bytes block space", async () => {
    install("1.0.0", "2026-01-01T00:00:00Z");
    install("1.1.0", "2026-02-01T00:00:00Z");
    point("current", "1.0.0");
    point("previous", "1.1.0");
    const result = await step(fakeDisk(100), 8 * GIB);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Not enough free space/);
    expect(result.message).toMatch(/1\.0\.0 \(protected/);
    expect(releases()).toEqual(["1.0.0", "1.1.0"]);
  });

  it("preserves unknown, symlinked and outside-root entries", async () => {
    install("1.0.0", "2026-01-01T00:00:00Z");
    install("1.1.0", "2026-02-01T00:00:00Z");
    install("1.2.0", "2026-03-01T00:00:00Z");
    install("1.3.0", "2026-04-01T00:00:00Z");
    point("current", "1.3.0");
    mkdirSync(join(root, "releases/0.9.0"));
    symlinkSync(outside, join(root, "releases/0.8.0"));
    writeFileSync(join(root, "releases/notes.txt"), "keep");
    mkdirSync(join(root, "releases/0.7.0"));
    writeFileSync(
      join(root, "releases/0.7.0/release-manifest.json"),
      JSON.stringify({ version: "0.6.0", builtAt: "2020-01-01T00:00:00Z" }),
    );
    const result = await step(fakeDisk(10 * GIB), 1);
    expect(result.ok).toBe(true);
    expect(releases()).toEqual([
      "0.7.0",
      "0.8.0",
      "0.9.0",
      "1.1.0",
      "1.2.0",
      "1.3.0",
      "notes.txt",
    ]);
    expect(existsSync(join(outside, "gwrk.db"))).toBe(true);
    expect(result.unknown.map((u) => u.id).sort()).toEqual([
      "0.7.0",
      "0.8.0",
      "0.9.0",
      "notes.txt",
    ]);
  });

  it.each([
    ["dangling", () => symlinkSync("releases/7.7.7", join(root, "current"))],
    ["escaping", () => symlinkSync("../outside", join(root, "current"))],
    [
      "absolute",
      () => symlinkSync(join(root, "releases/1.0.0"), join(root, "current")),
    ],
    ["not a symlink", () => mkdirSync(join(root, "previous"))],
    [
      "release symlink",
      () => {
        symlinkSync(join(root, "releases/1.0.0"), join(root, "releases/2.0.0"));
        symlinkSync("releases/2.0.0", join(root, "current"));
      },
    ],
  ])(
    "fails closed on a %s pointer without deleting",
    async (_name, arrange) => {
      for (const [v, m] of [
        ["1.0.0", "01"],
        ["1.1.0", "02"],
        ["1.2.0", "03"],
        ["1.3.0", "04"],
      ])
        install(v, `2026-${m}-01T00:00:00Z`);
      arrange();
      const before = readdirSync(join(root, "releases")).sort();
      const result = await step(fakeDisk(10 * GIB), 1);
      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/pointer/i);
      expect(readdirSync(join(root, "releases")).sort()).toEqual(before);
    },
  );

  it("skips an item whose pointer changes between plan and delete", async () => {
    for (const [v, m] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ])
      install(v, `2026-${m}-01T00:00:00Z`);
    point("current", "1.3.0");
    const disk = fakeDisk(10 * GIB);
    const adapter = createReleaseRootAdapter(root, {
    service: noService, candidate: "9.9.9" });
    let reads = 0;
    const result = await runRetentionStep({
      inventory: {
        inventory: () => adapter.inventory(),
        reidentify: (item) => adapter.reidentify(item),
        readProtections: async () => {
          reads += 1;
          // A concurrent rollback moves current to the oldest release after planning.
          if (reads === 2) point("current", "1.0.0");
          return adapter.readProtections();
        },
      },
      effects: adapter,
      disk,
      receipts: adapter,
    lock: held,
      policy: { keepReleases: 2, keepRuns: 2 },
      requirements: [{ label: "install", path: root, requiredBytes: 1 }],
      now: () => "2026-11-26T16:30:00.000Z",
    });
    expect(releases()).toContain("1.0.0");
    expect(result.skipped.map((s) => s.id)).toContain("1.0.0");
  });

  it("skips an item whose identity changed after planning", async () => {
    for (const [v, m] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ])
      install(v, `2026-${m}-01T00:00:00Z`);
    point("current", "1.3.0");
    const adapter = createReleaseRootAdapter(root, {
    service: noService, candidate: "9.9.9" });
    const result = await runRetentionStep({
      inventory: {
        ...adapter,
        inventory: () => adapter.inventory(),
        readProtections: () => adapter.readProtections(),
        reidentify: async (item) => {
          writeFileSync(
            join(root, "releases", item.id, "release-manifest.json"),
            JSON.stringify({
              version: item.id,
              builtAt: "2030-01-01T00:00:00Z",
            }),
          );
          return adapter.reidentify(item);
        },
      },
      effects: adapter,
      disk: fakeDisk(10 * GIB),
      receipts: adapter,
    lock: held,
      policy: { keepReleases: 2, keepRuns: 2 },
      requirements: [{ label: "install", path: root, requiredBytes: 1 }],
      now: () => "2026-11-26T16:30:00.000Z",
    });
    expect(result.deleted).toEqual([]);
    expect(releases()).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]);
  });

  it("records a partial failure and keeps going", async () => {
    for (const [v, m] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ])
      install(v, `2026-${m}-01T00:00:00Z`);
    point("current", "1.3.0");
    const adapter = createReleaseRootAdapter(root, {
    service: noService, candidate: "9.9.9" });
    const result = await runRetentionStep({
      inventory: adapter,
      effects: {
        recoverQuarantine: () => adapter.recoverQuarantine(),
        apply: async (action) => {
          if (action.item.id === "1.0.0") throw new Error("EBUSY synthetic");
          return adapter.apply(action);
        },
      },
      disk: fakeDisk(10 * GIB),
      receipts: adapter,
    lock: held,
      policy: { keepReleases: 1, keepRuns: 2 },
      requirements: [{ label: "install", path: root, requiredBytes: 1 }],
      now: () => "2026-11-26T16:30:00.000Z",
    });
    expect(result.failed).toEqual([
      { id: "1.0.0", action: "delete-release", error: "EBUSY synthetic" },
    ]);
    expect(releases()).toEqual(["1.0.0", "1.2.0", "1.3.0"]);
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.failed).toHaveLength(1);
  });

  it("protects the incoming candidate", async () => {
    for (const [v, m] of [
      ["1.0.0", "01"],
      ["1.1.0", "02"],
      ["1.2.0", "03"],
      ["1.3.0", "04"],
    ])
      install(v, `2026-${m}-01T00:00:00Z`);
    point("current", "1.3.0");
    await step(fakeDisk(10 * GIB), 1, "1.0.0");
    expect(releases()).toEqual(["1.0.0", "1.1.0", "1.2.0", "1.3.0"]);
  });
});
