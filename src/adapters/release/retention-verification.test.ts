/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRetentionStep } from "../../application/release/retention.js";
import { GIB } from "../../domain/retention-policy.js";
import { createVerificationRootAdapter } from "./retention-verification.js";

let base: string;
let runs: string;
let data: string;
const busy = new Set<string>();

const runId = (c: string) => c.repeat(24);
const stage = (
  id: string,
  completedAt: string | null,
  extra: Record<string, unknown> = {},
) => {
  const run = join(runs, id);
  mkdirSync(join(run, "build-context"), { recursive: true });
  mkdirSync(join(data, id), { recursive: true });
  writeFileSync(join(run, "source.tar"), Buffer.alloc(500));
  writeFileSync(join(run, "build-context/layer.bin"), Buffer.alloc(500));
  writeFileSync(join(data, id, "images.tar"), Buffer.alloc(1000));
  writeFileSync(join(run, "native-receipt.json"), "{}");
  writeFileSync(join(run, "native-receipt.sig.json"), "{}");
  writeFileSync(
    join(run, "gwrk-run-owner.json"),
    JSON.stringify({
      schema: 1,
      runId: id,
      state: completedAt ? "completed" : "running",
      completedAt,
      heavy: [
        { root: "run", path: "source.tar" },
        { root: "run", path: "build-context" },
        { root: "data", path: "images.tar" },
      ],
      images: [],
      ...extra,
    }),
  );
};

const step = () => {
  const adapter = createVerificationRootAdapter(runs, data, {
    leaseBusy: async (path) => busy.has(path),
    protectedRuns: [],
  });
  return runRetentionStep({
    inventory: adapter,
    effects: adapter,
    disk: {
      sample: async (paths) =>
        paths.map((path) => ({ path, device: "d", availableBytes: 20 * GIB })),
    },
    receipts: adapter,
    policy: { keepReleases: 2, keepRuns: 2 },
    requirements: [{ label: "root", path: runs, requiredBytes: 8 * GIB }],
    now: () => "2026-11-26T16:40:00.000Z",
  });
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gwrk-verification-retention-"));
  runs = join(base, "opt-gwrk-verification");
  data = join(base, "verification-fixtures");
  mkdirSync(runs);
  mkdirSync(data);
  busy.clear();
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("verification retention", () => {
  it("prunes heavy payloads past two runs and keeps receipts", async () => {
    stage(runId("a"), "2026-01-01T00:00:00Z");
    stage(runId("b"), "2026-01-02T00:00:00Z");
    stage(runId("c"), "2026-01-03T00:00:00Z");
    const result = await step();
    expect(result.ok).toBe(true);
    expect(result.deleted.map((d) => d.id)).toEqual([runId("a")]);
    const old = join(runs, runId("a"));
    expect(existsSync(join(old, "source.tar"))).toBe(false);
    expect(existsSync(join(old, "build-context"))).toBe(false);
    expect(existsSync(join(data, runId("a"), "images.tar"))).toBe(false);
    expect(existsSync(join(old, "native-receipt.json"))).toBe(true);
    expect(existsSync(join(old, "native-receipt.sig.json"))).toBe(true);
    expect(existsSync(join(old, "gwrk-run-owner.json"))).toBe(true);
    expect(existsSync(join(runs, runId("b"), "source.tar"))).toBe(true);

    const second = await step();
    expect(second.deleted).toEqual([]);
  });

  it("protects a run whose lease is held and a running run", async () => {
    stage(runId("a"), "2026-01-01T00:00:00Z");
    stage(runId("b"), null);
    stage(runId("c"), "2026-01-03T00:00:00Z");
    stage(runId("d"), "2026-01-04T00:00:00Z");
    stage(runId("e"), "2026-01-05T00:00:00Z");
    busy.add(join(runs, runId("a"), ".lease"));
    const result = await step();
    expect(result.deleted.map((d) => d.id)).toEqual([runId("c")]);
    expect(existsSync(join(runs, runId("a"), "source.tar"))).toBe(true);
    expect(existsSync(join(runs, runId("b"), "source.tar"))).toBe(true);
  });

  it("preserves pre-marker, symlinked and escaping runs", async () => {
    for (const c of ["c", "d", "e"])
      stage(
        runId(c),
        `2026-01-0${c === "c" ? 3 : c === "d" ? 4 : 5}T00:00:00Z`,
      );
    mkdirSync(join(runs, runId("1")));
    writeFileSync(join(runs, runId("1"), "source.tar"), "legacy");
    symlinkSync(join(base), join(runs, runId("2")));
    stage(runId("3"), "2025-01-01T00:00:00Z", {
      heavy: [{ root: "run", path: "../outside" }],
    });
    stage(runId("4"), "2025-01-01T00:00:00Z");
    rmSync(join(runs, runId("4"), "source.tar"));
    symlinkSync(join(base, "victim"), join(runs, runId("4"), "source.tar"));
    writeFileSync(join(base, "victim"), "keep");
    const result = await step();
    expect(result.unknown.map((u) => u.id).sort()).toEqual([
      runId("1"),
      runId("2"),
      runId("3"),
      runId("4"),
    ]);
    expect(existsSync(join(runs, runId("1"), "source.tar"))).toBe(true);
    expect(existsSync(join(base, "victim"))).toBe(true);
    expect(result.deleted.map((d) => d.id)).toEqual([runId("c")]);
  });
});
