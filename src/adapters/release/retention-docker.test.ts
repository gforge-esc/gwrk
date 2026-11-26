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
const tag = (r: string, suffix: string) => `gwrk-verification:${r}-${suffix}`;
const owned = (r: string) => ({
  "org.gwrk.managed": "verification",
  "org.gwrk.run": r,
});

interface HostImage {
  tags: string[];
  labels: Record<string, string>;
}

let base: string;
let runs: string;
let data: string;
let host: Map<string, HostImage>;
let containers: Map<string, string>;
let failContainers: boolean;
let calls: string[][];

const docker: DockerRunner = async (args) => {
  calls.push([...args]);
  const [group, verb] = args;
  if (group === "image" && verb === "inspect") {
    const ref = args[args.length - 1] ?? "";
    const entry = [...host].find(
      ([hostId, image]) => hostId === ref || image.tags.includes(ref),
    );
    if (!entry) return { code: 1, stdout: "" };
    const [hostId, image] = entry;
    return {
      code: 0,
      stdout: JSON.stringify({
        Id: hostId,
        RepoTags: image.tags,
        Size: GIB,
        Config: { Labels: image.labels },
      }),
    };
  }
  if (group === "ps") {
    if (failContainers) return { code: 1, stdout: "" };
    return {
      code: 0,
      stdout: [...containers.keys()].map((c) => `${c}\n`).join(""),
    };
  }
  if (group === "container" && verb === "inspect") {
    const ids = args.slice(4);
    return {
      code: 0,
      stdout: ids.map((c) => `${containers.get(c) ?? ""}\n`).join(""),
    };
  }
  if (group === "image" && verb === "rm") {
    const target = args[2] ?? "";
    if (!host.delete(target)) return { code: 1, stdout: "" };
    return { code: 0, stdout: "" };
  }
  return { code: 99, stdout: "" };
};

const record = (
  r: string,
  fields: Record<string, unknown>,
  images: Record<string, string>[],
) => {
  mkdirSync(join(runs, r), { recursive: true });
  writeFileSync(join(runs, r, "source.tar"), Buffer.alloc(10));
  writeFileSync(
    join(runs, r, "gwrk-run-owner.json"),
    JSON.stringify({
      schema: 1,
      runId: r,
      heavy: [{ root: "run", path: "source.tar" }],
      images,
      ...fields,
    }),
  );
};
const completed = (r: string, day: string, images: Record<string, string>[]) =>
  record(
    r,
    {
      state: "completed",
      startedAt: `2026-01-${day}T00:00:00Z`,
      completedAt: `2026-01-${day}T01:00:00Z`,
    },
    images,
  );

const step = () => {
  const verification = createVerificationRootAdapter(runs, data, {
    leaseBusy: async () => false,
    acquireLease: async () => async () => {},
    protectedRuns: [],
    now: () => "2026-11-26T16:45:00.000Z",
  });
  const port = combineRetentionPorts([
    { kinds: ["verification-run"], port: verification },
    {
      kinds: ["docker-image"],
      port: createDockerImageAdapter(runs, {
        docker,
        acquireLease: async () => async () => {},
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
    lock: { assertHeld: async () => {} },
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
  calls = [];
  failContainers = false;
  containers = new Map();
  host = new Map([
    // Production gateway image. Its host ID equals run a's archive config digest.
    [id("c"), { tags: ["traefik:v3.7.18"], labels: {} }],
    [id("1"), { tags: [tag(run("a"), "flat")], labels: owned(run("a")) }],
    [id("b"), { tags: [tag(run("b"), "flat")], labels: owned(run("b")) }],
  ]);
  completed(run("a"), "01", [
    {
      tag: tag(run("a"), "flat"),
      hostImageId: id("1"),
      archiveConfigId: id("c"),
    },
  ]);
  completed(run("b"), "02", [
    {
      tag: tag(run("b"), "flat"),
      hostImageId: id("b"),
      archiveConfigId: id("d"),
    },
  ]);
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const removed = () =>
  calls.filter(([g, v]) => g === "image" && v === "rm").map((c) => c[2]);
const inspected = () =>
  calls
    .filter(([g, v]) => g === "image" && v === "inspect")
    .map((c) => c[c.length - 1]);

describe("Docker verification cache retention", () => {
  it("removes an owned image by its inspected host identity and never by its archive config ID", async () => {
    const result = await step();
    expect(result.ok).toBe(true);
    expect(removed()).toEqual([id("1")]);
    expect(host.has(id("c"))).toBe(true);
    expect(inspected()).not.toContain(id("c"));
    expect(host.has(id("b"))).toBe(true);
  });

  it("needs no protected image list and never prunes or forces", async () => {
    const result = await step();
    expect(result.ok).toBe(true);
    const flat = calls.map((c) => c.join(" ")).join("\n");
    expect(flat).not.toMatch(/prune|--force|\s-f(\s|$)/);
  });

  it("keeps an owned image that any container references", async () => {
    containers.set("c0ffee", id("1"));
    const result = await step();
    expect(removed()).toEqual([]);
    expect(host.has(id("1"))).toBe(true);
    expect(result.retained.map((r) => r.id)).toContain(id("1"));
  });

  it("preserves images with a foreign label, a foreign tag or a moved tag", async () => {
    host.set(id("2"), {
      tags: [tag(run("a"), "two")],
      labels: owned(run("z")),
    });
    host.set(id("3"), {
      tags: [tag(run("a"), "three"), "gwrk:production"],
      labels: owned(run("a")),
    });
    host.set(id("6"), {
      tags: [tag(run("a"), "build")],
      labels: owned(run("a")),
    });
    completed(run("a"), "01", [
      { tag: tag(run("a"), "flat"), hostImageId: id("1") },
      { tag: tag(run("a"), "two"), hostImageId: id("2") },
      { tag: tag(run("a"), "three"), hostImageId: id("3") },
      // The record names a host ID that no longer exists. The tag now points elsewhere.
      { tag: tag(run("a"), "build"), hostImageId: id("5") },
      { tag: "traefik:v3.7.18" },
    ]);
    const result = await step();
    expect(removed()).toEqual([id("1")]);
    for (const kept of [id("2"), id("3"), id("6"), id("c")])
      expect(host.has(kept)).toBe(true);
    expect(inspected()).not.toContain("traefik:v3.7.18");
    expect(result.unknown.map((u) => u.reason).sort()).toEqual([
      "foreign label",
      "foreign tag",
      "tag outside run namespace",
    ]);
  });

  it("never inspects images that no owned run record names", async () => {
    host.set(id("9"), { tags: ["gwrk:production"], labels: {} });
    await step();
    expect(inspected()).not.toContain(id("9"));
    expect(inspected()).not.toContain("gwrk:production");
  });

  it("finds an abandoned run's image through the tag declared before work", async () => {
    host.set(id("7"), {
      tags: [tag(run("c"), "build")],
      labels: owned(run("c")),
    });
    record(run("c"), { state: "staging", startedAt: "2025-12-01T00:00:00Z" }, [
      { tag: tag(run("c"), "build") },
    ]);
    await step();
    expect(removed().sort()).toEqual([id("1"), id("7")]);
  });

  it("fails closed when containers cannot be listed", async () => {
    failContainers = true;
    const result = await step();
    expect(result.ok).toBe(false);
    expect(removed()).toEqual([]);
  });
});
