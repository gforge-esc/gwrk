/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { acquireInstanceLock } from "../../src/adapters/server/instance-lock.js";
import { closeDb, getDb } from "../../src/db/index.js";
import { startServer } from "../../src/server/index.js";
import { GwrkConfigSchema } from "../../src/utils/config.js";

describe.skipIf(process.platform !== "linux")("Linux instance lock", () => {
  it("blocks an independent process and recovers after SIGKILL without replacing the inode", async () => {
    const runtimeDir = await mkdtemp(join(tmpdir(), "gwrk-runtime-test-"));
    const moduleUrl = pathToFileURL(
      resolve("dist/adapters/server/instance-lock.js"),
    ).href;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'const { acquireInstanceLock } = await import(process.argv[1]); acquireInstanceLock(process.argv[2], process.pid); console.log("locked"); setInterval(() => {}, 1000);',
        moduleUrl,
        runtimeDir,
      ],
      { stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = once(child, "exit");

    try {
      const ready = await Promise.race([
        once(child.stdout, "data").then(([data]) => String(data).trim()),
        exited.then(([code]) => `exited ${code}`),
      ]);
      expect(ready).toBe("locked");
      const lockPath = join(runtimeDir, "server.lock");
      const { ino } = await stat(lockPath);
      expect(await readFile(lockPath, "utf8")).toBe(`${child.pid}\n`);
      expect(() => acquireInstanceLock(runtimeDir, process.pid)).toThrow(
        /already holds/,
      );
      expect(await readFile(lockPath, "utf8")).toBe(`${child.pid}\n`);

      child.kill("SIGKILL");
      await exited;

      const successor = acquireInstanceLock(runtimeDir, process.pid);
      try {
        expect(successor.pid).toBe(process.pid);
        expect((await stat(lockPath)).ino).toBe(ino);
        expect(await readFile(lockPath, "utf8")).toBe(`${process.pid}\n`);
      } finally {
        successor.release();
        successor.release();
      }
      acquireInstanceLock(runtimeDir, process.pid).release();
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await exited;
      }
      await rm(runtimeDir, { recursive: true, force: true });
    }
  });

  it("guards actual server startup and reopens the same isolated ledger after close", async () => {
    const root = await mkdtemp(join(tmpdir(), "gwrk-server-test-"));
    const runtime = join(root, "runtime");
    const state = join(root, "state");
    vi.stubEnv("GWRK_RUNTIME_DIR", runtime);
    vi.stubEnv("GWRK_HOME", state);
    for (const key of [
      "GWRK_DIR",
      "GWRK_DB_PATH",
      "SLACK_BOT_TOKEN",
      "SLACK_APP_TOKEN",
      "TELEGRAM_BOT_TOKEN",
      "TELEGRAM_CHAT_ID",
    ]) {
      vi.stubEnv(key, undefined);
    }
    const config = GwrkConfigSchema.parse({
      project: { name: "linux-test" },
      server: { host: "127.0.0.1", port: 0 },
    });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    try {
      server = await startServer(config, { handleSignals: false });
      expect(await readFile(join(runtime, "server.pid"), "utf8")).toBe(
        String(process.pid),
      );
      await expect(
        startServer(config, { handleSignals: false }),
      ).rejects.toThrow(/already holds/);

      const db = getDb();
      db.exec("CREATE TABLE recovery_fixture (marker TEXT NOT NULL)");
      db.prepare("INSERT INTO recovery_fixture VALUES (?)").run("persisted");
      await server.close();
      server = undefined;
      await expect(stat(join(runtime, "server.pid"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      closeDb();
      expect((await stat(join(state, "gwrk.db"))).isFile()).toBe(true);

      server = await startServer(config, { handleSignals: false });
      expect(
        getDb().prepare("SELECT marker FROM recovery_fixture").get(),
      ).toEqual({ marker: "persisted" });
      expect((await server.inject("/health")).statusCode).toBe(200);
    } finally {
      await server?.close();
      closeDb();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
  });
});
