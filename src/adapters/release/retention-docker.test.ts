/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runRetentionStep } from "../../application/release/retention.js";
import { GIB } from "../../domain/retention-policy.js";
import {
  type DockerRunner,
  combineRetentionPorts,
  createDockerImageAdapter,
} from "./retention-docker.js";
import { createVerificationRootAdapter } from "./retention-verification.js";

const id = (c: string) => `sha256:${c.repeat(64)}`;
const run = (c: string) => c.repeat(24);

let base: string;
let runs: string;
let data: string;
let protectedFile: string;
let images: Map<
  string,
  { labels: Record<string, string>; reportedId?: string; users?: boolean }
>;
let calls: string[][];

const docker: DockerRunner = async (args) => {
  calls.push([...args]);
  if (args[0] === "image" && args[1] === "inspect") {
    const image = images.get(args[4] ?? "");
    if (!image) return { code: 1, stdout: "" };
    return {
      code: 0,
      stdout: JSON.stringify({
        Id: image.reportedId ?? args[4],
        Size: GIB,
        Config: { Labels: image.labels },
      }),
    };
  }
  if (args[0] === "ps") {
    const target = (args[5] ?? "").replace("ancestor=", "");
    return { code: 0, stdout: images.get(target)?.users ? "c0ffee\n" : "" };
  }
  if (args[0] === "image" && args[1] === "rm") {
    images.delete(args[2] ?? "");
    return { code: 0, stdout: "" };
  }
  return { code: 99, stdout: "" };
};

const stage = (r: string, completedAt: string, imageIds: string[]) => {
  mkdirSync(join(runs, r), { recursive: true });
  writeFileSync(join(runs, r, "source.tar"), Buffer.alloc(10));
  writeFileSync(
    join(runs, r, "gwrk-run-owner.json"),
    JSON.stringify({
      schema: 1,
      runId: r,
      state: "completed",
      completedAt,
      heavy: [{ root: "run", path: "source.tar" }],
      images: imageIds.map((configId) => ({
        configId,
        manifestId: `sha256:${"f".repeat(64)}`,
      })),
    }),
  );
};

const step = () => {
  const verification = createVerificationRootAdapter(runs, data, {
    leaseBusy: async () => false,
    protectedRuns: [],
  });
  const port = combineRetentionPorts([
    { kinds: ["verification-run"], port: verification },
    {
      kinds: ["docker-image"],
      port: createDockerImageAdapter(runs, {
        docker,
        protectedImagesFile: protectedFile,
      }),
    },
  ]);
  return runRetentionStep({
    inventory: port,
    effects: port,
    disk: {
      sample: async (paths) =>
        paths.map((path) => ({ path, device: "d", availableBytes: 20 * GIB })),
    },
    receipts: verification,
    policy: { keepReleases: 2, keepRuns: 1 },
    requirements: [{ label: "root", path: runs, requiredBytes: 8 * GIB }],
    now: () => "2026-11-26T16:45:00.000Z",
  });
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gwrk-docker-retention-"));
  runs = join(base, "runs");
  data = join(base, "data");
  mkdirSync(runs);
  mkdirSync(data);
  protectedFile = join(base, "protected-images.json");
  writeFileSync(protectedFile, JSON.stringify([id("9")]));
  calls = [];
  const owned = (r: string) => ({
    "org.gwrk.managed": "verification",
    "org.gwrk.run": r,
  });
  images = new Map([
    [id("1"), { labels: owned(run("a")) }],
    [id("2"), { labels: owned(run("a")), users: true }],
    [
      id("3"),
      {
        labels: {
          "org.gwrk.managed": "verification",
          "org.gwrk.run": run("z"),
        },
      },
    ],
    [id("4"), { labels: owned(run("a")), reportedId: id("e") }],
    [id("5"), { labels: owned(run("b")) }],
    [id("9"), { labels: owned(run("a")) }],
  ]);
  stage(run("a"), "2026-01-01T00:00:00Z", [
    id("1"),
    id("2"),
    id("3"),
    id("4"),
    id("9"),
  ]);
  stage(run("b"), "2026-01-02T00:00:00Z", [id("5")]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("Docker image retention", () => {
  it("removes only owned, unreferenced, unprotected images of pruned runs", async () => {
    const result = await step();
    expect(result.ok).toBe(true);
    expect([...images.keys()].sort()).toEqual([
      id("2"),
      id("3"),
      id("4"),
      id("5"),
      id("9"),
    ]);
    expect(result.unknown.map((u) => [u.id, u.reason]).sort()).toEqual([
      [id("3"), "foreign label"],
      [id("4"), "config ID mismatch"],
    ]);
    const removals = calls.filter((c) => c[1] === "rm");
    expect(removals).toEqual([["image", "rm", id("1")]]);
    expect(calls.flat()).not.toContain("prune");
    expect(calls.flat()).not.toContain("-f");
    expect(calls.flat()).not.toContain("--force");
  });

  it("fails closed when the protected image list is unreadable", async () => {
    rmSync(protectedFile);
    const result = await step();
    expect(result.ok).toBe(false);
    expect(calls.filter((c) => c[1] === "rm")).toEqual([]);
    expect(images.size).toBe(6);
  });

  it("is idempotent", async () => {
    await step();
    calls = [];
    const second = await step();
    expect(second.deleted).toEqual([]);
    expect(calls.filter((c) => c[1] === "rm")).toEqual([]);
  });
});
