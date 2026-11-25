import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import {
  WATCHDOG_POLICY,
  classifyDockerFailure,
  classifyWatchdogMeasurement,
  digestText,
} from "./docker-diagnostics.mjs";
import {
  FixtureProcessError,
  runOwnedProcessScope,
  startBoundedProcess,
} from "./process-scope.mjs";
import { RESOURCE_LIMITS, ownedRuntimePlan } from "./runtime-policy.mjs";

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

export class FixtureLifecycleError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "FixtureLifecycleError";
    this.isFixtureLifecycleError = true;
    this.stage = details.stage;
    this.category = details.category ?? "generic_construction_failed";
    this.detail =
      details.detail ??
      "Native fixture lifecycle failed without a recognized safe diagnostic";
    this.operation = details.operation;
    this.exitCode = Number.isInteger(details.exitCode) ? details.exitCode : 1;
    this.stdoutBytes = Number.isSafeInteger(details.stdoutBytes)
      ? details.stdoutBytes
      : 0;
    this.stderrBytes = Number.isSafeInteger(details.stderrBytes)
      ? details.stderrBytes
      : 0;
    this.stdoutSha256 = details.stdoutSha256 ?? EMPTY_SHA256;
    this.stderrSha256 = details.stderrSha256 ?? EMPTY_SHA256;
    if (details.errorCode !== undefined) {
      this.errorCode = details.errorCode;
    }
    if (details.watchdog !== undefined) {
      this.watchdog = details.watchdog;
    }
  }
}

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

function writeWatchdogFailureReceipt(root, writeFile, measurement, category) {
  writeFile(
    `${root}/docker-command-failure.json`,
    JSON.stringify({
      operation: "other",
      exitCode: measurement.exitCode,
      category: category ?? measurement.category,
      detail:
        category === "watchdog_transient_exhausted"
          ? "Resource watchdog vanished-entry race persisted beyond bounded retry budget"
          : measurement.detail,
      stderrBytes: measurement.stderrBytes,
      stderrSha256: measurement.stderrSha256,
    }),
    { mode: 0o600 },
  );
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
  const now = effects.now ?? Date.now;
  const wait = effects.sleep ?? sleep;
  const watchdogPolicy = {
    ...WATCHDOG_POLICY,
    ...(effects.watchdog ?? {}),
  };
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
  let casesPromise;
  let watchdogError;
  let dockerForCleanup;
  let currentStage = "outer_lifecycle";
  const started = now();
  return runOwnedProcessScope(
    async ({ signal, spawnProcess, untilCancelled }) => {
      const spawnDocker = (args, timeout = 15_000) => {
        if (signal.aborted)
          return Promise.reject(new FixtureProcessError("cancelled", true));
        if (effects.command) {
          let pending;
          try {
            pending = effects.command(args, {
              signal,
              timeoutMs: timeout,
              spawnProcess,
            });
          } catch (error) {
            return Promise.reject(error);
          }
          return untilCancelled(pending);
        }
        return spawnProcess(
          "/usr/bin/docker",
          ["--host", "unix:///var/run/docker.sock", ...args],
          { env, timeoutMs: timeout },
        );
      };
      const docker = async (args, timeout = 15_000) => {
        const result = await spawnDocker(args, timeout);
        if (signal.aborted) {
          throw new FixtureProcessError("cancelled", true);
        }
        if (result.code !== 0) {
          const diagnostic = classifyDockerFailure(args[0], result);
          const stdoutDigest = digestText(result.stdout);
          writeFile(
            `${root}/docker-command-failure.json`,
            JSON.stringify(diagnostic),
            { mode: 0o600 },
          );
          throw new FixtureLifecycleError("owned Docker command failed", {
            stage: currentStage,
            category: diagnostic.category,
            detail: diagnostic.detail,
            operation:
              diagnostic.operation === "create"
                ? "docker_create"
                : "docker_other",
            exitCode: diagnostic.exitCode ?? 1,
            stdoutBytes: stdoutDigest.bytes,
            stderrBytes: diagnostic.stderrBytes,
            stdoutSha256: stdoutDigest.sha256,
            stderrSha256: diagnostic.stderrSha256,
          });
        }
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
      try {
        currentStage = "outer_image_verify";
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
        currentStage = "outer_container_create";
        containerId = (await docker(plan.command)).trim();
        assert.match(containerId, /^[a-f0-9]{64}$/);
        writeFile(
          `${root}/native-ownership.json`,
          JSON.stringify({ ...ownership, containerId }, null, 2),
          { mode: 0o600 },
        );
        currentStage = "outer_container_start";
        await docker(["start", containerId]);
        const running = JSON.parse(
          await docker(["inspect", "--format", "{{json .}}", containerId]),
        );
        currentStage = "outer_namespace_verify";
        assert.equal(running.HostConfig.PidMode, "");
        assert.equal(running.HostConfig.IpcMode, "private");
        assert.equal(
          running.HostConfig?.NetworkMode,
          "none",
          "outer network mode must be 'none'",
        );
        assert.equal(
          running.Config?.Labels?.["gwrk.fixture.run"],
          runId,
          "container label gwrk.fixture.run must match runId",
        );
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

        const hostNetNamespace = readNamespaceLink("/proc/self/ns/net");
        const outerNetNamespace = readNamespaceLink(
          `/proc/${running.State.Pid}/ns/net`,
        );
        assert.ok(
          typeof hostNetNamespace === "string" &&
            /^net:\[[^\]]+\]$/.test(hostNetNamespace),
          "host network namespace is not a valid net:[inode] link",
        );
        assert.ok(
          typeof outerNetNamespace === "string" &&
            /^net:\[[^\]]+\]$/.test(outerNetNamespace),
          "outer network namespace is not a valid net:[inode] link",
        );
        assert.notEqual(
          outerNetNamespace,
          hostNetNamespace,
          "outer network namespace is shared with the host",
        );
        const actualNetNamespace = (
          await docker(["exec", containerId, "readlink", "/proc/self/ns/net"])
        ).trim();
        assert.equal(actualNetNamespace, outerNetNamespace);

        writeFile(
          `${root}/namespace-proof.json`,
          JSON.stringify({
            pidMode: running.HostConfig.PidMode,
            ipcMode: running.HostConfig.IpcMode,
            hostPidNamespace,
            outerPidNamespace,
            actualNamespace,
            hostNetNamespace,
            outerNetNamespace,
            actualNetNamespace,
            isolated: true,
          }),
          { mode: 0o600 },
        );
        currentStage = "outer_daemon_readiness";
        const deadline = now() + RESOURCE_LIMITS.startupSeconds * 1000;
        let ready = false;
        while (now() < deadline && !signal.aborted) {
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
            await untilCancelled(wait(500));
          }
        }
        if (!ready) {
          throw new FixtureLifecycleError("nested daemon readiness deadline", {
            stage: "outer_daemon_readiness",
            category: "outer_daemon_readiness_timeout",
            detail:
              "Nested Docker daemon did not become ready within startup deadline",
            operation: "nested_daemon_info_wait",
            exitCode: 1,
          });
        }
        currentStage = undefined;
      } catch (error) {
        if (error && typeof error === "object" && !error.fixtureStage) {
          error.fixtureStage = currentStage;
        }
        throw error;
      }

      const suiteDeadlineMs =
        (RESOURCE_LIMITS.startupSeconds + RESOURCE_LIMITS.suiteSeconds) * 1000;
      const suiteDeadlineAt = started + suiteDeadlineMs;
      const watchdogStartedAt = now();
      let lastValidSample = null;
      let lastTransientMeasurement = null;
      let consecutiveTransientTicks = 0;
      let transientRetries = 0;
      let transientRecoveries = 0;
      const watchdogSummary = () => ({
        transientRetries,
        transientRecoveries,
        consecutiveTransientTicks,
        hasValidSample: lastValidSample !== null,
      });
      const sampleDeadlineAt = () =>
        (lastValidSample ? lastValidSample.sampledAt : watchdogStartedAt) +
        watchdogPolicy.maxValidSampleAgeMs;
      const throwSuiteDeadlineError = () => {
        throw new FixtureLifecycleError("nested suite deadline", {
          stage: "resource_watchdog",
          category: "watchdog_suite_deadline_exceeded",
          detail:
            "Nested fixture exceeded the startup plus suite wall-clock deadline",
          operation: "resource_watchdog_deadline",
          exitCode: 1,
          watchdog: watchdogSummary(),
        });
      };
      const throwSampleBudgetExpiredError = (measurement) => {
        if (measurement) {
          writeWatchdogFailureReceipt(
            root,
            writeFile,
            measurement,
            "watchdog_transient_exhausted",
          );
          throw new FixtureLifecycleError(
            "owned Docker watchdog transient race persisted",
            {
              stage: "resource_watchdog",
              category: "watchdog_transient_exhausted",
              detail:
                "Resource watchdog vanished-entry race persisted beyond bounded retry budget",
              operation: "resource_watchdog_du",
              exitCode: measurement.exitCode ?? 1,
              stdoutBytes: measurement.stdoutBytes,
              stderrBytes: measurement.stderrBytes,
              stdoutSha256: measurement.stdoutSha256,
              stderrSha256: measurement.stderrSha256,
              watchdog: watchdogSummary(),
            },
          );
        }
        throw new FixtureLifecycleError(
          "owned Docker watchdog measurement timed out",
          {
            stage: "resource_watchdog",
            category: "watchdog_measurement_timeout",
            detail: "Resource watchdog measurement command timed out",
            operation: "resource_watchdog_du",
            exitCode: 1,
            errorCode: "timeout",
            watchdog: watchdogSummary(),
          },
        );
      };
      const computeRemainingBudget = () => {
        const currentTime = now();
        const suiteRemainingMs = suiteDeadlineAt - currentTime;
        if (suiteRemainingMs <= 0) {
          throwSuiteDeadlineError();
        }
        const sampleRemainingMs = sampleDeadlineAt() - currentTime;
        if (sampleRemainingMs <= 0) {
          throwSampleBudgetExpiredError(lastTransientMeasurement);
        }
        return { suiteRemainingMs, sampleRemainingMs };
      };
      const runBoundedMeasurement = async (attemptTimeoutMs, suiteLimited) => {
        if (signal.aborted) {
          throw new FixtureProcessError("cancelled", true);
        }
        let timer;
        const commandPromise = spawnDocker(
          ["exec", containerId, "du", "-sb", watchdogPolicy.watchedPath],
          attemptTimeoutMs,
        );
        commandPromise.catch(() => {});
        const deadlinePromise = new Promise((_, reject) => {
          timer = setTimeout(() => {
            if (signal.aborted) {
              reject(new FixtureProcessError("cancelled", true));
              return;
            }
            if (suiteLimited) {
              reject(
                new FixtureLifecycleError("nested suite deadline", {
                  stage: "resource_watchdog",
                  category: "watchdog_suite_deadline_exceeded",
                  detail:
                    "Nested fixture exceeded the startup plus suite wall-clock deadline",
                  operation: "resource_watchdog_deadline",
                  exitCode: 1,
                  watchdog: watchdogSummary(),
                }),
              );
              return;
            }
            reject(
              new FixtureLifecycleError(
                "owned Docker watchdog measurement timed out",
                {
                  stage: "resource_watchdog",
                  category: "watchdog_measurement_timeout",
                  detail: "Resource watchdog measurement command timed out",
                  operation: "resource_watchdog_du",
                  exitCode: 1,
                  errorCode: "timeout",
                  watchdog: watchdogSummary(),
                },
              ),
            );
          }, attemptTimeoutMs);
        });
        try {
          return await untilCancelled(
            Promise.race([commandPromise, deadlinePromise]),
          );
        } catch (error) {
          if (error?.code === "timeout" && suiteLimited) {
            throwSuiteDeadlineError();
          }
          throw error;
        } finally {
          clearTimeout(timer);
        }
      };

      watchdog = (async () => {
        while (!signal.aborted) {
          try {
            let measurement;
            for (
              let attempt = 0;
              attempt <= watchdogPolicy.maxTransientRetriesPerTick;
              attempt += 1
            ) {
              const budget = computeRemainingBudget();
              const attemptTimeoutMs = Math.min(
                watchdogPolicy.commandTimeoutMs,
                budget.suiteRemainingMs,
                budget.sampleRemainingMs,
              );
              if (attemptTimeoutMs <= 0) {
                throwSampleBudgetExpiredError(lastTransientMeasurement);
              }
              const suiteLimited =
                budget.suiteRemainingMs <= budget.sampleRemainingMs &&
                budget.suiteRemainingMs <= watchdogPolicy.commandTimeoutMs;
              const raw = await runBoundedMeasurement(
                attemptTimeoutMs,
                suiteLimited,
              );
              if (signal.aborted) {
                return;
              }
              measurement = classifyWatchdogMeasurement(raw, {
                watchedPath: watchdogPolicy.watchedPath,
                budgetBytes: RESOURCE_LIMITS.dataBytes,
              });
              if (measurement.ok) {
                const completedAt = now();
                if (completedAt >= suiteDeadlineAt) {
                  throwSuiteDeadlineError();
                }
                if (completedAt >= sampleDeadlineAt()) {
                  throwSampleBudgetExpiredError(lastTransientMeasurement);
                }
                if (attempt > 0 || consecutiveTransientTicks > 0) {
                  transientRecoveries += 1;
                }
                lastValidSample = {
                  bytes: measurement.bytes,
                  sampledAt: completedAt,
                };
                lastTransientMeasurement = null;
                consecutiveTransientTicks = 0;
                break;
              }
              if (!measurement.transient) {
                if (measurement.category !== "watchdog_data_budget_exceeded") {
                  writeWatchdogFailureReceipt(root, writeFile, measurement);
                }
                throw new FixtureLifecycleError(
                  measurement.category === "watchdog_data_budget_exceeded"
                    ? "nested data watchdog exceeded"
                    : "owned Docker watchdog measurement failed",
                  {
                    stage: "resource_watchdog",
                    category: measurement.category,
                    detail: measurement.detail,
                    operation: "resource_watchdog_du",
                    exitCode: measurement.exitCode ?? 1,
                    stdoutBytes: measurement.stdoutBytes,
                    stderrBytes: measurement.stderrBytes,
                    stdoutSha256: measurement.stdoutSha256,
                    stderrSha256: measurement.stderrSha256,
                    watchdog: watchdogSummary(),
                  },
                );
              }
              lastTransientMeasurement = measurement;
              const afterAttempt = computeRemainingBudget();
              if (attempt < watchdogPolicy.maxTransientRetriesPerTick) {
                transientRetries += 1;
                const retrySleepMs = Math.min(
                  watchdogPolicy.transientRetryDelayMs,
                  afterAttempt.suiteRemainingMs,
                  afterAttempt.sampleRemainingMs,
                );
                await untilCancelled(wait(retrySleepMs));
              }
            }

            if (!measurement.ok) {
              consecutiveTransientTicks += 1;
              const remaining = computeRemainingBudget();
              const canPreserveSample =
                lastValidSample !== null &&
                lastValidSample.bytes < RESOURCE_LIMITS.dataBytes &&
                remaining.sampleRemainingMs > 0 &&
                consecutiveTransientTicks <=
                  watchdogPolicy.maxConsecutiveTransientTicks;
              if (!canPreserveSample) {
                throwSampleBudgetExpiredError(measurement);
              }
            }

            const remainingBeforeSleep = computeRemainingBudget();
            const sleepMs = Math.min(
              watchdogPolicy.sampleIntervalMs,
              remainingBeforeSleep.suiteRemainingMs,
              remainingBeforeSleep.sampleRemainingMs,
            );
            await untilCancelled(wait(sleepMs));
          } catch (error) {
            if (!signal.aborted) {
              const suiteTimedOut =
                error?.code === "timeout" && now() >= suiteDeadlineAt;
              const wrapped =
                error?.isFixtureLifecycleError === true
                  ? error
                  : new FixtureLifecycleError(
                      suiteTimedOut
                        ? "nested suite deadline"
                        : "owned Docker watchdog process failed",
                      {
                        stage: "resource_watchdog",
                        category: suiteTimedOut
                          ? "watchdog_suite_deadline_exceeded"
                          : error?.code === "timeout"
                            ? "watchdog_measurement_timeout"
                            : "watchdog_process_failed",
                        detail: suiteTimedOut
                          ? "Nested fixture exceeded the startup plus suite wall-clock deadline"
                          : error?.code === "timeout"
                            ? "Resource watchdog measurement command timed out"
                            : "Resource watchdog measurement command failed to execute",
                        operation: suiteTimedOut
                          ? "resource_watchdog_deadline"
                          : "resource_watchdog_du",
                        exitCode: 1,
                        errorCode:
                          !suiteTimedOut && typeof error?.code === "string"
                            ? error.code
                            : undefined,
                        watchdog: watchdogSummary(),
                      },
                    );
              watchdogError = wrapped;
              throw wrapped;
            }
            return;
          }
        }
      })();
      watchdog.catch(() => {});

      casesPromise = Promise.resolve().then(() =>
        executeCases({
          containerId,
          docker,
          spawnDocker,
          inputDirectory,
          signal,
        }),
      );
      casesPromise.catch(() => {});

      // Race command completion, cancellation and the live resource watchdog.
      await untilCancelled(Promise.race([casesPromise, watchdog]));
      if (watchdogError) throw watchdogError;
    },
    async ({ childrenDrained, interrupted }) => {
      if (watchdog) await watchdog.catch(() => {});
      if (casesPromise) await casesPromise.catch(() => {});
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
