/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

// Parent review findings at e3db530e. Each case runs on real isolated roots.

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
import { createQuarantine } from "../../adapters/release/retention-quarantine.js";
import { GIB } from "../../domain/retention-policy.js";
import type {
  LockProofPort,
  RunningService,
  RunningServicePort,
} from "../../ports/retention-port.js";
import { runRetentionStep } from "./retention.js";

let base: string;
let root: string;

const install = (version: string, month: string) => {
  const dir = join(root, "releases", version);
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(
    join(dir, "release-manifest.json"),
    JSON.stringify({
      version,
      builtAt: `2026-${month}-01T00:00:00Z`,
      tarballSha256: "a".repeat(64),
    }),
  );
  writeFileSync(join(dir, "dist/payload.bin"), Buffer.alloc(100));
};
const point = (name: "current" | "previous", version: string) =>
  symlinkSync(`releases/${version}`, join(root, name));
const releases = () =>
  readdirSync(join(root, "releases"))
    .filter((n) => !n.startsWith("."))
    .sort();

const service = (value: Partial<RunningService> = {}): RunningServicePort => ({
  discover: async () => ({ releases: [], configuredPaths: [], ...value }),
});
const held: LockProofPort = { assertHeld: async () => {} };

const step = (
  options: { service?: RunningServicePort; lock?: LockProofPort } = {},
) => {
  const adapter = createReleaseRootAdapter(root, {
    candidate: "9.9.9",
    service: options.service ?? service(),
  });
  return runRetentionStep({
    inventory: adapter,
    effects: adapter,
    disk: {
      sample: async (paths) =>
        paths.map((path) => ({ path, device: "d", availableBytes: 10 * GIB })),
    },
    receipts: adapter,
    lock: options.lock ?? held,
    policy: { keepReleases: 2, keepRuns: 2 },
    requirements: [{ label: "install", path: root, requiredBytes: 1 }],
    now: () => "2026-11-26T16:30:00.000Z",
  });
};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "gwrk-retention-closure-"));
  root = join(base, "opt-gwrk");
  mkdirSync(join(root, "releases"), { recursive: true });
  for (const [v, m] of [
    ["1.0.0", "01"],
    ["1.1.0", "02"],
    ["1.2.0", "03"],
    ["1.3.0", "04"],
    ["1.4.0", "05"],
    ["1.5.0", "06"],
  ] as const)
    install(v, m);
  point("current", "1.5.0");
  point("previous", "1.4.0");
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe("running release protection", () => {
  it("keeps the running release even when it is older than current and previous", async () => {
    const result = await step({ service: service({ releases: ["1.0.0"] }) });
    expect(result.ok).toBe(true);
    expect(releases()).toEqual(["1.0.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0"]);
    expect(result.retained).toContainEqual(
      expect.objectContaining({ id: "1.0.0", reason: "protected" }),
    );
  });

  it("stops before any deletion when the running service is ambiguous", async () => {
    const result = await step({
      service: {
        discover: async () => {
          throw new Error("Running unit has no MainPID.");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/MainPID/);
    expect(releases()).toHaveLength(6);
  });
});

describe("configured state inside a release", () => {
  it("refuses to delete a release that holds a configured state path", async () => {
    mkdirSync(join(root, "releases/1.0.0/state"));
    writeFileSync(join(root, "releases/1.0.0/state/gwrk.db"), "ledger");
    const result = await step({
      service: service({
        configuredPaths: [join(root, "releases/1.0.0/state/gwrk.db")],
      }),
    });
    expect(
      readFileSync(join(root, "releases/1.0.0/state/gwrk.db"), "utf8"),
    ).toBe("ledger");
    expect(result.unknown).toContainEqual(
      expect.objectContaining({
        id: "1.0.0",
        reason: expect.stringMatching(/configured/),
      }),
    );
    expect(releases()).not.toContain("1.1.0");
  });

  it("refuses when a configured path is missing but would live inside a release", async () => {
    const result = await step({
      service: service({
        configuredPaths: [join(root, "releases/1.1.0/backups/not-yet")],
      }),
    });
    expect(releases()).toContain("1.1.0");
    expect(result.unknown.map((u) => u.id)).toContain("1.1.0");
  });
});

describe("quarantine ownership", () => {
  it("preserves a parked rollback when its original pointer is now dangling", async () => {
    const source = join(root, "releases/1.0.0");
    const { createHash } = await import("node:crypto");
    const identity = createHash("sha256")
      .update(readFileSync(join(source, "release-manifest.json")))
      .digest("hex");
    const { parked } = await createQuarantine(join(root, ".retention")).park({
      key: "release:1.0.0",
      source,
      identity,
    });
    rmSync(join(root, "previous"));
    point("previous", "1.0.0");
    const result = await step();
    expect(result.ok).toBe(true);
    expect(existsSync(join(source, "dist/payload.bin"))).toBe(true);
    expect(existsSync(parked)).toBe(false);
  });

  it("never deletes an unknown entry left in the quarantine directory", async () => {
    const stranger = join(root, ".retention/trash/stranger");
    mkdirSync(stranger, { recursive: true });
    writeFileSync(join(stranger, "sentinel"), "keep");
    const result = await step();
    expect(readFileSync(join(stranger, "sentinel"), "utf8")).toBe("keep");
    const receipt = JSON.parse(readFileSync(result.receiptPath, "utf8"));
    expect(receipt.quarantinePreserved).toContainEqual(
      expect.objectContaining({ name: "stranger" }),
    );
  });
});

describe("canonical release tree", () => {
  it("fails closed and keeps foreign files when releases is a symlink", async () => {
    const foreign = join(base, "foreign");
    mkdirSync(join(foreign, "0.1.0"), { recursive: true });
    writeFileSync(
      join(foreign, "0.1.0/release-manifest.json"),
      JSON.stringify({
        version: "0.1.0",
        builtAt: "2025-01-01T00:00:00Z",
        tarballSha256: "a".repeat(64),
      }),
    );
    writeFileSync(join(foreign, "0.1.0/sentinel"), "keep");
    rmSync(join(root, "current"));
    rmSync(join(root, "previous"));
    rmSync(join(root, "releases"), { recursive: true, force: true });
    symlinkSync(foreign, join(root, "releases"));
    const adapter = createReleaseRootAdapter(root, { service: service() });
    const result = await runRetentionStep({
      inventory: adapter,
      effects: adapter,
      disk: adapter,
      receipts: adapter,
      lock: held,
      policy: { keepReleases: 0, keepRuns: 0 },
      requirements: [{ label: "install", path: root, requiredBytes: 1 }],
      now: () => "2026-11-26T16:30:00.000Z",
    });
    expect(readFileSync(join(foreign, "0.1.0/sentinel"), "utf8")).toBe("keep");
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/releases/);
    expect(result.deleted).toEqual([]);
  });

  it("refuses to write through a symlinked control directory", async () => {
    const foreign = join(base, "foreign-control");
    mkdirSync(foreign);
    symlinkSync(foreign, join(root, ".retention"));
    await expect(step()).rejects.toThrow(/\.retention/);
    expect(readdirSync(foreign)).toEqual([]);
    expect(releases()).toHaveLength(6);
  });
});

describe("lock proof", () => {
  it("deletes nothing when the exclusive lock cannot be proven", async () => {
    const result = await step({
      lock: {
        assertHeld: async () => {
          throw new Error("Retention lock is not held by this process.");
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/lock/);
    expect(releases()).toHaveLength(6);
    expect(existsSync(join(root, "releases/1.0.0"))).toBe(true);
  });
});
