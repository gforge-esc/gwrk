import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { readNativeObserverHealth } from "./raw-https.mjs";

const CONTAINER_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{1,127}$/;
const FIXTURE_MJS_RE = /^[a-z-]+\.mjs$/;

export function isAllowedFixtureScriptName(name) {
  return (
    typeof name === "string" &&
    (name === "native-observer-capture.py" ||
      name === "syn-gate-helper.sh" ||
      FIXTURE_MJS_RE.test(name))
  );
}

export function resolveComposeContainer(dockerRunner, service) {
  assert.equal(typeof dockerRunner, "function", "dockerRunner is required");
  assert.ok(
    typeof service === "string" && service.length > 0,
    "compose service name is required",
  );
  const output = dockerRunner([
    "ps",
    "--filter",
    "label=com.docker.compose.project=gwrk-hosted-pilot",
    "--filter",
    `label=com.docker.compose.service=${service}`,
    "--format",
    "{{.Names}}",
  ]);
  const names = String(output ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  assert.equal(
    names.length,
    1,
    `expected exactly one running compose container for ${service}`,
  );
  assert.match(
    names[0],
    CONTAINER_NAME_RE,
    `invalid compose container name for ${service}`,
  );
  return names[0];
}

function raceWithTimeout(promise, timeoutMs) {
  return new Promise((resolvePromise) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise();
    };
    const timer = setTimeout(done, timeoutMs);
    promise.then(done, done);
  });
}

export function createObserverProcessLifecycle({
  readyTimeoutMs = 15_000,
  pollMs = 100,
  termTimeoutMs = 1000,
  killTimeoutMs = 1000,
  sleepFn = sleep,
} = {}) {
  let exited = false;
  let closed = false;
  let stopping = false;
  let exitError = null;
  const stderrChunks = [];

  let resolveClose;
  const closePromise = new Promise((res) => {
    resolveClose = res;
  });

  let resolveExitSignal;
  const exitSignalPromise = new Promise((res) => {
    resolveExitSignal = res;
  });

  const markClosed = () => {
    exited = true;
    closed = true;
    resolveClose();
    resolveExitSignal();
  };

  function drainStream(stream) {
    if (!stream) return;
    stream.on?.("error", () => {});
    stream.resume?.();
  }

  function onStderr(chunk) {
    stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  function onError(err) {
    exitError ??= err;
    markClosed();
  }

  function onExit(code, signal) {
    exited = true;
    if (!stopping) {
      if (signal) {
        exitError ??= new Error(
          `native observer exited early with signal ${signal}`,
        );
      } else {
        exitError ??= new Error(
          `native observer exited early with code ${code}`,
        );
      }
    }
    resolveExitSignal();
  }

  function onClose() {
    markClosed();
  }

  function getStderrText() {
    return Buffer.concat(stderrChunks).toString("utf8");
  }

  async function waitForReady({
    readHealth,
    timeoutMs = readyTimeoutMs,
    pollIntervalMs = pollMs,
  }) {
    const deadline = Date.now() + timeoutMs;
    let health = null;
    while (Date.now() < deadline) {
      if (exitError) throw exitError;
      if (exited) {
        throw new Error("native observer exited early before readiness");
      }
      try {
        health = readHealth();
        if (health?.startupSelfTestPassed) return health;
      } catch {}
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await Promise.race([
        sleepFn(Math.min(pollIntervalMs, remaining)),
        exitSignalPromise,
      ]);
    }
    if (exitError) throw exitError;
    const stderrStr = getStderrText();
    throw new Error(
      `observer startup self-test failed or timed out: ${stderrStr || "no stderr"}`,
    );
  }

  async function stop(proc) {
    stopping = true;
    if (!proc || closed) return;
    try {
      if (!exited) {
        try {
          proc.kill("SIGTERM");
        } catch {}
      }
      await raceWithTimeout(closePromise, termTimeoutMs);
      if (!closed) {
        if (!exited) {
          try {
            proc.kill("SIGKILL");
          } catch {}
        }
        await raceWithTimeout(closePromise, killTimeoutMs);
      }
    } catch {}
  }

  return {
    drainStream,
    onStderr,
    onError,
    onExit,
    onClose,
    waitForReady,
    stop,
    getExitError: () => exitError,
    isExited: () => exited,
    isClosed: () => closed,
    getStderrText,
  };
}

function defaultWriteFile(path, content, options) {
  const normalizedOptions =
    typeof options === "number" ? { mode: options } : options;
  writeFileSync(path, content, normalizedOptions);
  const targetMode =
    typeof options === "number" ? options : (options?.mode ?? null);
  if (typeof targetMode === "number") {
    chmodSync(path, targetMode);
  }
}

export async function executeObserverSelftest({
  runId,
  observerDir = "/fixture/observer",
  proxyImageId,
  traefikImageId,
  runtimeReceiptSha256,
  observerLifecycle,
  spawnProcess = spawn,
  readHealth = readNativeObserverHealth,
  writeFile = defaultWriteFile,
  resultPath,
  beginOperation = () => {},
}) {
  assert.ok(runId, "runId is required");
  assert.ok(observerLifecycle, "observerLifecycle is required");
  beginOperation("start_native_observer");
  const observerEnv = {
    ...process.env,
    GWRK_051_OWNED_CONTROLLER: "1",
    GWRK_051_OBSERVER_DIR: observerDir,
    GWRK_051_RUN_ID: runId,
    GWRK_051_PROXY_IMAGE_ID: proxyImageId,
    GWRK_051_TRAEFIK_IMAGE_ID: traefikImageId,
    GWRK_051_RUNTIME_RECEIPT_SHA256: runtimeReceiptSha256,
  };
  const observerProcess = spawnProcess(
    process.execPath,
    ["--max-old-space-size=64", "/fixture/fixtures/native-observer.mjs"],
    {
      stdio: ["ignore", "ignore", "pipe"],
      env: observerEnv,
    },
  );
  observerLifecycle.drainStream(observerProcess.stdout);
  observerProcess.stderr?.on("error", () => {});
  observerProcess.stderr?.on("data", observerLifecycle.onStderr);
  observerProcess.on("error", observerLifecycle.onError);
  observerProcess.once("exit", observerLifecycle.onExit);
  observerProcess.once("close", observerLifecycle.onClose);

  try {
    beginOperation("observer_self_test");
    const health = await observerLifecycle.waitForReady({
      readHealth: () =>
        readHealth({
          observerDir,
          expected: {
            runId,
            proxyImageId,
            traefikImageId,
            runtimeReceiptSha256,
          },
          requireRootOwnership: true,
        }),
    });

    await observerLifecycle.stop(observerProcess);
    if (!observerLifecycle.isClosed()) {
      throw new Error(
        "native observer failed to close cleanly within drain timeout",
      );
    }

    const result = {
      runId,
      passed: true,
      effectiveRcvBufBytes: health?.captureStats?.effectiveRcvBufBytes ?? null,
      ignoreOutgoingKernelEnabled:
        health?.captureStats?.ignoreOutgoingKernelEnabled ?? null,
      pkttypeBpfFallbackActive:
        health?.captureStats?.pkttypeBpfFallbackActive ?? null,
      cleanStopObserved: true,
    };
    const targetResultPath =
      resultPath ?? join(observerDir, "../observer-selftest-result.json");
    writeFile(targetResultPath, JSON.stringify(result, null, 2), 0o600);
    return { observerProcess, health, result };
  } catch (error) {
    await observerLifecycle.stop(observerProcess);
    throw error;
  }
}
