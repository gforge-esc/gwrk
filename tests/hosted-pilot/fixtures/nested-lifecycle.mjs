import assert from "node:assert/strict";
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
  let watchdog;
  let watchdogError;
  let dockerForCleanup;
  const started = Date.now();
  return runOwnedProcessScope(
    async ({ signal, spawnProcess, untilCancelled }) => {
      const spawnDocker = (args, timeout = 15_000) =>
        spawnProcess(
          "/usr/bin/docker",
          ["--host", "unix:///var/run/docker.sock", ...args],
          { env, timeoutMs: timeout },
        );
      const docker = async (args, timeout = 15_000) => {
        const result = await spawnDocker(args, timeout);
        assert.equal(result.code, 0, "owned Docker command failed");
        return result.stdout;
      };
      // Cleanup uses a separate bounded process after this scope's signal is aborted.
      dockerForCleanup = async (args) => {
        const { startBoundedProcess } = await import("./process-scope.mjs");
        const handle = startBoundedProcess(
          "/usr/bin/docker",
          ["--host", "unix:///var/run/docker.sock", ...args],
          { env, timeoutMs: 15_000 },
        );
        const result = await handle.completion;
        assert.equal(result.code, 0, "owned Docker cleanup command failed");
        return result.stdout;
      };
      const image = JSON.parse(
        await docker([
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
      containerId = (await docker(plan.command)).trim();
      assert.match(containerId, /^[a-f0-9]{64}$/);
      const deadline = Date.now() + RESOURCE_LIMITS.startupSeconds * 1000;
      let ready = false;
      while (Date.now() < deadline && !signal.aborted) {
        try {
          const info = JSON.parse(
            await docker([
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
          await untilCancelled(sleep(500));
        }
      }
      assert.equal(ready, true, "nested daemon readiness deadline");
      watchdog = (async () => {
        while (!signal.aborted) {
          try {
            const bytes = Number(
              (
                await docker([
                  "exec",
                  containerId,
                  "du",
                  "-sb",
                  "/var/lib/docker",
                ])
              ).split(/\s/)[0],
            );
            assert.ok(
              Number.isSafeInteger(bytes) && bytes < RESOURCE_LIMITS.dataBytes,
              "nested data watchdog exceeded",
            );
            assert.ok(
              Date.now() - started <
                (RESOURCE_LIMITS.startupSeconds +
                  RESOURCE_LIMITS.suiteSeconds) *
                  1000,
              "nested suite deadline",
            );
            await untilCancelled(sleep(1000));
          } catch (error) {
            if (!signal.aborted) {
              watchdogError = error;
              throw error;
            }
            return;
          }
        }
      })();
      // Race command completion, cancellation and the live resource watchdog.
      await untilCancelled(
        Promise.race([
          executeCases({
            containerId,
            docker,
            spawnDocker,
            inputDirectory,
            signal,
          }),
          watchdog,
        ]),
      );
      if (watchdogError) throw watchdogError;
    },
    async ({ childrenDrained, interrupted }) => {
      if (watchdog) await watchdog.catch(() => {});
      let metadata;
      try {
        metadata = JSON.parse(
          await dockerForCleanup([
            "inspect",
            "--format",
            "{{json .}}",
            plan.name,
          ]),
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
        await dockerForCleanup(["rm", "--force", containerId]);
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
      if (childrenDrained) rmSync(dataDirectory, { recursive: true });
      writeFileSync(
        `${root}/native-cleanup.json`,
        JSON.stringify({
          runId,
          removedContainer: containerId ?? null,
          removedDataDirectory: childrenDrained ? dataDirectory : null,
          retainedDataForUnconfirmedChildDrain: !childrenDrained,
          interrupted: interrupted ?? null,
          childrenDrained,
          parentUntouched: true,
          noSharedPrune: true,
        }),
        { mode: 0o600 },
      );
      assert.equal(
        childrenDrained,
        true,
        "owned command closure unconfirmed; data preserved",
      );
    },
  );
}
