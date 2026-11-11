/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { acquireInstanceLock } from "../../src/adapters/server/instance-lock.js";

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
});
