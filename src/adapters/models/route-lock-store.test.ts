/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RunnerScope } from "../../domain/model-qualification.js";

const scope: RunnerScope = {
  workspaceId: "fixture",
  runnerProfile: "local",
  platform: "linux",
  arch: "x64",
};

function lock(updatedAt: string) {
  return {
    schemaVersion: 1,
    workspaceId: scope.workspaceId,
    runnerProfile: scope.runnerProfile,
    updatedAt,
    routes: {},
  };
}

describe("model route lock storage", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "gwrk-model-route-lock-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("accepts only one replacement against the same incumbent digest", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const first = createRouteLockStore(root);
    const second = createRouteLockStore(root);
    const incumbent = lock("2026-11-11T12:00:00.000Z");
    expect(await first.readRouteLock(scope)).toBeNull();
    expect(
      await first.writeRouteLockAtomic(scope, incumbent, null),
    ).toMatchObject({ ok: true });
    const current = await second.readRouteLock(scope);
    expect(current?.document).toEqual(incumbent);
    if (!current) throw new Error("Missing fixture incumbent");

    const replacements = [
      { ...lock("2026-11-11T12:01:00.000Z"), previousLock: incumbent },
      { ...lock("2026-11-11T12:02:00.000Z"), previousLock: incumbent },
    ];
    const results = await Promise.all([
      first.writeRouteLockAtomic(scope, replacements[0], current.digest),
      second.writeRouteLockAtomic(scope, replacements[1], current.digest),
    ]);
    expect(results.filter(({ ok }) => ok)).toHaveLength(1);
    expect(results).toContainEqual({ ok: false, reason: "incumbent-changed" });
    const winner = replacements[results.findIndex(({ ok }) => ok)];
    expect((await first.readRouteLock(scope))?.document).toEqual(winner);
    const file = join(root, ".gwrk", "models", "route-lock.local.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(winner);
  });

  it("keeps the incumbent bytes when replacement evidence contains a credential", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    const incumbent = lock("2026-11-11T12:00:00.000Z");
    await store.writeRouteLockAtomic(scope, incumbent, null);
    const before = await store.readRouteLock(scope);
    if (!before) throw new Error("Missing fixture incumbent");
    const file = join(root, ".gwrk", "models", "route-lock.local.json");
    const bytes = await readFile(file);
    const invalid = {
      ...incumbent,
      updatedAt: "2026-11-11T12:03:00.000Z",
      note: "Authorization: Bearer fixture-secret",
    };

    await expect(
      store.writeRouteLockAtomic(scope, invalid, before.digest),
    ).rejects.toThrow(/secret material/i);
    expect(await readFile(file)).toEqual(bytes);
    expect(await store.readRouteLock(scope)).toEqual(before);
  });
});
