import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "vitest";
import {
  createObserverProcessLifecycle,
  executeObserverSelftest,
} from "./bootstrap-observer.mjs";
import { FixtureLifecycleError } from "./nested-lifecycle.mjs";
import { FixtureProcessError } from "./process-scope.mjs";
import {
  defaultSpawnSynGateHelper,
  runNativeFixture,
  sanitizeObserverSelftestResult,
  stopAndDrainSynGateHelper,
} from "./run-native.mjs";

function makeFiles() {
  const store = new Map();
  return {
    store,
    files: {
      existsSync: (p) => store.has(p),
      readFileSync: (p) => store.get(p),
      writeFileSync: (p, value) => {
        store.set(p, value);
      },
    },
  };
}

const sampleImages = {
  node: "sha256:node-id",
  traefik: "sha256:traefik-id",
  proxy: "sha256:proxy-id",
  rootfs: {
    node: ["sha256:layer-node"],
    traefik: ["sha256:layer-traefik"],
    proxy: ["sha256:layer-proxy"],
  },
};

test("emits a durable native-result.json when the resource watchdog rejects before controller projection", async () => {
  const runId = "a".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  const stderr = "unexpected du failure SECRET_CANARY\n";
  const stderrSha = createHash("sha256").update(stderr).digest("hex");
  const stdoutSha = createHash("sha256").update("").digest("hex");

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async () => {
        throw new FixtureLifecycleError(
          "owned Docker watchdog measurement failed",
          {
            stage: "resource_watchdog",
            category: "watchdog_measurement_failed",
            detail:
              "Resource watchdog measurement failed without a recognized safe transient cause",
            operation: "resource_watchdog_du",
            exitCode: 1,
            stdoutBytes: 0,
            stderrBytes: Buffer.byteLength(stderr),
            stdoutSha256: stdoutSha,
            stderrSha256: stderrSha,
            watchdog: {
              transientRetries: 0,
              transientRecoveries: 0,
              consecutiveTransientTicks: 0,
              hasValidSample: true,
            },
          },
        );
      },
    }),
  );

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw, "watchdog failure must still emit native-result.json");
  const result = JSON.parse(raw);
  assert.equal(result.runId, runId);
  assert.equal(result.exitCode, 1);
  assert.equal(result.nativeBehavioralRed, false);
  assert.equal(result.fixtureConstructionFailure, true);
  assert.equal(result.positiveAcceptance, false);
  assert.equal(result.stage, "resource_watchdog");
  assert.equal(result.category, "watchdog_measurement_failed");
  assert.equal(result.operation, "resource_watchdog_du");
  assert.equal(result.stderrBytes, Buffer.byteLength(stderr));
  assert.equal(result.stderrSha256, stderrSha);
  assert.equal(result.stdoutSha256, stdoutSha);
  assert.equal(raw.includes("SECRET_CANARY"), false);
});

test("emits a durable native-result.json when offline image preload fails before controller launch", async () => {
  const runId = "b".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  const loadStderr =
    "open /input/preload-images.tar: no space left on device\n";

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async () => {
            throw new Error("unexpected docker call");
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 1, stdout: "", stderr: loadStderr };
            }
            throw new Error("unexpected spawnDocker call");
          },
        });
      },
    }),
  );

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw, "preload failure must emit native-result.json");
  const result = JSON.parse(raw);
  assert.equal(result.nativeBehavioralRed, false);
  assert.equal(result.fixtureConstructionFailure, true);
  assert.equal(result.stage, "image_preload");
  assert.equal(result.operation, "docker_load_preload");
  assert.equal(result.stderrBytes, Buffer.byteLength(loadStderr));
  assert.equal(
    result.stderrSha256,
    createHash("sha256").update(loadStderr).digest("hex"),
  );
  assert.equal(raw.includes("preload-images.tar"), false);
});

test("never overwrites a more precise native-result.json already emitted by the controller", async () => {
  const runId = "c".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  const controllerOut = "controller stdout\n";
  const controllerErr = "Native gateway behavior is RED.\n";

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "d".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "gateway_startup",
                failureClassification: "behavioral",
                category: "gateway_startup_failed",
                detail: "Gateway startup script execution failed",
                operation: "run_gateway_startup",
                elapsedMs: 142,
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              return { code: 1, stdout: controllerOut, stderr: controllerErr };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
    /native gateway behavioral assertions failed/,
  );

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw, "controller behavioral result must exist");
  const result = JSON.parse(raw);
  assert.equal(result.nativeBehavioralRed, true);
  assert.equal(result.fixtureConstructionFailure, false);
  assert.equal(result.stage, "gateway_startup");
  assert.equal(result.category, "gateway_startup_failed");
  assert.equal(result.operation, "run_gateway_startup");
  assert.equal(
    result.stdoutSha256,
    createHash("sha256").update(controllerOut).digest("hex"),
  );
  assert.equal(
    result.stderrSha256,
    createHash("sha256").update(controllerErr).digest("hex"),
  );
});

test("emits a durable native-result.json on outer construction failure or cancellation", async () => {
  const runId = "d".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  const createStderr = "docker: invalid mount SECRET_MOUNT\n";
  const createSha = createHash("sha256").update(createStderr).digest("hex");

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async () => {
        throw new FixtureLifecycleError("owned Docker command failed", {
          stage: "outer_container_create",
          category: "fixture_mount_unavailable",
          detail: "An owned fixture mount is unavailable",
          operation: "docker_create",
          exitCode: 125,
          stderrBytes: Buffer.byteLength(createStderr),
          stderrSha256: createSha,
        });
      },
    }),
  );

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw, "outer construction failure must emit native-result.json");
  const result = JSON.parse(raw);
  assert.equal(result.stage, "outer_container_create");
  assert.equal(result.category, "fixture_mount_unavailable");
  assert.equal(result.operation, "docker_create");
  assert.equal(result.exitCode, 125);
  assert.equal(result.stderrSha256, createSha);
  assert.equal(result.nativeBehavioralRed, false);
  assert.equal(result.fixtureConstructionFailure, true);
  assert.equal(raw.includes("SECRET_MOUNT"), false);

  const cancelRunId = "e".repeat(24);
  const cancelRoot = `/opt/gwrk-verification/${cancelRunId}`;
  const cancelFiles = makeFiles();
  await assert.rejects(
    runNativeFixture({
      runId: cancelRunId,
      root: cancelRoot,
      receipt: {},
      images: sampleImages,
      files: cancelFiles.files,
      withLifecycle: async () => {
        throw new FixtureProcessError("cancelled", true);
      },
    }),
  );
  const cancelReceipt = JSON.parse(
    cancelFiles.store.get(`${cancelRoot}/native-result.json`),
  );
  assert.equal(cancelReceipt.category, "fixture_cancelled");
  assert.equal(cancelReceipt.errorCode, "cancelled");
  assert.equal(cancelReceipt.nativeBehavioralRed, false);
  assert.equal(cancelReceipt.fixtureConstructionFailure, true);
});

async function makeLiveLifecycleHarness(runId, commandOverride) {
  const { EventEmitter } = await import("node:events");
  const { withOwnedNestedDaemon } = await import("./nested-lifecycle.mjs");
  const { DIND_IMAGE, RESOURCE_LIMITS } = await import("./runtime-policy.mjs");
  const root = `/opt/gwrk-verification/${runId}`;
  const containerId = "9".repeat(64);
  const store = new Map();
  const receipt = {
    approvedPrivilegedExecution: true,
    outerImage: DIND_IMAGE,
    dataBudgetBytes: RESOURCE_LIMITS.dataBytes,
    estimatedDataBytes: 10 * 1024 ** 3,
    backingAvailableBytes: 20 * 1024 ** 3,
    rootAvailableBytes: 10 * 1024 ** 3,
    nodeImageId: `sha256:${"c".repeat(64)}`,
    sourceCommit: "d".repeat(40),
    archiveSha256: "e".repeat(64),
    purpose: "behavioral-red",
    daemonImageId: "sha256:daemon-fixture",
    dataParentDevice: 9,
    dataParentInode: 2,
    dataChildIdentity: { device: 9, inode: 3 },
  };
  const metadata = (p) => ({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: p === "/var/lib/gwrk" ? 997 : 0,
    gid: p === "/var/lib/gwrk" ? 988 : 0,
    mode: p === "/var/lib/gwrk" ? 0o750 : 0o700,
    dev: 9,
    ino:
      p === "/var/lib/gwrk"
        ? 2
        : p.endsWith(runId) && p.startsWith("/var")
          ? 3
          : 4,
  });
  const files = {
    existsSync: (p) => store.has(p),
    lstatSync: metadata,
    statSync: metadata,
    realpathSync: (v) => v,
    readlinkSync: (p) => {
      if (p === "/proc/self/ns/pid") return "pid:[1]";
      if (p.endsWith("/ns/pid")) return "pid:[2]";
      if (p === "/proc/self/ns/net") return "net:[10]";
      if (p.endsWith("/ns/net")) return "net:[20]";
      return "unknown";
    },
    readdirSync: () => [],
    readFileSync: (p) =>
      store.has(p) ? store.get(p) : "1 0 9:1 / / rw - ext4 /dev/test rw\n",
    mkdirSync: () => {},
    writeFileSync: (p, v) => {
      store.set(p, v);
    },
    rmSync: () => {},
  };
  const baseCommand = async (args) => {
    if (args[0] === "image") {
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: receipt.daemonImageId,
          Architecture: "amd64",
        }),
        stderr: "",
      };
    }
    if (args[0] === "create" || args[0] === "start") {
      return { code: 0, stdout: containerId, stderr: "" };
    }
    if (args[0] === "inspect") {
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: containerId,
          Config: { Labels: { "gwrk.fixture.run": runId } },
          HostConfig: {
            PidMode: "",
            IpcMode: "private",
            NetworkMode: "none",
          },
          State: { Pid: 900 },
        }),
        stderr: "",
      };
    }
    if (args[0] === "rm") return { code: 0, stdout: "", stderr: "" };
    if (args.includes("readlink")) {
      const target = args[args.indexOf("readlink") + 1];
      return {
        code: 0,
        stdout: target?.includes("/ns/net") ? "net:[20]\n" : "pid:[2]\n",
        stderr: "",
      };
    }
    if (args.includes("info")) {
      return {
        code: 0,
        stdout: JSON.stringify({ Driver: "vfs", Architecture: "x86_64" }),
        stderr: "",
      };
    }
    if (args.includes("du"))
      return { code: 0, stdout: "1024\t/var/lib/docker\n", stderr: "" };
    if (args.includes("load"))
      return { code: 0, stdout: "Loaded\n", stderr: "" };
    if (
      args.includes("exec") &&
      args.includes("image") &&
      args.includes("inspect")
    ) {
      const target = args.at(-1);
      const key = Object.entries(sampleImages).find(([, v]) => v === target)[0];
      return {
        code: 0,
        stdout: JSON.stringify({
          Id: target,
          RootFS: { Layers: sampleImages.rootfs[key] },
        }),
        stderr: "",
      };
    }
    if (args.includes("mkdir")) return { code: 0, stdout: "", stderr: "" };
    throw new Error(`unexpected docker args: ${args.join(" ")}`);
  };
  const effects = {
    files,
    platform: "linux",
    uid: 0,
    processTarget: new EventEmitter(),
    watchdog: {
      sampleIntervalMs: 10,
      maxValidSampleAgeMs: 15_000,
      commandTimeoutMs: 5_000,
    },
    command: (args, options) => commandOverride(args, options, baseCommand),
  };
  return {
    root,
    receipt,
    store,
    files,
    RESOURCE_LIMITS,
    withLifecycle: (input) => withOwnedNestedDaemon(input, effects),
  };
}

test("watchdog abort during bootstrap-stage read preserves durable watchdog receipt", async () => {
  const runId = "f".repeat(24);
  let releaseWatchdog;
  const watchdogGate = new Promise((resolve) => {
    releaseWatchdog = resolve;
  });
  const h = await makeLiveLifecycleHarness(
    runId,
    async (args, options, base) => {
      if (args.includes("du")) {
        await watchdogGate;
        return {
          code: 0,
          stdout: `${h.RESOURCE_LIMITS.dataBytes}\t/var/lib/docker\n`,
          stderr: "",
        };
      }
      if (args.includes("/input/fixtures/bootstrap.mjs")) {
        return { code: 0, stdout: "ok\n", stderr: "" };
      }
      if (args.includes("/fixture/bootstrap-stage.json")) {
        releaseWatchdog();
        return options.spawnProcess(
          process.execPath,
          ["-e", "setInterval(()=>{}, 1000)"],
          {
            timeoutMs: options.timeoutMs,
          },
        );
      }
      return base(args, options);
    },
  );

  await assert.rejects(
    runNativeFixture({
      runId,
      root: h.root,
      receipt: h.receipt,
      images: sampleImages,
      files: h.files,
      withLifecycle: h.withLifecycle,
    }),
  );

  const persisted = JSON.parse(h.store.get(`${h.root}/native-result.json`));
  assert.equal(persisted.stage, "resource_watchdog");
  assert.equal(persisted.category, "watchdog_data_budget_exceeded");
  assert.equal(persisted.fixtureConstructionFailure, true);
  assert.equal(persisted.nativeBehavioralRed, false);
});

test("late post-abort executeCases continuation cannot overwrite durable watchdog receipt", async () => {
  const runId = "1".repeat(24);
  let releaseWatchdog;
  const watchdogGate = new Promise((resolve) => {
    releaseWatchdog = resolve;
  });
  let releaseStageRead;
  const stageReadPending = new Promise((resolve) => {
    releaseStageRead = resolve;
  });
  const h = await makeLiveLifecycleHarness(
    runId,
    async (args, options, base) => {
      if (args.includes("du")) {
        await watchdogGate;
        return {
          code: 0,
          stdout: `${h.RESOURCE_LIMITS.dataBytes}\t/var/lib/docker\n`,
          stderr: "",
        };
      }
      if (args.includes("/input/fixtures/bootstrap.mjs")) {
        return { code: 1, stdout: "", stderr: "red\n" };
      }
      if (args.includes("/fixture/bootstrap-stage.json")) {
        releaseWatchdog();
        await stageReadPending;
        return { code: 1, stdout: "", stderr: "late\n" };
      }
      return base(args, options);
    },
  );

  await assert.rejects(
    runNativeFixture({
      runId,
      root: h.root,
      receipt: h.receipt,
      images: sampleImages,
      files: h.files,
      withLifecycle: h.withLifecycle,
    }),
  );

  releaseStageRead();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const persisted = JSON.parse(h.store.get(`${h.root}/native-result.json`));
  assert.equal(persisted.category, "watchdog_data_budget_exceeded");
});

test("preload image inspect docker failure preserves stage image_preload", async () => {
  const runId = "0".repeat(24);
  const h = await makeLiveLifecycleHarness(
    runId,
    async (args, options, base) => {
      if (
        args.includes("exec") &&
        args.includes("image") &&
        args.includes("inspect")
      ) {
        return {
          code: 1,
          stdout: "",
          stderr: "Error: No such image: sha256:node-id\n",
        };
      }
      return base(args, options);
    },
  );

  await assert.rejects(
    runNativeFixture({
      runId,
      root: h.root,
      receipt: h.receipt,
      images: sampleImages,
      files: h.files,
      withLifecycle: h.withLifecycle,
    }),
  );

  const persisted = JSON.parse(h.store.get(`${h.root}/native-result.json`));
  assert.equal(persisted.stage, "image_preload");
});

test("controller setup docker failure preserves stage controller_setup", async () => {
  const runId = "2".repeat(24);
  const h = await makeLiveLifecycleHarness(
    runId,
    async (args, options, base) => {
      if (args.includes("mkdir")) {
        return { code: 1, stdout: "", stderr: "mkdir: permission denied\n" };
      }
      return base(args, options);
    },
  );

  await assert.rejects(
    runNativeFixture({
      runId,
      root: h.root,
      receipt: h.receipt,
      images: sampleImages,
      files: h.files,
      withLifecycle: h.withLifecycle,
    }),
  );

  const persisted = JSON.parse(h.store.get(`${h.root}/native-result.json`));
  assert.equal(persisted.stage, "controller_setup");
  assert.equal(persisted.fixtureConstructionFailure, true);
  assert.equal(persisted.nativeBehavioralRed, false);
});

test("observer startup controller failure preserves stage observer_start with construction failure", async () => {
  const runId = "3".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  const controllerOut = "observer startup failed\n";
  const controllerErr = "Error: native observer exited early with code 1\n";

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "e".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "observer_start",
                failureClassification: "fixture_construction",
                category: "observer_startup_failed",
                detail:
                  "Native passive observer failed to start or pass self test",
                operation: "start_native_observer",
                elapsedMs: 85,
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              return { code: 1, stdout: controllerOut, stderr: controllerErr };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
    /native gateway behavioral assertions failed/,
  );

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw, "controller observer_start result must exist");
  const result = JSON.parse(raw);
  assert.equal(result.nativeBehavioralRed, false);
  assert.equal(result.fixtureConstructionFailure, true);
  assert.equal(result.stage, "observer_start");
  assert.equal(result.category, "observer_startup_failed");
  assert.equal(result.operation, "start_native_observer");
});

test("projects origin create-versus-start timing and safe containerState into native-result.json", async () => {
  const runId = "4".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "f".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "origin_start",
                failureClassification: "fixture_construction",
                category: "origin_launch_failed",
                detail: "Origin service container failed to launch",
                operation: "docker_create_origin",
                elapsedMs: 60012,
                createElapsedMs: 60012,
                startElapsedMs: null,
                containerState: {
                  containerExists: true,
                  containerStatus: "created",
                  oomKilled: false,
                  containerExitCode: 0,
                  containerPid: 0,
                },
                errorCode: "ETIMEDOUT",
                errorSignal: null,
                exitStatus: 143,
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              return { code: 1, stdout: "", stderr: "RED\n" };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
  );

  const persisted = JSON.parse(store.get(`${root}/native-result.json`));
  assert.equal(persisted.stage, "origin_start");
  assert.equal(persisted.operation, "docker_create_origin");
  assert.equal(persisted.createElapsedMs, 60012);
  assert.equal(persisted.startElapsedMs, null);
  assert.deepEqual(persisted.containerState, {
    containerExists: true,
    containerStatus: "created",
    oomKilled: false,
    containerExitCode: 0,
    containerPid: 0,
  });
  assert.equal(persisted.fixtureConstructionFailure, true);
  assert.equal(persisted.nativeBehavioralRed, false);
});

test("wires NET_RAW to main controller only when approvedPassiveNetRaw is true, preserving caps and rejecting NET_ADMIN", async () => {
  const runId = "5".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const capturedArgs = [];
  const { files } = makeFiles();

  // Test approvedPassiveNetRaw: true
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        approvedPassiveNetRaw: true,
        approvedScenarioBSynGate: true,
      },
      images: sampleImages,
      files,
      spawnSynGateHelper: () => {
        const listeners = new Map();
        const fakeProc = {
          exitCode: null,
          signalCode: null,
          stdin: {
            destroyed: false,
            write: () => {},
            end: () => {
              fakeProc.exitCode = 0;
              listeners.get("close")?.(0, null);
            },
          },
          stdout: { resume: () => {} },
          stderr: { resume: () => {} },
          once: (ev, cb) => listeners.set(ev, cb),
          kill: () => {},
        };
        return fakeProc;
      },
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          hostNetNamespace: "net:[10]",
          outerNetNamespace: "net:[20]",
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir") || args.includes("chmod")) return "";
            if (args.includes("/fixture/syn-gate/receipt.json")) {
              throw new Error("not armed yet");
            }
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "gateway_startup",
                failureClassification: "behavioral",
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              capturedArgs.push(args);
              return { code: 1, stdout: "", stderr: "fail\n" };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
  );

  assert.equal(capturedArgs.length, 1);
  const argsWithNetRaw = capturedArgs[0];
  assert.ok(argsWithNetRaw.includes("--cap-drop"));
  assert.equal(argsWithNetRaw[argsWithNetRaw.indexOf("--cap-drop") + 1], "ALL");
  assert.ok(argsWithNetRaw.includes("--security-opt"));
  assert.equal(
    argsWithNetRaw[argsWithNetRaw.indexOf("--security-opt") + 1],
    "no-new-privileges",
  );
  assert.ok(argsWithNetRaw.includes("CHOWN"));
  assert.ok(argsWithNetRaw.includes("DAC_OVERRIDE"));
  assert.ok(argsWithNetRaw.includes("FOWNER"));
  assert.ok(argsWithNetRaw.includes("NET_RAW"));
  assert.equal(argsWithNetRaw.includes("NET_ADMIN"), false);

  // Test approvedPassiveNetRaw: false / omitted
  capturedArgs.length = 0;
  const store2 = makeFiles();
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        approvedPassiveNetRaw: false,
      },
      images: sampleImages,
      files: store2.files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "gateway_startup",
                failureClassification: "behavioral",
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              capturedArgs.push(args);
              return { code: 1, stdout: "", stderr: "fail\n" };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
  );

  assert.equal(capturedArgs.length, 1);
  const argsWithoutNetRaw = capturedArgs[0];
  assert.equal(argsWithoutNetRaw.includes("NET_RAW"), false);
  assert.equal(argsWithoutNetRaw.includes("NET_ADMIN"), false);
});

test("derives GWRK_051_OBSERVER_SELFTEST_ONLY strictly from validated checkpoint verificationMode without ambient env shortcut", async () => {
  const runId = "6".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const capturedArgs = [];
  const { files } = makeFiles();

  // Test verificationMode: observer-selftest
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "behavioral-red",
        approvedPassiveNetRaw: true,
      },
      images: sampleImages,
      files,
      spawnSynGateHelper: () => {
        const listeners = new Map();
        const fakeProc = {
          exitCode: null,
          signalCode: null,
          stdin: {
            destroyed: false,
            write: () => {},
            end: () => {
              fakeProc.exitCode = 0;
              listeners.get("close")?.(0, null);
            },
          },
          stdout: { resume: () => {} },
          stderr: { resume: () => {} },
          once: (ev, cb) => listeners.set(ev, cb),
          kill: () => {},
        };
        return fakeProc;
      },
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          hostNetNamespace: "net:[10]",
          outerNetNamespace: "net:[20]",
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir") || args.includes("chmod")) return "";
            if (args.includes("/fixture/syn-gate/receipt.json")) {
              throw new Error("not armed yet");
            }
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "observer_start",
                failureClassification: "fixture_construction",
                category: "observer_startup_failed",
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              capturedArgs.push(args);
              return { code: 1, stdout: "", stderr: "observer failed\n" };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
  );

  assert.equal(capturedArgs.length, 1);
  assert.ok(
    capturedArgs[0].includes("GWRK_051_OBSERVER_SELFTEST_ONLY=1"),
    "must pass GWRK_051_OBSERVER_SELFTEST_ONLY=1 when verificationMode is observer-selftest",
  );

  // Test ambient env is ignored when verificationMode is omitted
  capturedArgs.length = 0;
  const originalEnv = process.env.GWRK_051_OBSERVER_SELFTEST_ONLY;
  process.env.GWRK_051_OBSERVER_SELFTEST_ONLY = "1";
  try {
    const store2 = makeFiles();
    await assert.rejects(
      runNativeFixture({
        runId,
        root,
        receipt: {},
        images: sampleImages,
        files: store2.files,
        withLifecycle: async ({ executeCases }) => {
          await executeCases({
            containerId: "c".repeat(64),
            docker: async (args) => {
              if (args.includes("inspect")) {
                const target = args.at(-1);
                const key = Object.entries(sampleImages).find(
                  ([, value]) => value === target,
                )[0];
                return JSON.stringify({
                  Id: target,
                  RootFS: { Layers: sampleImages.rootfs[key] },
                });
              }
              if (args.includes("mkdir")) return "";
              if (args.includes("/fixture/bootstrap-stage.json")) {
                return JSON.stringify({
                  stage: "gateway_startup",
                  failureClassification: "behavioral",
                });
              }
              throw new Error(`unexpected docker args: ${args.join(" ")}`);
            },
            spawnDocker: async (args) => {
              if (args.includes("load")) {
                return { code: 0, stdout: "Loaded\n", stderr: "" };
              }
              if (args.includes("/input/fixtures/bootstrap.mjs")) {
                capturedArgs.push(args);
                return { code: 1, stdout: "", stderr: "fail\n" };
              }
              throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
            },
          });
        },
      }),
    );
    assert.equal(capturedArgs.length, 1);
    assert.equal(
      capturedArgs[0].some((a) =>
        a.includes("GWRK_051_OBSERVER_SELFTEST_ONLY"),
      ),
      false,
      "ambient env must not activate selftest mode without validated checkpoint verificationMode",
    );
  } finally {
    if (originalEnv === undefined) {
      Reflect.deleteProperty(process.env, "GWRK_051_OBSERVER_SELFTEST_ONLY");
    } else {
      process.env.GWRK_051_OBSERVER_SELFTEST_ONLY = originalEnv;
    }
  }

  // Test observer-selftest rejects acceptance purpose
  const store3 = makeFiles();
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "acceptance",
      },
      images: sampleImages,
      files: store3.files,
      withLifecycle: async () => {},
    }),
    /selftest mode not allowed under acceptance purpose|observer-selftest cannot be used under acceptance purpose/,
  );
});

test("observer-selftest emits diagnostic-only typed result and never grants positiveAcceptance", async () => {
  const runId = "7".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();

  // Successful selftest run (exitCode 0)
  await runNativeFixture({
    runId,
    root,
    receipt: {
      verificationMode: "observer-selftest",
      purpose: "behavioral-red",
      approvedPassiveNetRaw: true,
    },
    images: sampleImages,
    files,
    withLifecycle: async ({ executeCases }) => {
      await executeCases({
        containerId: "c".repeat(64),
        docker: async (args) => {
          if (args.includes("inspect")) {
            const target = args.at(-1);
            const key = Object.entries(sampleImages).find(
              ([, value]) => value === target,
            )[0];
            return JSON.stringify({
              Id: target,
              RootFS: { Layers: sampleImages.rootfs[key] },
            });
          }
          if (args.includes("mkdir")) return "";
          if (args.includes("/fixture/bootstrap-stage.json")) {
            return JSON.stringify({
              stage: "completed_observer_selftest",
            });
          }
          if (args.includes("/fixture/observer-selftest-result.json")) {
            return JSON.stringify({
              runId,
              passed: true,
              effectiveRcvBufBytes: 1048576,
              ignoreOutgoingKernelEnabled: true,
              pkttypeBpfFallbackActive: false,
              cleanStopObserved: true,
            });
          }
          throw new Error(`unexpected docker args: ${args.join(" ")}`);
        },
        spawnDocker: async (args) => {
          if (args.includes("load")) {
            return { code: 0, stdout: "Loaded\n", stderr: "" };
          }
          if (args.includes("/input/fixtures/bootstrap.mjs")) {
            return {
              code: 0,
              stdout:
                "Native observer selftest passed. Diagnostic only; full acceptance remains pending.\n",
              stderr: "",
            };
          }
          throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
        },
      });
    },
  });

  const raw = store.get(`${root}/native-result.json`);
  assert.ok(raw);
  const result = JSON.parse(raw);
  assert.equal(result.exitCode, 0);
  assert.equal(result.verificationMode, "observer-selftest");
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.positiveAcceptance, false);
  assert.equal(result.nativeBehavioralRed, false);
  assert.equal(result.stage, "completed_observer_selftest");
  assert.deepEqual(result.observerSelftest, {
    runId,
    passed: true,
    effectiveRcvBufBytes: 1048576,
    ignoreOutgoingKernelEnabled: true,
    pkttypeBpfFallbackActive: false,
    cleanStopObserved: true,
  });

  // Failed selftest run (exitCode 1 without NET_RAW reaches observer_startup_failed)
  const runIdFail = "8".repeat(24);
  const rootFail = `/opt/gwrk-verification/${runIdFail}`;
  const storeFail = makeFiles();
  await assert.rejects(
    runNativeFixture({
      runId: runIdFail,
      root: rootFail,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "behavioral-red",
        approvedPassiveNetRaw: false,
      },
      images: sampleImages,
      files: storeFail.files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({
                stage: "observer_start",
                failureClassification: "fixture_construction",
                category: "observer_startup_failed",
                detail:
                  "Native passive observer failed to start or pass self test",
                operation: "start_native_observer",
                elapsedMs: 80,
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            if (args.includes("/input/fixtures/bootstrap.mjs")) {
              return {
                code: 1,
                stdout: "",
                stderr: "Native gateway behavior is RED.\n",
              };
            }
            throw new Error(`unexpected spawnDocker args: ${args.join(" ")}`);
          },
        });
      },
    }),
  );

  const rawFail = storeFail.store.get(`${rootFail}/native-result.json`);
  assert.ok(rawFail);
  const resultFail = JSON.parse(rawFail);
  assert.equal(resultFail.exitCode, 1);
  assert.equal(resultFail.verificationMode, "observer-selftest");
  assert.equal(resultFail.diagnosticOnly, true);
  assert.equal(resultFail.positiveAcceptance, false);
  assert.equal(resultFail.stage, "observer_start");
  assert.equal(resultFail.category, "observer_startup_failed");
  assert.equal(resultFail.fixtureConstructionFailure, true);
});

test("REVIEW-NR-01: observer-selftest fails closed on secret-bearing, invalid, or missing selftest receipts", async () => {
  const runId = "9".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const canary = "SECRET_SELFTEST_CANARY_XYZ987";
  const invalidCase = makeFiles();

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "behavioral-red",
        approvedPassiveNetRaw: true,
      },
      images: sampleImages,
      files: invalidCase.files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({ stage: "completed_observer_selftest" });
            }
            if (args.includes("/fixture/observer-selftest-result.json")) {
              return JSON.stringify({
                runId: "b".repeat(24),
                passed: false,
                effectiveRcvBufBytes: 128,
                ignoreOutgoingKernelEnabled: false,
                pkttypeBpfFallbackActive: false,
                leakedSecret: canary,
              });
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            return { code: 0, stdout: "ok\n", stderr: "" };
          },
        });
      },
    }),
  );
  const leakedRaw = invalidCase.store.get(`${root}/native-result.json`) ?? "";
  assert.equal(leakedRaw.includes(canary), false);

  const missingCase = makeFiles();
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "behavioral-red",
        approvedPassiveNetRaw: true,
      },
      images: sampleImages,
      files: missingCase.files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({ stage: "staging_directories" });
            }
            if (args.includes("/fixture/observer-selftest-result.json")) {
              throw new Error("missing selftest receipt");
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load")) {
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            }
            return { code: 0, stdout: "ok\n", stderr: "" };
          },
        });
      },
    }),
  );
  const missingResult = JSON.parse(
    missingCase.store.get(`${root}/native-result.json`),
  );
  assert.equal(missingResult.positiveAcceptance, false);
});

test("REVIEW-NR2-03a: sanitizeObserverSelftestResult must reject NaN, Infinity, and fractional effectiveRcvBufBytes", () => {
  const runId = "9".repeat(24);
  for (const badValue of [Number.NaN, Number.POSITIVE_INFINITY, 524288.5]) {
    assert.throws(
      () =>
        sanitizeObserverSelftestResult(
          {
            runId,
            passed: true,
            effectiveRcvBufBytes: badValue,
            ignoreOutgoingKernelEnabled: true,
            cleanStopObserved: true,
          },
          runId,
        ),
      /effectiveRcvBufBytes/,
      `sanitizeObserverSelftestResult accepted invalid effectiveRcvBufBytes=${String(badValue)}`,
    );
  }
});

test("REVIEW-NR2-03b: runNativeFixture selftest failure receipt must preserve observer_startup_failed category", async () => {
  const runId = "9".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { store, files } = makeFiles();
  let timingLookupAttempted = false;
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        verificationMode: "observer-selftest",
        purpose: "behavioral-red",
        approvedPassiveNetRaw: true,
      },
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, v]) => v === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({ stage: "completed_observer_selftest" });
            }
            if (args.includes("/fixture/origin-timing.json")) {
              timingLookupAttempted = true;
              return JSON.stringify({
                createElapsedMs: 10,
                startElapsedMs: 20,
              });
            }
            if (args.includes("/fixture/observer-selftest-result.json")) {
              throw new Error("ENOENT");
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load"))
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            return { code: 0, stdout: "ok\n", stderr: "" };
          },
        });
      },
    }),
  );
  const persisted = JSON.parse(store.get(`${root}/native-result.json`));
  assert.equal(
    persisted.category,
    "observer_startup_failed",
    `expected observer_startup_failed in failure receipt, got ${persisted.category}`,
  );
  assert.equal(
    timingLookupAttempted,
    false,
    "origin timing lookup must not run in observer-selftest mode",
  );
});

test("REVIEW-NR2-03b: runNativeFixture rethrows cancellation error during timing lookup", async () => {
  const runId = "9".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { files } = makeFiles();
  const cancelError = new FixtureProcessError("cancelled", true);
  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {},
      images: sampleImages,
      files,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, v]) => v === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir")) return "";
            if (args.includes("/fixture/bootstrap-stage.json")) {
              return JSON.stringify({ stage: "completed_initial_cases" });
            }
            if (args.includes("/fixture/origin-timing.json")) {
              throw cancelError;
            }
            throw new Error(`unexpected docker args: ${args.join(" ")}`);
          },
          spawnDocker: async (args) => {
            if (args.includes("load"))
              return { code: 0, stdout: "Loaded\n", stderr: "" };
            return { code: 0, stdout: "ok\n", stderr: "" };
          },
        });
      },
    }),
    (err) => err === cancelError || err.code === "cancelled",
  );
});

test("REVIEW-NR3-01: executeObserverSelftest with default writeFile writes result with mode 0o600", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gwrk-nr3-default-writefile-test-"));
  try {
    const resultPath = join(dir, "observer-selftest-result.json");
    const lifecycle = createObserverProcessLifecycle({
      readyTimeoutMs: 500,
      pollMs: 10,
      termTimeoutMs: 50,
      killTimeoutMs: 50,
    });
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.kill = (sig) => {
      proc.emit("exit", 0, sig);
      proc.emit("close", 0, sig);
    };

    const { result } = await executeObserverSelftest({
      runId: "b".repeat(24),
      observerDir: dir,
      proxyImageId: "sha256:proxy-id",
      traefikImageId: "sha256:traefik-id",
      runtimeReceiptSha256: "3".repeat(64),
      observerLifecycle: lifecycle,
      spawnProcess: () => proc,
      readHealth: () => ({
        startupSelfTestPassed: true,
        captureStats: {
          effectiveRcvBufBytes: 1048576,
          ignoreOutgoingKernelEnabled: true,
          pkttypeBpfFallbackActive: false,
        },
      }),
      resultPath,
    });

    assert.equal(result.passed, true);
    assert.equal(result.cleanStopObserved, true);
    const written = JSON.parse(readFileSync(resultPath, "utf8"));
    assert.equal(written.passed, true);
    assert.equal(written.cleanStopObserved, true);
    const stat = statSync(resultPath);
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runNativeFixture drains synGateHelper even when error/abort occurs between helper spawn and controller spawnDocker", async () => {
  const runId = "d".repeat(24);
  const root = `/opt/gwrk-verification/${runId}`;
  const { files } = makeFiles();
  let helperDrained = false;

  const fakeHelperProc = new EventEmitter();
  fakeHelperProc.exitCode = null;
  fakeHelperProc.signalCode = null;
  fakeHelperProc.stdin = new EventEmitter();
  fakeHelperProc.stdin.destroyed = false;
  fakeHelperProc.stdin.write = (chunk) => {
    if (String(chunk).includes("STOP")) {
      helperDrained = true;
      fakeHelperProc.exitCode = 0;
      fakeHelperProc.emit("close", 0, null);
    }
  };
  fakeHelperProc.stdin.end = () => {};
  fakeHelperProc.stdout = { resume: () => {} };
  fakeHelperProc.stderr = { resume: () => {} };
  fakeHelperProc.kill = () => {
    helperDrained = true;
    fakeHelperProc.exitCode = 0;
    fakeHelperProc.emit("close", 0, null);
  };

  const originalWriteFileSync = files.writeFileSync;
  files.writeFileSync = (p, val) => {
    if (p.includes("controller-ownership.json")) {
      throw new Error("simulated failure after syn-gate helper spawn");
    }
    return originalWriteFileSync(p, val);
  };

  await assert.rejects(
    runNativeFixture({
      runId,
      root,
      receipt: {
        approvedPassiveNetRaw: true,
        approvedScenarioBSynGate: true,
      },
      images: sampleImages,
      files,
      spawnSynGateHelper: () => fakeHelperProc,
      withLifecycle: async ({ executeCases }) => {
        await executeCases({
          containerId: "c".repeat(64),
          hostNetNamespace: "net:[10]",
          outerNetNamespace: "net:[20]",
          docker: async (args) => {
            if (args.includes("inspect")) {
              const target = args.at(-1);
              const key = Object.entries(sampleImages).find(
                ([, value]) => value === target,
              )[0];
              return JSON.stringify({
                Id: target,
                RootFS: { Layers: sampleImages.rootfs[key] },
              });
            }
            if (args.includes("mkdir") || args.includes("chmod")) return "";
            return "";
          },
          spawnDocker: async () => {
            return { code: 0, stdout: "", stderr: "" };
          },
        });
      },
    }),
    /simulated failure after syn-gate helper spawn/,
  );

  assert.equal(
    helperDrained,
    true,
    "SYN-gate helper must be drained even if setup throws before spawnDocker",
  );
});

test("stopAndDrainSynGateHelper handles async EPIPE and child error events without uncaught error", async () => {
  const fakeProc = new EventEmitter();
  fakeProc.exitCode = null;
  fakeProc.signalCode = null;
  fakeProc.stdin = new EventEmitter();
  fakeProc.stdin.destroyed = false;
  fakeProc.stdin.write = () => {
    process.nextTick(() => {
      const err = new Error("write EPIPE");
      err.code = "EPIPE";
      fakeProc.stdin.emit("error", err);
    });
  };
  fakeProc.stdin.end = () => {};
  fakeProc.kill = () => {};

  setTimeout(() => {
    fakeProc.exitCode = 0;
    fakeProc.emit("close", 0, null);
  }, 10);

  const result = await stopAndDrainSynGateHelper(fakeProc, 500);
  assert.equal(result.drained, true);
  assert.equal(result.exitCode, 0);
});

test("defaultSpawnSynGateHelper uses isolated DOCKER_CONFIG and attaches error listeners", () => {
  const root = "/opt/gwrk-verification/test-run-root";
  let capturedOptions = null;
  const fakeChild = new EventEmitter();
  fakeChild.stdin = new EventEmitter();

  const proc = defaultSpawnSynGateHelper({
    containerId: "test-container-id",
    runId: "test-run-id",
    hostNetNamespace: "net:[100]",
    outerNetNamespace: "net:[200]",
    root,
    spawnProcess: (_file, _args, options) => {
      capturedOptions = options;
      return fakeChild;
    },
  });

  assert.ok(proc, "helper process must be returned");
  assert.ok(capturedOptions?.env, "isolated env must be passed");
  assert.equal(
    capturedOptions.env.DOCKER_CONFIG,
    `${root}/docker-config`,
    "DOCKER_CONFIG must point to root/docker-config",
  );
  assert.equal(capturedOptions.env.HOME, "/root");
  assert.equal(capturedOptions.env.LANG, "C");
  assert.equal(capturedOptions.env.LC_ALL, "C");
  assert.equal(capturedOptions.env.PATH, "/usr/sbin:/usr/bin:/sbin:/bin");

  // Error events on proc and stdin must not throw unhandled exceptions
  assert.doesNotThrow(() => {
    proc.emit("error", new Error("simulated spawn error"));
    proc.stdin?.emit("error", new Error("simulated stdin error"));
  });
});
