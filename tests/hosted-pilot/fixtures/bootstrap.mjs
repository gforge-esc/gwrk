import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  chownSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { parse, stringify } from "/app/node_modules/yaml/dist/index.js";
import {
  DEFAULT_DOCKER_TIMEOUT_MS,
  captureDockerLogs,
  classifyBootstrapFailure,
  createAndStartFixtureContainer,
  inspectFixtureContainerState,
} from "./bootstrap-diagnostics.mjs";
import {
  createObserverProcessLifecycle,
  executeObserverSelftest,
  resolveComposeContainer,
} from "./bootstrap-observer.mjs";
import { checkStandardCookieSecret } from "./cookie-format-check.mjs";
import { CLIENT_ID } from "./issuer.mjs";
import { stageLegacyOffline } from "./legacy-offline-stage.mjs";
import { OIDC_FIXTURE_ARGUMENTS } from "./oidc-overrides.mjs";
import { readNativeObserverHealth } from "./raw-https.mjs";

assert.equal(process.env.GWRK_051_OWNED_CONTROLLER, "1");
assert.equal(process.env.DOCKER_HOST, "unix:///var/run/docker.sock");
const run = process.env.GWRK_051_RUN_ID;
assert.match(run ?? "", /^[a-f0-9]{24}$/);
const images = JSON.parse(readFileSync("/input/loaded-images.json", "utf8"));
let runtimeReceiptSha256 = process.env.GWRK_051_RUNTIME_RECEIPT_SHA256 ?? "";
if (existsSync("/input/runtime-receipt.json")) {
  runtimeReceiptSha256 = createHash("sha256")
    .update(readFileSync("/input/runtime-receipt.json"))
    .digest("hex");
}
const owned = [];
function docker(args, options = {}) {
  return execFileSync(
    "/usr/bin/docker",
    ["--host", "unix:///var/run/docker.sock", ...args],
    {
      encoding: "utf8",
      timeout: options.timeout ?? DEFAULT_DOCKER_TIMEOUT_MS,
      maxBuffer: 1048576,
      stdio: options.stdio ?? "pipe",
    },
  );
}
function directory(path, mode = 0o700, uid = 0, gid = 0) {
  mkdirSync(path, { recursive: true, mode });
  chownSync(path, uid, gid);
  chmodSync(path, mode);
}
function file(path, content, mode = 0o600, uid = 0, gid = 0) {
  const numericMode = typeof mode === "number" ? mode : (mode?.mode ?? 0o600);
  writeFileSync(path, content, { mode: numericMode });
  chownSync(path, uid, gid);
  chmodSync(path, numericMode);
}
function openssl(args) {
  execFileSync("openssl", args, { stdio: "pipe", timeout: 20_000 });
}
function certificate(name, subject, altName) {
  const prefix = `/fixture/secrets/${name}`;
  openssl([
    "req",
    "-new",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    `${prefix}-key.pem`,
    "-out",
    `${prefix}.csr`,
    "-subj",
    subject,
  ]);
  file(
    `${prefix}.ext`,
    `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${altName}\n`,
  );
  openssl([
    "x509",
    "-req",
    "-in",
    `${prefix}.csr`,
    "-CA",
    "/fixture/secrets/ca.pem",
    "-CAkey",
    "/fixture/secrets/ca-key.pem",
    "-CAcreateserial",
    "-days",
    "30",
    "-sha256",
    "-extfile",
    `${prefix}.ext`,
    "-out",
    `${prefix}.pem`,
  ]);
  chmodSync(`${prefix}-key.pem`, 0o600);
}
function remember(name) {
  owned.push(name);
  file(
    "/fixture/inner-ownership.json",
    JSON.stringify({
      runId: run,
      containers: owned,
      cleanup: "exact named containers with matching run label only",
    }),
  );
}
let activeContainerName = null;
function runContainer(name, args, options = {}) {
  activeContainerName = name;
  remember(name);
  return createAndStartFixtureContainer(name, args, {
    runId: run,
    ...options,
  });
}
let issuer;
let issuerReady = false;
let originReady = false;
let networkCreated = false;
let stage = "init";
let currentOperation = "init";
let operationStartedAt = Date.now();
const beginOperation = (name) => {
  currentOperation = name;
  operationStartedAt = Date.now();
};
const issuerStderrChunks = [];
let originName = null;
let observerProcess = null;
const observerLifecycle = createObserverProcessLifecycle({
  readyTimeoutMs: 15_000,
  pollMs: 100,
  termTimeoutMs: 1000,
  killTimeoutMs: 1000,
});
const recordStage = () =>
  file("/fixture/bootstrap-stage.json", JSON.stringify({ stage }));
try {
  stage = "staging_directories";
  beginOperation("staging_directories");
  directory("/fixture", 0o755);
  recordStage();
  directory("/fixture/secrets");
  directory("/fixture/public", 0o755);
  directory("/fixture/fixtures", 0o755);
  cpSync("/input/fixtures", "/fixture/fixtures", { recursive: true });
  directory("/fixture/service", 0o700, 10001, 10001);
  directory("/fixture/service-home", 0o700, 10001, 10001);
  directory("/fixture/observer", 0o700, 0, 0);
  directory("/etc/gwrk", 0o755);
  directory("/etc/gwrk/gateway-secrets");
  directory("/etc/gwrk/gateway-secrets/tls");
  directory("/etc/gwrk/secrets", 0o750, 0, 10001);
  directory("/fixture/origin-secrets", 0o750, 0, 10001);

  async function startNativeObserver() {
    stage = "observer_start";
    beginOperation("start_native_observer");
    recordStage();
    const observerEnv = {
      ...process.env,
      GWRK_051_OWNED_CONTROLLER: "1",
      GWRK_051_OBSERVER_DIR: "/fixture/observer",
      GWRK_051_RUN_ID: run,
      GWRK_051_PROXY_IMAGE_ID: images.proxy,
      GWRK_051_TRAEFIK_IMAGE_ID: images.traefik,
      GWRK_051_RUNTIME_RECEIPT_SHA256: runtimeReceiptSha256,
    };
    observerProcess = spawn(
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

    beginOperation("observer_self_test");
    return await observerLifecycle.waitForReady({
      readHealth: () =>
        readNativeObserverHealth({
          observerDir: "/fixture/observer",
          expected: {
            runId: run,
            proxyImageId: images.proxy,
            traefikImageId: images.traefik,
            runtimeReceiptSha256,
          },
          requireRootOwnership: true,
        }),
    });
  }

  if (process.env.GWRK_051_OBSERVER_SELFTEST_ONLY === "1") {
    if (existsSync("/input/runtime-receipt.json")) {
      const receipt = JSON.parse(
        readFileSync("/input/runtime-receipt.json", "utf8"),
      );
      assert.notEqual(
        receipt?.purpose,
        "acceptance",
        "observer-selftest cannot be used under acceptance purpose",
      );
    }
    stage = "observer_start";
    recordStage();
    const selftestResult = await executeObserverSelftest({
      runId: run,
      observerDir: "/fixture/observer",
      proxyImageId: images.proxy,
      traefikImageId: images.traefik,
      runtimeReceiptSha256,
      observerLifecycle,
      writeFile: file,
      resultPath: "/fixture/observer-selftest-result.json",
      beginOperation,
    });
    observerProcess = selftestResult.observerProcess;
    await observerLifecycle.stop(observerProcess);
    assert.equal(
      observerLifecycle.isClosed(),
      true,
      "observer must be cleanly closed before completing selftest",
    );
    stage = "completed_observer_selftest";
    recordStage();
    process.stdout.write(
      "Native observer selftest passed. Diagnostic only; full acceptance remains pending.\n",
    );
  } else {
    stage = "secrets_setup";
    beginOperation("secrets_setup");
    recordStage();
    const csrfHmacKey = `${randomBytes(32).toString("base64url")}\n`;
    file(
      "/etc/gwrk/secrets/google-account-allowlist",
      "allowed@example.invalid\n",
      0o640,
      0,
      10001,
    );
    file("/etc/gwrk/secrets/csrf-hmac-key", csrfHmacKey, 0o640, 0, 10001);
    file(
      "/fixture/origin-secrets/google-account-allowlist",
      "allowed@example.invalid\n",
      0o640,
      0,
      10001,
    );
    file("/fixture/origin-secrets/csrf-hmac-key", csrfHmacKey, 0o640, 0, 10001);
    file(
      "/fixture/service/webhook-secret",
      randomBytes(32).toString("base64url"),
      0o600,
      10001,
      10001,
    );
    const secret = randomBytes(32).toString("base64url");
    file("/fixture/secrets/client-secret", secret);
    file("/etc/gwrk/gateway-secrets/oauth-client-secret", secret);
    // Exercise the pinned proxy's accepted 32-byte base64url cookie-secret file format without trailing newline.
    file(
      "/etc/gwrk/gateway-secrets/oauth-cookie-secret",
      Buffer.alloc(32, 0xfb).toString("base64url"),
    );
    stage = "certificate_generation";
    beginOperation("openssl_generate_certificates");
    recordStage();
    openssl([
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      "/fixture/secrets/ca-key.pem",
      "-out",
      "/fixture/secrets/ca.pem",
      "-days",
      "365",
      "-sha256",
      "-subj",
      "/CN=Gwrk Synthetic Fixture CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    ]);
    chmodSync("/fixture/secrets/ca-key.pem", 0o600);
    certificate("gateway", "/CN=gwrk.gforge.ai", "DNS:gwrk.gforge.ai");
    certificate("issuer", "/CN=127.0.0.1", "IP:127.0.0.1");
    file(
      "/fixture/public/ca.pem",
      readFileSync("/fixture/secrets/ca.pem"),
      0o644,
    );
    file(
      "/fixture/secrets/issuer-fullchain.pem",
      Buffer.concat([
        readFileSync("/fixture/secrets/issuer.pem"),
        readFileSync("/fixture/secrets/ca.pem"),
      ]),
    );
    file(
      "/etc/gwrk/gateway-secrets/tls/fullchain.pem",
      Buffer.concat([
        readFileSync("/fixture/secrets/gateway.pem"),
        readFileSync("/fixture/secrets/ca.pem"),
      ]),
    );
    file(
      "/etc/gwrk/gateway-secrets/tls/privkey.pem",
      readFileSync("/fixture/secrets/gateway-key.pem"),
    );
    stage = "trust_store_update";
    beginOperation("update_ca_certificates");
    recordStage();
    file(
      "/usr/local/share/ca-certificates/gwrk-051-fixture.crt",
      readFileSync("/fixture/public/ca.pem"),
      0o644,
    );
    execFileSync("update-ca-certificates", [], {
      stdio: "pipe",
      timeout: 20_000,
    });
    stage = "issuer_start";
    beginOperation("spawn_issuer");
    recordStage();
    issuer = spawn(process.execPath, ["/fixture/fixtures/issuer.mjs"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    issuerReady = false;
    issuer.stdout.on("data", (chunk) => {
      if (chunk.toString().includes("fixture_issuer_ready")) issuerReady = true;
    });
    issuer.stderr.on("data", (chunk) => {
      issuerStderrChunks.push(chunk);
    });
    stage = "origin_start";
    beginOperation("docker_create_origin");
    recordStage();
    originName = `gwrk-051-origin-${run}`;
    const originTiming = runContainer(
      originName,
      [
        "--network",
        "host",
        "--user",
        "10001:10001",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=32m",
        "--env",
        "HOME=/fixture/service-home",
        ...["/fixture/service", "/fixture/service-home"].flatMap((path) => [
          "--mount",
          `type=bind,source=${path},target=${path}`,
        ]),
        ...["/fixture/fixtures", "/fixture/public"].flatMap((path) => [
          "--mount",
          `type=bind,source=${path},target=${path},readonly`,
        ]),
        "--mount",
        "type=bind,source=/fixture/origin-secrets,target=/etc/gwrk/secrets,readonly",
        images.node,
        "node",
        "/fixture/fixtures/origin.mjs",
      ],
      {
        onPhase: (phase) => {
          beginOperation(
            phase === "start" ? "docker_start_origin" : "docker_create_origin",
          );
        },
      },
    );
    file(
      "/fixture/origin-timing.json",
      JSON.stringify({
        createElapsedMs: originTiming.createElapsedMs,
        startElapsedMs: originTiming.startElapsedMs,
      }),
    );
    stage = "dependencies_wait";
    beginOperation("poll_dependencies_ready");
    recordStage();
    originReady = false;
    const readyDeadline = Date.now() + 20_000;
    while (Date.now() < readyDeadline) {
      originReady = captureDockerLogs(originName).includes(
        "fixture_origin_ready",
      );
      if (originReady && issuerReady) break;
      await sleep(200);
    }
    assert.ok(
      originReady && issuerReady,
      "real origin or synthetic issuer did not become ready",
    );
    stage = "dependencies_ready";
    recordStage();
    stage = "cookie_format";
    beginOperation("cookie_format_check");
    recordStage();
    directory(`/fixture/cookie-format-${run}`);
    const cookieFormat = await checkStandardCookieSecret({
      receipt: JSON.parse(readFileSync("/input/runtime-receipt.json", "utf8")),
      proxyImageId: images.proxy,
      runId: run,
      clientSecretFile: "/fixture/secrets/client-secret",
      caFile: "/fixture/public/ca.pem",
      issuerArguments: OIDC_FIXTURE_ARGUMENTS,
    });
    file("/fixture/cookie-format-result.json", JSON.stringify(cookieFormat));
    await startNativeObserver();
    stage = "bundle_preparation";
    beginOperation("bundle_preparation");
    recordStage();
    directory("/fixture/bundle");
    cpSync("/input/bundle", "/fixture/bundle", { recursive: true });
    file("/fixture/bundle/.env", `GWRK_AUTH_GOOGLE_CLIENT_ID=${CLIENT_ID}\n`);
    if (existsSync("/fixture/bundle/compose.yaml")) {
      const compose = parse(
        readFileSync("/fixture/bundle/compose.yaml", "utf8"),
      );
      assert.deepEqual(Object.keys(compose.services).sort(), [
        "oauth2-proxy",
        "traefik",
      ]);
      for (const name of ["traefik", "oauth2-proxy"]) {
        assert.equal(compose.services[name].network_mode, "host");
        assert.equal(compose.services[name].ports, undefined);
        compose.services[name].image =
          name === "traefik" ? images.traefik : images.proxy;
      }
      const proxy = compose.services["oauth2-proxy"];
      assert.ok(
        Array.isArray(proxy.command),
        "fixture requires explicit proxy command arguments",
      );
      proxy.command.push(...OIDC_FIXTURE_ARGUMENTS);
      proxy.volumes.push({
        type: "bind",
        source: "/fixture/public",
        target: "/fixture/public",
        read_only: true,
        bind: { create_host_path: false },
      });
      file("/fixture/bundle/compose.yaml", stringify(compose));
    }
    // This real startup invocation must fail the test while the production bundle is absent.
    // No file-existence assertion substitutes for the native launch and readiness behavior.
    stage = "gateway_startup";
    beginOperation("run_gateway_startup");
    recordStage();
    try {
      const traefikVersionOut = docker(
        [
          "run",
          "--rm",
          "--pull",
          "never",
          "--network",
          "none",
          images.traefik,
          "version",
        ],
        { timeout: 15_000 },
      );
      const goMatch = /Go version:\s*(\S+)/i.exec(traefikVersionOut);
      const verMatch = /Version:\s*(\S+)/i.exec(traefikVersionOut);
      file(
        "/fixture/traefik-version.json",
        JSON.stringify({
          traefikVersion: verMatch?.[1] ?? "unknown",
          goVersion: goMatch?.[1] ?? "unknown",
        }),
      );
    } catch {}
    execFileSync("bash", ["/fixture/bundle/run.sh"], {
      stdio: "pipe",
      timeout: 30_000,
    });
    const traefikContainer = resolveComposeContainer(docker, "traefik");
    const proxyContainer = resolveComposeContainer(docker, "oauth2-proxy");
    stage = "client_network";
    beginOperation("docker_create_client_network");
    recordStage();
    const network = "gwrk-051-clients";
    docker([
      "network",
      "create",
      "--internal",
      "--subnet",
      "172.31.51.0/24",
      "--gateway",
      "172.31.51.1",
      "--label",
      `gwrk.fixture.run=${run}`,
      network,
    ]);
    networkCreated = true;
    for (const [letter, address] of [
      ["a", "172.31.51.11"],
      ["b", "172.31.51.12"],
    ]) {
      beginOperation(`docker_create_client_${letter}`);
      runContainer(
        `gwrk-051-client-${letter}-${run}`,
        [
          "--network",
          network,
          "--ip",
          address,
          "--user",
          "10002:10002",
          "--cap-drop",
          "ALL",
          "--security-opt",
          "no-new-privileges",
          "--read-only",
          "--tmpfs",
          "/tmp:rw,noexec,nosuid,size=16m",
          ...["/fixture/fixtures", "/fixture/public"].flatMap((path) => [
            "--mount",
            `type=bind,source=${path},target=${path},readonly`,
          ]),
          images.node,
          "node",
          "-e",
          "setInterval(()=>{},1000)",
        ],
        {
          onPhase: (phase) => {
            beginOperation(
              phase === "start"
                ? `docker_start_client_${letter}`
                : `docker_create_client_${letter}`,
            );
          },
        },
      );
    }
    stage = "gateway_cases";
    beginOperation("execute_gateway_cases");
    recordStage();
    const casesEnv = {
      PATH: process.env.PATH,
      HOME: "/root",
      DOCKER_HOST: "unix:///var/run/docker.sock",
      GWRK_051_OWNED_CONTROLLER: "1",
      GWRK_051_CLIENT_A: `gwrk-051-client-a-${run}`,
      GWRK_051_CLIENT_B: `gwrk-051-client-b-${run}`,
      GWRK_051_RUN_ID: run,
      GWRK_051_PROXY_IMAGE_ID: images.proxy,
      GWRK_051_TRAEFIK_IMAGE_ID: images.traefik,
      GWRK_051_RUNTIME_RECEIPT_SHA256: runtimeReceiptSha256,
      GWRK_051_TRAEFIK_CONTAINER: traefikContainer,
      GWRK_051_PROXY_CONTAINER: proxyContainer,
      GWRK_051_ORIGIN_CONTAINER: originName,
      GWRK_051_OBSERVER_DIR: "/fixture/observer",
      GWRK_051_PILOT_RESULT_PATH: "/fixture/pilot-proof-result.json",
    };
    if (process.env.GWRK_051_SYN_GATE_DIR) {
      casesEnv.GWRK_051_SYN_GATE_DIR = process.env.GWRK_051_SYN_GATE_DIR;
    }
    execFileSync(process.execPath, ["/fixture/fixtures/gateway-cases.mjs"], {
      stdio: "pipe",
      timeout: 300_000,
      env: casesEnv,
    });

    if (process.env.GWRK_051_RUN_LEGACY_PROOF === "1") {
      // Tear down pilot services cleanly before running unchanged legacy 041 proof on shared ports.
      issuer?.kill("SIGTERM");
      issuer = null;
      beginOperation("stop_native_observer");
      await observerLifecycle.stop(observerProcess);
      observerProcess = null;
      try {
        docker(
          [
            "compose",
            "-p",
            "gwrk-hosted-pilot",
            "-f",
            "/fixture/bundle/compose.yaml",
            "down",
            "--remove-orphans",
          ],
          { timeout: 30_000 },
        );
      } catch {}
      for (const name of owned.splice(0).reverse()) {
        let labels;
        try {
          labels = JSON.parse(
            docker(["inspect", "--format", "{{json .Config.Labels}}", name]),
          );
        } catch {}
        if (labels?.["gwrk.fixture.run"] === run) {
          docker(["rm", "--force", name]);
        }
      }
      if (networkCreated) {
        docker(["network", "rm", "gwrk-051-clients"]);
        networkCreated = false;
      }

      stage = "legacy_proof_staging";
      beginOperation("stage_legacy_proof");
      recordStage();
      const stageResult = await stageLegacyOffline({
        sourceRoot: "/input/legacy-source",
        destinationRoot: "/fixture/legacy-source",
        loadedImages: {
          traefik: {
            imageId: images.traefik,
            rootfsLayers: images.rootfs.traefik,
          },
          proxy: {
            imageId: images.proxy,
            rootfsLayers: images.rootfs.proxy,
          },
          nginx: {
            imageId: images.nginx,
            rootfsLayers: images.rootfs.nginx,
          },
          issuerNode: {
            imageId: images.issuerNode,
            rootfsLayers: images.rootfs.issuerNode,
          },
        },
        inspectPort: (imageId) =>
          JSON.parse(
            docker(["image", "inspect", "--format", "{{json .}}", imageId]),
          ),
        tmpdir: "/fixture/legacy-tmp",
        sharedMountPath: "/fixture",
      });

      stage = "legacy_proof_execution";
      beginOperation("execute_legacy_proof");
      recordStage();
      const legacyOutput = execFileSync(
        process.execPath,
        [stageResult.stagedScriptPath],
        {
          cwd: stageResult.stagedSourceRoot,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 180_000,
          maxBuffer: 4 * 1024 * 1024,
          env: {
            PATH: process.env.PATH,
            HOME: "/root",
            DOCKER_HOST: "unix:///var/run/docker.sock",
            TMPDIR: stageResult.env.TMPDIR,
          },
        },
      );
      assert.ok(
        legacyOutput.includes("Hosted sign-in fixture passed"),
        "unchanged legacy gateway-proof.mjs output missing required success marker",
      );
      const controllerName = `gwrk-051-controller-${run}`;
      const remainingAfterLegacy = docker([
        "ps",
        "-a",
        "--format",
        "{{.Names}}",
      ])
        .split("\n")
        .map((line) => line.trim())
        .filter((name) => name.length > 0 && name !== controllerName);
      assert.deepEqual(
        remainingAfterLegacy,
        [],
        `legacy 041 proof left behind uncleaned containers: ${remainingAfterLegacy.join(", ")}`,
      );
      file(
        "/fixture/legacy-proof-result.json",
        JSON.stringify({
          exitCode: 0,
          scriptSha256:
            stageResult.originalHashes[
              "tests/hosted-auth-proof/gateway-proof.mjs"
            ],
          originalHashes: stageResult.originalHashes,
          stagedHashes: stageResult.stagedHashes,
          locatorMap: stageResult.locatorMap,
          successMarker: "Hosted sign-in fixture passed",
          cleanupComplete: true,
          rawReceipt: legacyOutput,
        }),
      );
      stage = "completed_combined_proofs";
      recordStage();
      process.stdout.write(
        "Native combined pilot and legacy proofs passed. Live pilot acceptance remains false.\n",
      );
    } else {
      stage = "completed_initial_cases";
      recordStage();
      process.stdout.write(
        "Native gateway initial cases passed. Full acceptance remains pending.\n",
      );
    }
  }
} catch (error) {
  const elapsedMs = operationStartedAt ? Date.now() - operationStartedAt : 0;
  let originLogs = "";
  let containerState = null;
  const inspectTarget = activeContainerName ?? originName;
  if (inspectTarget) {
    try {
      containerState = inspectFixtureContainerState(inspectTarget);
    } catch {}
  }
  if (originName) {
    try {
      originLogs = captureDockerLogs(originName);
    } catch {}
  }
  const diagnostic = classifyBootstrapFailure(stage, error, {
    issuerStderr: Buffer.concat(issuerStderrChunks).toString("utf8"),
    originLogs,
    originReady,
    issuerReady,
    operation: currentOperation,
    elapsedMs,
    containerState,
  });
  file(
    "/fixture/bootstrap-stage.json",
    JSON.stringify({
      stage: diagnostic.stage,
      failureClassification: diagnostic.failureClassification,
      category: diagnostic.category,
      detail: diagnostic.detail,
      stderrSha256: diagnostic.stderrSha256,
      stderrBytes: diagnostic.stderrBytes,
      exitCode: diagnostic.exitCode,
      exitStatus: diagnostic.exitStatus,
      errorCode: diagnostic.errorCode,
      errorSignal: diagnostic.errorSignal,
      operation: diagnostic.operation,
      elapsedMs: diagnostic.elapsedMs,
      ...(diagnostic.createElapsedMs !== undefined
        ? { createElapsedMs: diagnostic.createElapsedMs }
        : {}),
      ...(diagnostic.startElapsedMs !== undefined
        ? { startElapsedMs: diagnostic.startElapsedMs }
        : {}),
      ...(diagnostic.containerState !== undefined
        ? { containerState: diagnostic.containerState }
        : {}),
    }),
  );
  process.stderr.write(
    "Native gateway behavior is RED. No production acceptance recorded.\n",
  );
  process.exitCode = 1;
} finally {
  issuer?.kill("SIGTERM");
  beginOperation("stop_native_observer");
  await observerLifecycle.stop(observerProcess);
  try {
    rmSync("/fixture/observer", { recursive: true, force: true });
  } catch {}
  try {
    docker(
      [
        "compose",
        "-p",
        "gwrk-hosted-pilot",
        "-f",
        "/fixture/bundle/compose.yaml",
        "down",
        "--remove-orphans",
      ],
      { timeout: 30_000 },
    );
  } catch {}
  for (const name of owned.reverse()) {
    let labels;
    try {
      labels = JSON.parse(
        docker(["inspect", "--format", "{{json .Config.Labels}}", name]),
      );
    } catch {}
    if (labels?.["gwrk.fixture.run"] === run) docker(["rm", "--force", name]);
  }
  if (networkCreated) docker(["network", "rm", "gwrk-051-clients"]);
}
