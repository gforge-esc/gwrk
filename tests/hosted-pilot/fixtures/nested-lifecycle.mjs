import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { RESOURCE_LIMITS, ownedRuntimePlan } from "./runtime-policy.mjs";

function rootDirectory(path) {
  const metadata = lstatSync(path);
  assert.equal(metadata.isDirectory(), true, "fixture directory is missing");
  assert.equal(
    metadata.isSymbolicLink(),
    false,
    "fixture directory is a symlink",
  );
  assert.equal(metadata.uid, 0, "fixture directory owner differs");
  assert.equal(metadata.gid, 0, "fixture directory group differs");
  assert.equal(metadata.mode & 0o777, 0o700, "fixture directory mode differs");
  assert.equal(realpathSync(path), path, "fixture directory is not canonical");
  return { device: metadata.dev, inode: metadata.ino };
}

// No effect runs until the coordinator's measured checkpoint passes. This lifecycle
// uses the approved host daemon only to create the owned offline nested fixture.
export async function withOwnedNestedDaemon({ runId, receipt, executeCases }) {
  assert.equal(process.platform, "linux");
  assert.equal(process.getuid(), 0);
  const root = `/opt/gwrk-verification/${runId}`;
  const inputDirectory = `${root}/input`;
  const dataDirectory = `/var/lib/gwrk/verification-fixtures/${runId}`;
  const plan = ownedRuntimePlan({
    runId,
    inputDirectory,
    dataDirectory,
    receipt,
  });
  rootDirectory(root);
  rootDirectory(inputDirectory);
  const parent = lstatSync("/var/lib/gwrk");
  assert.equal(parent.isDirectory(), true);
  assert.equal(parent.isSymbolicLink(), false);
  assert.equal(parent.uid, 997);
  assert.equal(parent.gid, 988);
  assert.equal(parent.mode & 0o777, 0o750);
  assert.equal(parent.dev, receipt.dataParentDevice);
  assert.equal(parent.ino, receipt.dataParentInode);
  assert.equal(realpathSync("/var/lib/gwrk"), "/var/lib/gwrk");
  rootDirectory("/var/lib/gwrk/verification-fixtures");
  const dataIdentity = rootDirectory(dataDirectory);
  assert.equal(
    readdirSync(dataDirectory).length,
    0,
    "owned data child must start empty",
  );
  assert.deepEqual(
    dataIdentity,
    receipt.dataChildIdentity,
    "preapproved data child identity differs",
  );
  const dockerConfig = `${root}/docker-config`;
  mkdirSync(dockerConfig, { mode: 0o700 });
  writeFileSync(`${dockerConfig}/config.json`, "{}\n", { mode: 0o600 });
  const env = {
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: "/root",
    LANG: "C",
    LC_ALL: "C",
    DOCKER_CONFIG: dockerConfig,
  };
  const docker = (args, options = {}) =>
    execFileSync(
      "/usr/bin/docker",
      ["--host", "unix:///var/run/docker.sock", ...args],
      {
        encoding: "utf8",
        env,
        timeout: 15_000,
        maxBuffer: 1048576,
        ...options,
      },
    );
  const spawnDocker = (args, timeout = 30_000) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/docker",
        ["--host", "unix:///var/run/docker.sock", ...args],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      const chunks = { stdout: [], stderr: [] };
      let bytes = 0;
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("owned Docker command deadline"));
      }, timeout);
      for (const stream of ["stdout", "stderr"])
        child[stream].on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 1048576) {
            child.kill("SIGTERM");
            clearTimeout(timer);
            reject(new Error("owned Docker output exceeds bound"));
          } else chunks[stream].push(chunk);
        });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        resolve({
          code,
          stdout: Buffer.concat(chunks.stdout).toString(),
          stderr: Buffer.concat(chunks.stderr).toString(),
        });
      });
    });
  const ownership = {
    runId,
    root,
    dataDirectory,
    dataIdentity,
    parentIdentity: { device: parent.dev, inode: parent.ino },
    container: plan.name,
    cleanup: plan.cleanup,
    destructiveCleanupScope: dataDirectory,
  };
  writeFileSync(
    `${root}/native-ownership.json`,
    JSON.stringify(ownership, null, 2),
    { mode: 0o600 },
  );
  let containerId;
  let stopWatchdog = false;
  let watchdogError;
  let watchdog;
  const started = Date.now();
  try {
    const image = JSON.parse(
      docker([
        "image",
        "inspect",
        "--format",
        "{{json .}}",
        receipt.outerImage,
      ]),
    );
    assert.equal(
      image.Id,
      receipt.daemonImageId,
      "daemon image config ID differs from checkpoint",
    );
    assert.equal(image.Architecture, "amd64");
    containerId = docker(plan.command).trim();
    assert.match(containerId, /^[a-f0-9]{64}$/);
    const deadline = Date.now() + RESOURCE_LIMITS.startupSeconds * 1000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const info = JSON.parse(
          docker([
            "exec",
            containerId,
            "docker",
            "--host",
            "unix:///var/run/docker.sock",
            "info",
            "--format",
            "{{json .}}",
          ]),
        );
        assert.equal(info.Driver, "vfs");
        assert.equal(info.Architecture, "x86_64");
        ready = true;
        break;
      } catch {
        await sleep(500);
      }
    }
    assert.equal(ready, true, "nested daemon readiness deadline");
    watchdog = (async () => {
      while (!stopWatchdog) {
        try {
          const bytes = Number(
            docker(["exec", containerId, "du", "-sb", "/var/lib/docker"]).split(
              /\s/,
            )[0],
          );
          assert.ok(
            Number.isSafeInteger(bytes) && bytes < RESOURCE_LIMITS.dataBytes,
            "nested data watchdog exceeded",
          );
          assert.ok(
            Date.now() - started <
              (RESOURCE_LIMITS.startupSeconds + RESOURCE_LIMITS.suiteSeconds) *
                1000,
            "nested suite deadline",
          );
        } catch (error) {
          watchdogError = error;
          try {
            docker(["kill", containerId], { stdio: "ignore" });
          } catch {}
          return;
        }
        await sleep(1000);
      }
    })();
    await executeCases({ containerId, docker, spawnDocker, inputDirectory });
    if (watchdogError) throw watchdogError;
  } finally {
    stopWatchdog = true;
    if (watchdog) await watchdog;
    let metadata;
    try {
      metadata = JSON.parse(
        docker(["inspect", "--format", "{{json .}}", plan.name]),
      );
    } catch {
      assert.equal(
        containerId,
        undefined,
        "cannot verify the owned outer container before cleanup",
      );
    }
    if (metadata) {
      assert.equal(metadata.Config.Labels["gwrk.fixture.run"], runId);
      containerId = metadata.Id;
      docker(["rm", "--force", containerId], {
        timeout: RESOURCE_LIMITS.cleanupSeconds * 1000,
        stdio: "ignore",
      });
    }
    const actual = rootDirectory(dataDirectory);
    assert.deepEqual(
      actual,
      dataIdentity,
      "owned data identity changed before cleanup",
    );
    const actualParent = statSync("/var/lib/gwrk");
    assert.equal(actualParent.dev, parent.dev);
    assert.equal(actualParent.ino, parent.ino);
    rmSync(dataDirectory, { recursive: true });
    writeFileSync(
      `${root}/native-cleanup.json`,
      JSON.stringify({
        runId,
        removedContainer: containerId ?? null,
        removedDataDirectory: dataDirectory,
        parentUntouched: true,
        noSharedPrune: true,
      }),
      { mode: 0o600 },
    );
  }
}
