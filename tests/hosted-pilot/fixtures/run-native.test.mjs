import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { FixtureLifecycleError } from "./nested-lifecycle.mjs";
import { FixtureProcessError } from "./process-scope.mjs";
import { runNativeFixture } from "./run-native.mjs";

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
