import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
import { PILOT_CASE_INVENTORY } from "./scenario-b-driver.mjs";
import { validateTimingReceipt } from "./syn-gate-policy.mjs";

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

function defaultSpawnSynGateHelper({
  containerId,
  runId,
  hostNetNamespace,
  outerNetNamespace,
}) {
  return spawn(
    "/usr/bin/docker",
    [
      "--host",
      "unix:///var/run/docker.sock",
      "exec",
      "-i",
      "-e",
      `RUN_ID=${runId}`,
      "-e",
      `CONTAINER_LABEL=gwrk.fixture.run=${runId}`,
      "-e",
      "SYN_GATE_DIR=/fixture/syn-gate",
      "-e",
      `HOST_NETNS_INODE=${hostNetNamespace}`,
      "-e",
      `OUTER_NETNS_INODE=${outerNetNamespace}`,
      containerId,
      "bash",
      "/input/fixtures/syn-gate-helper.sh",
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
}

async function stopAndDrainSynGateHelper(helperProc, timeoutMs = 3000) {
  if (!helperProc) return { drained: true, exitCode: 0 };
  let exited = helperProc.exitCode !== null || helperProc.signalCode !== null;
  let exitCode = helperProc.exitCode;
  const exitPromise = exited
    ? Promise.resolve(exitCode)
    : new Promise((resolve) => {
        helperProc.once("close", (code, signal) => {
          exited = true;
          exitCode = code ?? (signal ? 128 : 1);
          resolve(exitCode);
        });
      });

  if (!exited && helperProc.stdin && !helperProc.stdin.destroyed) {
    try {
      helperProc.stdin.write("STOP\n");
      helperProc.stdin.end();
    } catch {}
  }

  const waitWithLimit = (ms) =>
    Promise.race([
      exitPromise,
      new Promise((resolve) => {
        const t = setTimeout(() => resolve("timeout"), ms);
        t.unref?.();
      }),
    ]);

  let outcome = await waitWithLimit(timeoutMs);
  if (outcome === "timeout" && !exited) {
    try {
      helperProc.kill("SIGTERM");
    } catch {}
    outcome = await waitWithLimit(1000);
  }
  if (outcome === "timeout" && !exited) {
    try {
      helperProc.kill("SIGKILL");
    } catch {}
    outcome = await waitWithLimit(1000);
  }
  return {
    drained: exited,
    exitCode: exited ? (exitCode ?? 1) : 124,
  };
}

export async function runNativeFixture({
  runId,
  root,
  receipt,
  images,
  withLifecycle = withOwnedNestedDaemon,
  files = { existsSync, readFileSync, writeFileSync },
  spawnSynGateHelper = defaultSpawnSynGateHelper,
}) {
  const resultPath = `${root}/native-result.json`;
  let resultWritten = false;
  let caseStage = "outer_lifecycle";
  const isObserverSelftest = receipt?.verificationMode === "observer-selftest";
  const runLegacyProof =
    !isObserverSelftest &&
    (receipt?.purpose === "acceptance" || receipt?.includeLegacyProof === true);
  const enableSynGate =
    !isObserverSelftest && receipt?.approvedScenarioBSynGate === true;
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
      executeCases: async ({
        containerId,
        docker,
        spawnDocker,
        signal,
        hostNetNamespace,
        outerNetNamespace,
      }) => {
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
        const imageRoles = runLegacyProof
          ? ["node", "traefik", "proxy", "nginx", "issuerNode"]
          : ["node", "traefik", "proxy"];
        for (const name of imageRoles) {
          ensureActive();
          assert.ok(
            typeof images?.[name] === "string" && images[name].length > 0,
            `missing loaded image identity for role ${name}`,
          );
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
        let synGateHelper = null;
        if (enableSynGate) {
          ensureActive();
          await docker([
            "exec",
            containerId,
            "mkdir",
            "-p",
            "-m",
            "700",
            "/fixture/syn-gate",
          ]);
          await docker([
            "exec",
            containerId,
            "chmod",
            "700",
            "/fixture/syn-gate",
          ]);
          let resolvedHostNetns = hostNetNamespace;
          let resolvedOuterNetns = outerNetNamespace;
          if (
            (!resolvedHostNetns || !resolvedOuterNetns) &&
            files.existsSync(`${root}/namespace-proof.json`)
          ) {
            const nsProof = JSON.parse(
              files.readFileSync(`${root}/namespace-proof.json`, "utf8"),
            );
            resolvedHostNetns ??= nsProof.hostNetNamespace;
            resolvedOuterNetns ??= nsProof.outerNetNamespace;
          }
          assert.ok(
            resolvedHostNetns && resolvedOuterNetns,
            "SYN-gate helper requires verified host and outer network namespace identities",
          );
          assert.notEqual(
            resolvedHostNetns,
            resolvedOuterNetns,
            "SYN-gate helper refuses shared host and outer network namespace",
          );
          synGateHelper = spawnSynGateHelper({
            containerId,
            runId,
            hostNetNamespace: resolvedHostNetns,
            outerNetNamespace: resolvedOuterNetns,
          });
          synGateHelper.stdout?.resume?.();
          synGateHelper.stderr?.resume?.();
        }
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
        if (enableSynGate) {
          controllerArgs.push(
            "--env",
            "GWRK_051_SYN_GATE_DIR=/fixture/syn-gate",
          );
        }
        if (runLegacyProof) {
          controllerArgs.push("--env", "GWRK_051_RUN_LEGACY_PROOF=1");
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
        let result;
        let synGateDrain = { drained: true, exitCode: 0 };
        try {
          result = await spawnDocker(controllerArgs, 360_000);
        } finally {
          if (synGateHelper) {
            synGateDrain = await stopAndDrainSynGateHelper(synGateHelper);
          }
        }
        ensureActive();
        let synGateReceipt = null;
        if (enableSynGate) {
          try {
            const rawSynReceipt = await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/syn-gate/receipt.json",
            ]);
            synGateReceipt = validateTimingReceipt(JSON.parse(rawSynReceipt), {
              expectedRunId: runId,
            });
            files.writeFileSync(
              `${root}/syn-gate-receipt.json`,
              JSON.stringify(synGateReceipt, null, 2),
              { mode: 0o600 },
            );
          } catch (synReceiptError) {
            if (signal?.aborted || synReceiptError?.code === "cancelled") {
              throw synReceiptError;
            }
            if (result.code === 0) {
              throw new FixtureLifecycleError(
                "SYN-gate helper receipt missing or invalid after run",
                {
                  stage: "gateway_cases",
                  category: "gateway_cases_failed",
                  detail:
                    "Bounded SYN-gate helper did not produce a verified rule removal receipt",
                },
              );
            }
          }
          if (result.code === 0) {
            assert.equal(
              synGateDrain.drained,
              true,
              "SYN-gate helper did not drain cleanly before teardown",
            );
            assert.equal(
              synGateDrain.exitCode,
              0,
              `SYN-gate helper exited non-zero: ${synGateDrain.exitCode}`,
            );
            assert.equal(
              synGateReceipt?.ruleRemovedVerified,
              true,
              "SYN-gate rule removal was not verified",
            );
          }
        }
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
          livePilotAcceptance: false,
          nativeSuiteStatus: "failed",
        };
        if (synGateReceipt) {
          safe.synGateReceipt = synGateReceipt;
        }
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
          safe.livePilotAcceptance = false;
          safe.nativeSuiteStatus = "diagnostic_only";
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
        } else if (result.code === 0) {
          try {
            const traefikVersionRaw = await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/traefik-version.json",
            ]);
            safe.traefikVersion = JSON.parse(traefikVersionRaw);
            files.writeFileSync(
              `${root}/traefik-version.json`,
              traefikVersionRaw,
              { mode: 0o600 },
            );
          } catch (verError) {
            if (signal?.aborted || verError?.code === "cancelled") {
              throw verError;
            }
          }

          let pilotRaw = null;
          let pilotParsed = null;
          try {
            pilotRaw = await docker([
              "exec",
              containerId,
              "cat",
              "/fixture/pilot-proof-result.json",
            ]);
            pilotParsed = JSON.parse(pilotRaw);
            files.writeFileSync(`${root}/pilot-proof-result.json`, pilotRaw, {
              mode: 0o600,
            });
          } catch (pilotErr) {
            if (signal?.aborted || pilotErr?.code === "cancelled") {
              throw pilotErr;
            }
            if (receipt?.purpose === "acceptance") {
              throw new FixtureLifecycleError(
                "pilot proof receipt missing or invalid",
                {
                  stage: stage?.stage ?? "gateway_cases",
                  category: "gateway_cases_failed",
                  detail:
                    "Pilot gateway suite did not emit pilot-proof-result.json",
                },
              );
            }
          }

          let legacyRaw = null;
          let legacyParsed = null;
          if (runLegacyProof) {
            try {
              legacyRaw = await docker([
                "exec",
                containerId,
                "cat",
                "/fixture/legacy-proof-result.json",
              ]);
              legacyParsed = JSON.parse(legacyRaw);
              files.writeFileSync(
                `${root}/legacy-proof-result.json`,
                legacyRaw,
                { mode: 0o600 },
              );
            } catch (legacyErr) {
              if (signal?.aborted || legacyErr?.code === "cancelled") {
                throw legacyErr;
              }
              throw new FixtureLifecycleError(
                "legacy proof receipt missing or invalid",
                {
                  stage: stage?.stage ?? "legacy_proof_execution",
                  category: "gateway_cases_failed",
                  detail:
                    "Legacy 041 proof did not emit legacy-proof-result.json",
                },
              );
            }
            assert.equal(
              legacyParsed.exitCode,
              0,
              "legacy proof exitCode must be 0",
            );
            assert.equal(
              legacyParsed.cleanupComplete,
              true,
              "legacy proof cleanupComplete must be true",
            );
            assert.equal(
              legacyParsed.successMarker,
              "Hosted sign-in fixture passed",
              "legacy proof successMarker invalid",
            );
            assert.ok(
              typeof legacyParsed.rawReceipt === "string" &&
                legacyParsed.rawReceipt.includes(
                  "Hosted sign-in fixture passed",
                ),
              "legacy proof rawReceipt missing required success marker",
            );
            safe.legacyProof = {
              exitCode: 0,
              scriptSha256: legacyParsed.scriptSha256,
              successMarker: legacyParsed.successMarker,
              cleanupComplete: true,
              rawReceiptSha256: createHash("sha256")
                .update(legacyParsed.rawReceipt, "utf8")
                .digest("hex"),
            };
          }

          if (pilotParsed) {
            const pilotCases = Array.isArray(pilotParsed.cases)
              ? pilotParsed.cases
              : [];
            assert.equal(
              pilotParsed.nativeSuiteStatus,
              "passed",
              "pilot proof nativeSuiteStatus must be passed",
            );
            assert.equal(
              pilotParsed.livePilotAcceptance,
              false,
              "pilot proof livePilotAcceptance must be false",
            );
            assert.equal(
              pilotParsed.captureDrops,
              0,
              "pilot captureDrops must be 0",
            );
            assert.equal(
              pilotParsed.captureFaults,
              0,
              "pilot captureFaults must be 0",
            );
            assert.equal(
              pilotParsed.leakedSecrets,
              0,
              "pilot leakedSecrets must be 0",
            );
            assert.deepEqual(
              [...pilotCases].sort(),
              [...PILOT_CASE_INVENTORY].sort(),
              "pilot proof cases must match full required case inventory",
            );
            safe.pilotProof = {
              exitCode: 0,
              cases: pilotCases,
              captureDrops: pilotParsed.captureDrops,
              captureFaults: pilotParsed.captureFaults,
              leakedSecrets: pilotParsed.leakedSecrets,
              rawReceiptSha256: createHash("sha256")
                .update(pilotRaw, "utf8")
                .digest("hex"),
            };
          }

          if (
            receipt?.purpose === "acceptance" &&
            receipt?.reviewedSource === true &&
            safe.pilotProof &&
            safe.legacyProof
          ) {
            safe.nativeSuiteStatus = "passed";
            safe.livePilotAcceptance = false;
            safe.positiveAcceptance = false;
          } else {
            safe.nativeSuiteStatus = "diagnostic_only";
            safe.livePilotAcceptance = false;
            safe.positiveAcceptance = false;
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
