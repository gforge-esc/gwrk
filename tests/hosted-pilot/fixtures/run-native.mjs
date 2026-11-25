import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { sanitizeContainerState } from "./bootstrap-diagnostics.mjs";
import { isAllowedFixtureScriptName } from "./bootstrap-observer.mjs";
import {
  buildLifecycleFailureReceipt,
  classifyDockerFailure,
  digestText,
} from "./docker-diagnostics.mjs";
import {
  FixtureLifecycleError,
  withOwnedNestedDaemon,
} from "./nested-lifecycle.mjs";
import { FixtureProcessError } from "./process-scope.mjs";

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
export function sanitizeObserverSelftestResult(raw, expectedRunId) {
  if (!raw || typeof raw !== "object") {
    throw new FixtureLifecycleError(
      "observer selftest result is not an object",
      { category: "observer_startup_failed" },
    );
  }
  if (raw.runId !== expectedRunId) {
    throw new FixtureLifecycleError(
      `observer selftest runId mismatch: ${raw.runId} !== ${expectedRunId}`,
      { category: "observer_startup_failed" },
    );
  }
  if (raw.passed !== true) {
    throw new FixtureLifecycleError(
      "observer selftest result passed flag is not true",
      { category: "observer_startup_failed" },
    );
  }
  if (
    !Number.isSafeInteger(raw.effectiveRcvBufBytes) ||
    raw.effectiveRcvBufBytes < 524288
  ) {
    throw new FixtureLifecycleError(
      `observer selftest effectiveRcvBufBytes insufficient: ${raw.effectiveRcvBufBytes}`,
      { category: "observer_startup_failed" },
    );
  }
  const kernelIgnore =
    raw.kernelIgnoreObserved === true ||
    raw.ignoreOutgoingKernelEnabled === true;
  const bpfFallback =
    raw.bpfFallbackObserved === true || raw.pkttypeBpfFallbackActive === true;
  if (!kernelIgnore && !bpfFallback) {
    throw new FixtureLifecycleError(
      "observer selftest requires kernel ignore or BPF fallback active",
      { category: "observer_startup_failed" },
    );
  }
  if (raw.cleanStopObserved !== true) {
    throw new FixtureLifecycleError(
      "observer selftest clean stop was not observed",
      { category: "observer_startup_failed" },
    );
  }
  const sanitized = {
    runId: expectedRunId,
    passed: true,
    effectiveRcvBufBytes: raw.effectiveRcvBufBytes,
    cleanStopObserved: true,
  };
  if (raw.kernelIgnoreObserved !== undefined) {
    sanitized.kernelIgnoreObserved = raw.kernelIgnoreObserved === true;
  }
  if (raw.ignoreOutgoingKernelEnabled !== undefined) {
    sanitized.ignoreOutgoingKernelEnabled =
      raw.ignoreOutgoingKernelEnabled === true;
  }
  if (raw.bpfFallbackObserved !== undefined) {
    sanitized.bpfFallbackObserved = raw.bpfFallbackObserved === true;
  }
  if (raw.pkttypeBpfFallbackActive !== undefined) {
    sanitized.pkttypeBpfFallbackActive = raw.pkttypeBpfFallbackActive === true;
  }
  return sanitized;
}

export async function runNativeFixture({
  runId,
  root,
  receipt,
  images,
  withLifecycle = withOwnedNestedDaemon,
  files = { existsSync, readFileSync, writeFileSync },
}) {
  const resultPath = `${root}/native-result.json`;
  let resultWritten = false;
  let caseStage = "outer_lifecycle";
  const isObserverSelftest = receipt?.verificationMode === "observer-selftest";
  if (isObserverSelftest) {
    assert.notEqual(
      receipt?.purpose,
      "acceptance",
      "observer-selftest cannot be used under acceptance purpose",
    );
    assert.equal(
      receipt?.purpose,
      "behavioral-red",
      "observer-selftest requires behavioral-red purpose",
    );
  }
  try {
    await withLifecycle({
      runId,
      receipt,
      executeCases: async ({ containerId, docker, spawnDocker, signal }) => {
        const ensureActive = () => {
          if (signal?.aborted) {
            throw new FixtureProcessError("cancelled", true);
          }
        };
        caseStage = "image_preload";
        ensureActive();
        const load = await spawnDocker(
          [
            "exec",
            containerId,
            "docker",
            "--host",
            "unix:///var/run/docker.sock",
            "load",
            "--input",
            "/input/preload-images.tar",
          ],
          240_000,
        );
        ensureActive();
        if (load.code !== 0) {
          const diagnostic = classifyDockerFailure("load", load);
          const stdoutDigest = digestText(load.stdout);
          throw new FixtureLifecycleError(
            "offline preloaded image import failed",
            {
              stage: "image_preload",
              category: diagnostic.category,
              detail: diagnostic.detail,
              operation: "docker_load_preload",
              exitCode: diagnostic.exitCode ?? 1,
              stdoutBytes: stdoutDigest.bytes,
              stderrBytes: diagnostic.stderrBytes,
              stdoutSha256: stdoutDigest.sha256,
              stderrSha256: diagnostic.stderrSha256,
            },
          );
        }
        for (const name of ["node", "traefik", "proxy"]) {
          ensureActive();
          const image = JSON.parse(
            await docker([
              "exec",
              containerId,
              "docker",
              "image",
              "inspect",
              "--format",
              "{{json .}}",
              images[name],
            ]),
          );
          ensureActive();
          assert.equal(
            image.Id,
            images[name],
            "loaded image configuration identity differs",
          );
          assert.deepEqual(
            image.RootFS.Layers,
            images.rootfs[name],
            "loaded image rootfs differs",
          );
        }
        caseStage = "controller_setup";
        ensureActive();
        await docker([
          "exec",
          containerId,
          "mkdir",
          "-p",
          "/fixture",
          "/etc/gwrk",
        ]);
        ensureActive();
        const controller = `gwrk-051-controller-${runId}`;
        files.writeFileSync(
          `${root}/controller-ownership.json`,
          JSON.stringify({
            runId,
            name: controller,
            nestedDaemonOnly: true,
            outerContainer: containerId,
          }),
          { mode: 0o600 },
        );
        caseStage = "controller_execution";
        ensureActive();
        const controllerArgs = [
          "exec",
          containerId,
          "docker",
          "run",
          "--rm",
          "--name",
          controller,
          "--label",
          `gwrk.fixture.run=${runId}`,
          "--pull",
          "never",
          "--network",
          "host",
          "--user",
          "0:0",
          "--cap-drop",
          "ALL",
          "--cap-add",
          "CHOWN",
          "--cap-add",
          "DAC_OVERRIDE",
          "--cap-add",
          "FOWNER",
        ];
        if (receipt?.approvedPassiveNetRaw === true) {
          controllerArgs.push("--cap-add", "NET_RAW");
        }
        controllerArgs.push(
          "--security-opt",
          "no-new-privileges",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=32m",
          "--env",
          "DOCKER_HOST=unix:///var/run/docker.sock",
          "--env",
          "GWRK_051_OWNED_CONTROLLER=1",
          "--env",
          `GWRK_051_RUN_ID=${runId}`,
        );
        if (isObserverSelftest) {
          controllerArgs.push("--env", "GWRK_051_OBSERVER_SELFTEST_ONLY=1");
        }
        controllerArgs.push(
          "--mount",
          "type=bind,source=/input,target=/input,readonly",
          "--mount",
          "type=bind,source=/fixture,target=/fixture",
          "--mount",
          "type=bind,source=/etc/gwrk,target=/etc/gwrk",
          // This is the owned outer daemon's socket. The AWS host socket is never mounted.
          "--mount",
          "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
          images.node,
          "node",
          "/input/fixtures/bootstrap.mjs",
        );
        const result = await spawnDocker(controllerArgs, 360_000);
        ensureActive();
        let stage;
        try {
          stage = JSON.parse(
            await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/bootstrap-stage.json",
            ]),
          );
        } catch (stageError) {
          if (signal?.aborted || stageError?.code === "cancelled") {
            throw stageError;
          }
        }
        ensureActive();
        const safe = {
          runId,
          exitCode: result.code,
          stdoutBytes: Buffer.byteLength(result.stdout),
          stderrBytes: Buffer.byteLength(result.stderr),
          stdoutSha256: createHash("sha256")
            .update(result.stdout)
            .digest("hex"),
          stderrSha256: createHash("sha256")
            .update(result.stderr)
            .digest("hex"),
          nativeBehavioralRed:
            result.code !== 0 && stage?.failureClassification === "behavioral",
          stage: stage?.stage ?? "unavailable",
          fixtureConstructionFailure:
            stage?.failureClassification === "fixture_construction",
          positiveAcceptance: false,
        };
        if (stage?.category) {
          safe.category = stage.category;
        }
        if (stage?.detail) {
          safe.detail = stage.detail;
        }
        if (stage?.operation) {
          safe.operation = stage.operation;
        }
        if (Number.isFinite(stage?.elapsedMs)) {
          safe.elapsedMs = stage.elapsedMs;
        }
        if (stage?.errorCode !== undefined) {
          safe.errorCode = stage.errorCode;
        }
        if (stage?.errorSignal !== undefined) {
          safe.errorSignal = stage.errorSignal;
        }
        if (stage?.exitStatus !== undefined) {
          safe.exitStatus = stage.exitStatus;
        }
        if (
          stage?.createElapsedMs === null ||
          (Number.isFinite(stage?.createElapsedMs) &&
            stage.createElapsedMs >= 0)
        ) {
          safe.createElapsedMs =
            stage.createElapsedMs === null
              ? null
              : Math.round(stage.createElapsedMs);
        }
        if (
          stage?.startElapsedMs === null ||
          (Number.isFinite(stage?.startElapsedMs) && stage.startElapsedMs >= 0)
        ) {
          safe.startElapsedMs =
            stage.startElapsedMs === null
              ? null
              : Math.round(stage.startElapsedMs);
        }
        const safeContainerState = sanitizeContainerState(
          stage?.containerState,
        );
        if (safeContainerState !== null) {
          safe.containerState = safeContainerState;
        }
        if (
          !isObserverSelftest &&
          (safe.createElapsedMs === undefined ||
            safe.startElapsedMs === undefined)
        ) {
          try {
            const timingRaw = await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/origin-timing.json",
            ]);
            const timing = JSON.parse(timingRaw);
            if (
              safe.createElapsedMs === undefined &&
              (timing.createElapsedMs === null ||
                (Number.isFinite(timing.createElapsedMs) &&
                  timing.createElapsedMs >= 0))
            ) {
              safe.createElapsedMs =
                timing.createElapsedMs === null
                  ? null
                  : Math.round(timing.createElapsedMs);
            }
            if (
              safe.startElapsedMs === undefined &&
              (timing.startElapsedMs === null ||
                (Number.isFinite(timing.startElapsedMs) &&
                  timing.startElapsedMs >= 0))
            ) {
              safe.startElapsedMs =
                timing.startElapsedMs === null
                  ? null
                  : Math.round(timing.startElapsedMs);
            }
          } catch (timingError) {
            if (signal?.aborted || timingError?.code === "cancelled") {
              throw timingError;
            }
          }
        }
        if (isObserverSelftest) {
          safe.verificationMode = "observer-selftest";
          safe.diagnosticOnly = true;
          safe.positiveAcceptance = false;
          if (result.code === 0) {
            if (stage?.stage !== "completed_observer_selftest") {
              throw new FixtureLifecycleError(
                "observer selftest completed with invalid bootstrap stage",
                {
                  stage: stage?.stage ?? "unavailable",
                  category: "observer_startup_failed",
                  detail: `Expected stage completed_observer_selftest but observed ${stage?.stage ?? "unavailable"}`,
                },
              );
            }
            let selftestRaw;
            try {
              selftestRaw = await docker([
                "exec",
                containerId,
                "cat",
                "/fixture/observer-selftest-result.json",
              ]);
            } catch (readError) {
              if (signal?.aborted || readError?.code === "cancelled") {
                throw readError;
              }
              throw new FixtureLifecycleError(
                "observer selftest result missing or unreadable",
                {
                  stage: stage?.stage ?? "completed_observer_selftest",
                  category: "observer_startup_failed",
                  detail: "Observer selftest result missing or unreadable",
                },
              );
            }
            let selftestParsed;
            try {
              selftestParsed = JSON.parse(selftestRaw);
            } catch {
              throw new FixtureLifecycleError(
                "observer selftest result malformed",
                {
                  stage: stage?.stage ?? "completed_observer_selftest",
                  category: "observer_startup_failed",
                  detail: "Observer selftest result is not valid JSON",
                },
              );
            }
            safe.observerSelftest = sanitizeObserverSelftestResult(
              selftestParsed,
              runId,
            );
          }
        }
        ensureActive();
        files.writeFileSync(resultPath, JSON.stringify(safe, null, 2), {
          mode: 0o600,
        });
        resultWritten = true;
        assert.equal(
          result.code,
          0,
          "native gateway behavioral assertions failed",
        );
      },
    });
  } catch (error) {
    if (!resultWritten && !files.existsSync(resultPath)) {
      const safe = buildLifecycleFailureReceipt({
        runId,
        error,
        fallbackStage: caseStage,
      });
      if (isObserverSelftest) {
        safe.verificationMode = "observer-selftest";
        safe.diagnosticOnly = true;
        safe.positiveAcceptance = false;
      }
      files.writeFileSync(resultPath, JSON.stringify(safe, null, 2), {
        mode: 0o600,
      });
    }
    throw error;
  }
}

async function main() {
  const receiptPath = process.argv[2];
  assert.match(
    receiptPath ?? "",
    /^\/opt\/gwrk-verification\/[a-f0-9]{24}\/execution-checkpoint\.json$/,
  );
  const metadata = lstatSync(receiptPath);
  assert.equal(metadata.isFile(), true);
  assert.equal(metadata.isSymbolicLink(), false);
  assert.equal(metadata.uid, 0);
  assert.equal(metadata.mode & 0o777, 0o600);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  const runId = receipt.runId;
  assert.equal(
    receiptPath,
    `/opt/gwrk-verification/${runId}/execution-checkpoint.json`,
  );
  const root = `/opt/gwrk-verification/${runId}`;
  const scriptManifestPath = `${root}/input/script-manifest.json`;
  assert.equal(
    await hashFile(scriptManifestPath),
    receipt.scriptManifestSha256,
    "runtime script manifest differs from review",
  );
  const scriptManifest = JSON.parse(readFileSync(scriptManifestPath, "utf8"));
  for (const [name, digest] of Object.entries(scriptManifest)) {
    assert.ok(
      isAllowedFixtureScriptName(name),
      "script manifest entry has invalid filename",
    );
    const path = `${root}/input/fixtures/${name}`;
    const entryMetadata = lstatSync(path);
    assert.ok(
      entryMetadata.isFile() &&
        !entryMetadata.isSymbolicLink() &&
        entryMetadata.uid === 0,
    );
    assert.equal(
      await hashFile(path),
      digest,
      "runtime script differs from review",
    );
  }
  assert.equal(
    await hashFile(`${root}/input/preload-images.tar`),
    receipt.archiveSha256,
    "preload archive hash differs",
  );
  const images = JSON.parse(
    readFileSync(`${root}/input/loaded-images.json`, "utf8"),
  );
  writeFileSync(`${root}/input/runtime-receipt.json`, JSON.stringify(receipt), {
    mode: 0o600,
  });
  await runNativeFixture({ runId, root, receipt, images });
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  existsSync(invokedPath) &&
  realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
) {
  await main();
}
