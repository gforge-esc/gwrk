/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  });

  it("keeps unconfigured reads free of filesystem mutation", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    expect(await store.readRouteLock(scope)).toBeNull();
    expect(await store.readDiscoverySnapshot(scope)).toBeNull();
    await expect(stat(join(root, ".gwrk"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(stat(join(root, ".runs"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("preserves immutable evaluation evidence and rejects unsafe identifiers", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    await store.writeEvaluationBundle("evaluation-1", { result: "passed" });
    await expect(
      store.writeEvaluationBundle("evaluation-1", { result: "changed" }),
    ).rejects.toThrow();
    expect(await store.readEvaluationBundle("evaluation-1")).toEqual({
      result: "passed",
    });
    await expect(
      store.writeEvaluationBundle("../outside", {}),
    ).rejects.toThrow();
    await expect(
      store.writeRouteLockAtomic(
        { ...scope, runnerProfile: "../outside" },
        {
          document: lock("2026-11-11T12:00:00Z"),
          expectedIncumbentDigest: null,
        },
      ),
    ).rejects.toThrow();
  });

  it("keeps discovery and locks in their requested workspace scope", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    const snapshot = { scope, adapters: [] };
    await store.writeDiscoverySnapshot(scope, snapshot);
    expect(await store.readDiscoverySnapshot(scope)).toEqual(snapshot);
    await expect(
      store.readDiscoverySnapshot({ ...scope, arch: "arm64" }),
    ).rejects.toThrow("runner-mismatch");
    await store.writeRouteLockAtomic(scope, {
      document: lock("2026-11-11T12:00:00Z"),
      expectedIncumbentDigest: null,
    });
    await expect(
      store.readRouteLock({ ...scope, workspaceId: "other" }),
    ).rejects.toThrow("runner-mismatch");
  });

  it("restores the prior validated lock under compare-and-set", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    const original = lock("2026-11-11T12:00:00Z");
    const initial = await store.writeRouteLockAtomic(scope, {
      document: original,
      expectedIncumbentDigest: null,
    });
    const replacement = {
      ...lock("2026-11-11T12:01:00Z"),
      previousLock: original,
    };
    const changed = await store.writeRouteLockAtomic(scope, {
      document: replacement,
      expectedIncumbentDigest: initial,
    });
    await store.writeRouteLockAtomic(scope, {
      document: original,
      expectedIncumbentDigest: changed,
    });
    expect(await store.readRouteLock(scope)).toEqual({
      digest: initial,
      document: original,
    });
  });

  it("rejects known opaque secrets and linked storage directories", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    vi.stubEnv("GWRK_QUALIFICATION_TEST_SECRET", "opaque-qualification-value");
    await expect(
      store.writeEvaluationBundle("secret-case", {
        note: "opaque-qualification-value",
      }),
    ).rejects.toThrow(/secret material/i);
    await mkdir(join(root, "outside"));
    await symlink(join(root, "outside"), join(root, ".gwrk"), "dir");
    await expect(
      store.writeRouteLockAtomic(scope, {
        document: lock("2026-11-11T12:00:00Z"),
        expectedIncumbentDigest: null,
      }),
    ).rejects.toThrow(/storage directory/);
    await expect(stat(join(root, "outside/models"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it(
    "serializes two processes even when one pauses immediately before rename",
    { timeout: 15000 },
    async () => {
      const { createRouteLockStore } = await import("./route-lock-store.js");
      const store = createRouteLockStore(root);
      const original = lock("2026-11-11T12:00:00Z");
      const digest = await store.writeRouteLockAtomic(scope, {
        document: original,
        expectedIncumbentDigest: null,
      });
      const script = `import fs from "node:fs";
import {syncBuiltinESMExports} from "node:module";
const [modulePath, root, scopeJson, requestJson, hold] = process.argv.slice(1);
if (hold === "yes") {const rename = fs.renameSync; fs.renameSync = (...args) => {if (String(args[1]).endsWith("route-lock.local.json")) {process.stdout.write("HOLD\\n"); fs.readSync(0, Buffer.alloc(1), 0, 1, null);} return rename(...args);}; syncBuiltinESMExports();}
const {createRouteLockStore} = await import(modulePath);
process.stdout.write("ATTEMPT\\n");
try {await createRouteLockStore(root).writeRouteLockAtomic(JSON.parse(scopeJson), JSON.parse(requestJson)); console.log(JSON.stringify({ok:true}));}
catch(error) {console.log(JSON.stringify({ok:false, message:error.message}));}`;
      const children: ReturnType<typeof spawn>[] = [];
      const start = (hold: boolean, minute: string) => {
        const request = {
          document: {
            ...lock(`2026-11-11T12:${minute}:00Z`),
            previousLock: original,
          },
          expectedIncumbentDigest: digest,
        };
        const child = spawn(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            script,
            pathToFileURL(resolve("dist/adapters/models/route-lock-store.js"))
              .href,
            root,
            JSON.stringify(scope),
            JSON.stringify(request),
            hold ? "yes" : "no",
          ],
          { stdio: ["pipe", "pipe", "pipe"] },
        );
        children.push(child);
        let output = "";
        let errors = "";
        child.stdout?.on("data", (data) => {
          output += String(data);
        });
        child.stderr?.on("data", (data) => {
          errors += String(data);
        });
        const done = new Promise<string>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code) =>
            code === 0 ? resolve(output) : reject(new Error(errors)),
          );
        });
        const waitFor = async (marker: string) => {
          const deadline = Date.now() + 5000;
          while (!output.includes(marker)) {
            if (Date.now() > deadline || child.exitCode !== null)
              throw new Error(`Child did not reach ${marker}: ${errors}`);
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        };
        return { child, done, waitFor };
      };
      try {
        const first = start(true, "01");
        await first.waitFor("HOLD");
        const second = start(false, "02");
        await second.waitFor("ATTEMPT");
        await new Promise((resolve) => setTimeout(resolve, 100));
        first.child.stdin?.write("release\n");
        const results = (await Promise.all([first.done, second.done])).map(
          (output) => JSON.parse(output.trim().split("\n").at(-1) ?? "{}"),
        );
        expect(results.filter((result) => result.ok)).toHaveLength(1);
        expect(results.find((result) => !result.ok)?.message).toContain(
          "incumbent-changed",
        );
        expect((await store.readRouteLock(scope))?.document).toMatchObject({
          updatedAt: "2026-11-11T12:01:00Z",
        });
      } finally {
        for (const child of children) {
          child.stdin?.end();
          if (child.exitCode === null) child.kill();
        }
      }
    },
  );

  it("accepts only one replacement against the same incumbent digest", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const first = createRouteLockStore(root);
    const second = createRouteLockStore(root);
    const incumbent = lock("2026-11-11T12:00:00.000Z");
    expect(await first.readRouteLock(scope)).toBeNull();
    expect(
      await first.writeRouteLockAtomic(scope, {
        document: incumbent,
        expectedIncumbentDigest: null,
      }),
    ).toEqual(expect.any(String));
    const current = await second.readRouteLock(scope);
    expect(current?.document).toEqual(incumbent);
    if (!current) throw new Error("Missing fixture incumbent");

    const replacements = [
      { ...lock("2026-11-11T12:01:00.000Z"), previousLock: incumbent },
      { ...lock("2026-11-11T12:02:00.000Z"), previousLock: incumbent },
    ];
    const results = await Promise.allSettled(
      [first, second].map((store, index) =>
        store.writeRouteLockAtomic(scope, {
          document: replacements[index],
          expectedIncumbentDigest: current.digest,
        }),
      ),
    );
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    const loser = results.find(({ status }) => status === "rejected");
    expect(loser?.reason).toMatchObject({
      message: expect.stringContaining("incumbent-changed"),
    });
    const winner =
      replacements[results.findIndex(({ status }) => status === "fulfilled")];
    expect((await first.readRouteLock(scope))?.document).toEqual(winner);
    const file = join(root, ".gwrk", "models", "route-lock.local.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual(winner);
  });

  it("keeps the incumbent bytes when replacement evidence contains a credential", async () => {
    const { createRouteLockStore } = await import("./route-lock-store.js");
    const store = createRouteLockStore(root);
    const incumbent = lock("2026-11-11T12:00:00.000Z");
    await store.writeRouteLockAtomic(scope, {
      document: incumbent,
      expectedIncumbentDigest: null,
    });
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
      store.writeRouteLockAtomic(scope, {
        document: invalid,
        expectedIncumbentDigest: before.digest,
      }),
    ).rejects.toThrow(/secret material/i);
    expect(await readFile(file)).toEqual(bytes);
    expect(await store.readRouteLock(scope)).toEqual(before);
  });
});
