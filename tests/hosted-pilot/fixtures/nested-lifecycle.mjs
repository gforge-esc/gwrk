import assert from "node:assert/strict";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { classifyDockerFailure } from "./docker-diagnostics.mjs";
import {
  FixtureProcessError,
  runOwnedProcessScope,
  startBoundedProcess,
} from "./process-scope.mjs";
import { RESOURCE_LIMITS, ownedRuntimePlan } from "./runtime-policy.mjs";

function rootDirectory(
  path,
  files = { lstatSync, realpathSync },
  modes = [0o700],
) {
  const metadata = files.lstatSync(path);
  assert.equal(metadata.isDirectory(), true, "fixture directory is missing");
  assert.equal(
    metadata.isSymbolicLink(),
    false,
    "fixture directory is a symlink",
  );
  assert.equal(metadata.uid, 0, "fixture directory owner differs");
  assert.equal(metadata.gid, 0, "fixture directory group differs");
  assert.ok(
    modes.includes(metadata.mode & 0o777),
    "fixture directory mode differs",
  );
  assert.equal(
    files.realpathSync(path),
    path,
    "fixture directory is not canonical",
  );
  return { device: metadata.dev, inode: metadata.ino };
}

// No effect runs until the coordinator's measured checkpoint passes. This lifecycle
// uses the approved host daemon only to create the owned offline nested fixture.
export async function withOwnedNestedDaemon(
  { runId, receipt, executeCases },
  effects = {},
) {
  const files = effects.files ?? {
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    readlinkSync,
    realpathSync,
    rmSync,
    writeFileSync,
  };
  const {
    lstatSync: inspectPath,
    mkdirSync: createDirectory,
    readdirSync: listDirectory,
    readFileSync: readMetadataFile,
    readlinkSync: readNamespaceLink,
    realpathSync: canonicalPath,
    rmSync: removeDirectory,
    writeFileSync: writeFile,
  } = files;
  assert.equal(effects.platform ?? process.platform, "linux");
  assert.equal(effects.uid ?? process.getuid(), 0);
  const root = `/opt/gwrk-verification/${runId}`;
  const inputDirectory = `${root}/input`;
  const dataDirectory = `/var/lib/gwrk/verification-fixtures/${runId}`;
  const plan = ownedRuntimePlan({
    runId,
    inputDirectory,
    dataDirectory,
    receipt,
  });
  rootDirectory(root, files);
  rootDirectory(inputDirectory, files);
  const parent = inspectPath("/var/lib/gwrk");
  assert.equal(parent.isDirectory(), true);
  assert.equal(parent.isSymbolicLink(), false);
  assert.equal(parent.uid, 997);
  assert.equal(parent.gid, 988);
  assert.equal(parent.mode & 0o777, 0o750);
  assert.equal(parent.dev, receipt.dataParentDevice);
  assert.equal(parent.ino, receipt.dataParentInode);
  assert.equal(canonicalPath("/var/lib/gwrk"), "/var/lib/gwrk");
  const namespaceIdentity = rootDirectory(
    "/var/lib/gwrk/verification-fixtures",
    files,
  );
  const dataIdentity = rootDirectory(dataDirectory, files);
  assert.equal(
    listDirectory(dataDirectory).length,
    0,
    "owned data child must start empty",
  );
  assert.deepEqual(
    dataIdentity,
    receipt.dataChildIdentity,
    "preapproved data child identity differs",
  );
  const dockerConfig = `${root}/docker-config`;
  createDirectory(dockerConfig, { mode: 0o700 });
  writeFile(`${dockerConfig}/config.json`, "{}\n", { mode: 0o600 });
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
  writeFile(
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
      const spawnDocker = (args, timeout = 15_000) => {
        if (signal.aborted)
          return Promise.reject(new FixtureProcessError("cancelled", true));
        return effects.command
          ? effects.command(args, { signal, timeoutMs: timeout, spawnProcess })
          : spawnProcess(
              "/usr/bin/docker",
              ["--host", "unix:///var/run/docker.sock", ...args],
              { env, timeoutMs: timeout },
            );
      };
      const docker = async (args, timeout = 15_000) => {
        const result = await spawnDocker(args, timeout);
        if (result.code !== 0) {
          writeFile(
            `${root}/docker-command-failure.json`,
            JSON.stringify(classifyDockerFailure(args[0], result)),
            { mode: 0o600 },
          );
        }
        assert.equal(result.code, 0, "owned Docker command failed");
        return result.stdout;
      };
      // Cleanup uses a separate bounded process after this scope's signal is aborted.
      dockerForCleanup = async (args) => {
        if (effects.command) {
          const result = await effects.command(args, { cleanup: true });
          assert.equal(result.code, 0);
          return result.stdout;
        }
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
      writeFile(
        `${root}/native-ownership.json`,
        JSON.stringify({ ...ownership, containerId }, null, 2),
        { mode: 0o600 },
      );
      await docker(["start", containerId]);
      const running = JSON.parse(
        await docker(["inspect", "--format", "{{json .}}", containerId]),
      );
      assert.equal(running.HostConfig.PidMode, "");
      assert.equal(running.HostConfig.IpcMode, "private");
      assert.ok(
        Number.isSafeInteger(running.State.Pid) && running.State.Pid > 0,
      );
      const hostPidNamespace = readNamespaceLink("/proc/self/ns/pid");
      const outerPidNamespace = readNamespaceLink(
        `/proc/${running.State.Pid}/ns/pid`,
      );
      assert.notEqual(
        outerPidNamespace,
        hostPidNamespace,
        "outer PID namespace is shared with the host",
      );
      const actualNamespace = (
        await docker(["exec", containerId, "readlink", "/proc/self/ns/pid"])
      ).trim();
      assert.equal(actualNamespace, outerPidNamespace);
      writeFile(
        `${root}/namespace-proof.json`,
        JSON.stringify({
          pidMode: running.HostConfig.PidMode,
          ipcMode: running.HostConfig.IpcMode,
          hostPidNamespace,
          outerPidNamespace,
          actualNamespace,
          isolated: true,
        }),
        { mode: 0o600 },
      );
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
      const cleanup = {
        runId,
        removedContainer: containerId ?? null,
        removedDataDirectory: null,
        interrupted: interrupted ?? null,
        childrenDrained,
        parentUntouched: false,
        noSharedPrune: true,
        cleanupComplete: false,
        retainedDataDirectory: dataDirectory,
        stage: "child_identity",
      };
      try {
        // Docker legitimately adds root-group traversal to its data root. This
        // allowance applies only after shutdown, never to initial or auth paths.
        const actual = rootDirectory(dataDirectory, files, [0o700, 0o710]);
        assert.deepEqual(
          actual,
          dataIdentity,
          "owned data identity changed before cleanup",
        );
        cleanup.observedDataMode = `0o${(inspectPath(dataDirectory).mode & 0o777).toString(8)}`;
        cleanup.stage = "parent_identity";
        const actualParent = inspectPath("/var/lib/gwrk");
        assert.equal(actualParent.isDirectory(), true);
        assert.equal(actualParent.isSymbolicLink(), false);
        assert.equal(actualParent.uid, parent.uid);
        assert.equal(actualParent.gid, parent.gid);
        assert.equal(actualParent.mode & 0o777, parent.mode & 0o777);
        assert.equal(actualParent.dev, parent.dev);
        assert.equal(actualParent.ino, parent.ino);
        assert.deepEqual(
          rootDirectory("/var/lib/gwrk/verification-fixtures", files),
          namespaceIdentity,
        );
        cleanup.parentUntouched = true;
        cleanup.stage = "mount_check";
        const mountTargets = readMetadataFile("/proc/self/mountinfo", "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) =>
            line
              .split(" ")[4]
              .replace(/\\([0-7]{3})/g, (_, octal) =>
                String.fromCharCode(Number.parseInt(octal, 8)),
              ),
          );
        assert.equal(
          mountTargets.some(
            (target) =>
              target === dataDirectory ||
              target.startsWith(`${dataDirectory}/`),
          ),
          false,
          "host mount remains under owned data child",
        );
        cleanup.hostMountsUnderChild = false;
        assert.equal(
          childrenDrained,
          true,
          "owned command closure unconfirmed; data preserved",
        );
        cleanup.stage = "remove_data";
        removeDirectory(dataDirectory, { recursive: true });
        cleanup.removedDataDirectory = dataDirectory;
        cleanup.retainedDataDirectory = null;
        cleanup.cleanupComplete = true;
        cleanup.stage = "complete";
      } finally {
        writeFile(`${root}/native-cleanup.json`, JSON.stringify(cleanup), {
          mode: 0o600,
        });
      }
    },
    { processTarget: effects.processTarget ?? process },
  );
}
