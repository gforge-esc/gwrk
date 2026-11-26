import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
const moduleUrl =
  process.env.GWRK_051_PROCESS_SCOPE_PROBE_MODULE ??
  new URL("./process-scope.mjs", import.meta.url).href;
const { startBoundedProcess } = await import(moduleUrl);

const live = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("timeout escalates TERM to KILL and waits for a TERM-ignoring process to close", async () => {
  let ready;
  const entered = new Promise((resolve) => {
    ready = resolve;
  });
  const handle = startBoundedProcess(
    process.execPath,
    [
      "-e",
      'process.on("SIGTERM",()=>{});process.stdout.write("READY");setInterval(()=>{},1000)',
    ],
    {
      timeoutMs: 500,
      termGraceMs: 50,
      killGraceMs: 500,
      onSpawn: (child) => child.stdout.once("data", ready),
    },
  );
  handle.completion.catch(() => {});
  try {
    let readyTimer;
    try {
      await Promise.race([
        entered,
        new Promise((_, reject) => {
          readyTimer = setTimeout(
            () => reject(new Error("timeout fixture readiness deadline")),
            1000,
          );
        }),
      ]);
    } finally {
      clearTimeout(readyTimer);
    }
    await assert.rejects(handle.completion);
    assert.equal(handle.isClosed(), true);
    assert.equal(live(handle.pid), false);
  } finally {
    if (live(handle.pid)) process.kill(handle.pid, "SIGKILL");
  }
});

for (const signal of ["SIGTERM", "SIGINT"])
  test(`${signal} drains the active child before owned cleanup`, async () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "gwrk-051-signal-"));
    const marker = path.join(directory, "cleanup.json");
    const program = `
    import {writeFileSync} from 'node:fs';
    import {runOwnedProcessScope} from ${JSON.stringify(moduleUrl)};
    try {
      await runOwnedProcessScope(async ({spawnProcess}) => {
        await spawnProcess(process.execPath,['-e','process.on("SIGTERM",()=>{});process.stdout.write("READY");setInterval(()=>{},1000)'],
          {timeoutMs:5000,onSpawn(child){child.stdout.once('data',()=>process.stdout.write('READY '+child.pid+'\\n'));}});
      },async ({childrenDrained,interrupted})=>writeFileSync(${JSON.stringify(marker)},JSON.stringify({childrenDrained,interrupted})),{termGraceMs:50,killGraceMs:500});
    } catch {process.exitCode=1;}
  `;
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", program],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let grandchild;
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("signal fixture readiness deadline")),
          3000,
        );
        child.stdout.once("data", (chunk) => {
          grandchild = Number(chunk.toString().trim().split(" ")[1]);
          clearTimeout(timer);
          resolve();
        });
        child.once("error", reject);
      });
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill(signal);
      await Promise.race([
        closed,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("signal cleanup deadline")),
            3000,
          );
        }),
      ]);
      clearTimeout(timer);
      assert.equal(existsSync(marker), true);
      assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
        childrenDrained: true,
        interrupted: signal,
      });
      assert.equal(live(grandchild), false);
    } finally {
      clearTimeout(timer);
      child.kill("SIGKILL");
      if (grandchild && live(grandchild)) process.kill(grandchild, "SIGKILL");
      rmSync(directory, { recursive: true, force: true });
    }
  });
