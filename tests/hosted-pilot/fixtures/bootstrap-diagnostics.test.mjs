import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "vitest";
import {
  BOOTSTRAP_STAGES,
  CONTAINER_CONSTRUCTION_TIMEOUT_MS,
  DEFAULT_DOCKER_TIMEOUT_MS,
  STATIC_CONSTRUCTION_CATEGORIES,
  STATIC_OPERATION_NAMES,
  WHITELISTED_CONTAINER_STATUSES,
  WHITELISTED_ERROR_CODES,
  WHITELISTED_SIGNALS,
  captureDockerLogs,
  classifyBootstrapFailure,
  createAndStartFixtureContainer,
  inspectFixtureContainerState,
  runFixtureContainer,
} from "./bootstrap-diagnostics.mjs";

test("declares ordered granular bootstrap stages", () => {
  assert.ok(BOOTSTRAP_STAGES.includes("staging_directories"));
  assert.ok(BOOTSTRAP_STAGES.includes("secrets_setup"));
  assert.ok(BOOTSTRAP_STAGES.includes("certificate_generation"));
  assert.ok(BOOTSTRAP_STAGES.includes("trust_store_update"));
  assert.ok(BOOTSTRAP_STAGES.includes("issuer_start"));
  assert.ok(BOOTSTRAP_STAGES.includes("origin_start"));
  assert.ok(BOOTSTRAP_STAGES.includes("dependencies_wait"));
  assert.ok(BOOTSTRAP_STAGES.includes("dependencies_ready"));
  assert.ok(BOOTSTRAP_STAGES.includes("cookie_format"));
  assert.ok(BOOTSTRAP_STAGES.includes("bundle_preparation"));
  assert.ok(BOOTSTRAP_STAGES.includes("gateway_startup"));
  assert.ok(BOOTSTRAP_STAGES.includes("gateway_cases"));
});

test("declares whitelisted error codes, signals, and static operation names", () => {
  assert.ok(WHITELISTED_ERROR_CODES.includes("ETIMEDOUT"));
  assert.ok(WHITELISTED_ERROR_CODES.includes("ENOENT"));
  assert.ok(WHITELISTED_SIGNALS.includes("SIGTERM"));
  assert.ok(WHITELISTED_SIGNALS.includes("SIGKILL"));
  assert.ok(STATIC_OPERATION_NAMES.includes("docker_run_origin"));
  assert.ok(STATIC_OPERATION_NAMES.includes("poll_dependencies_ready"));
});

test("classifies certificate generation failure as fixture_construction", () => {
  const result = classifyBootstrapFailure("certificate_generation", {
    message: "Command failed: openssl req -new -newkey rsa:2048",
    status: 1,
    stderr: "error in req: unable to write 'random state'",
  });
  assert.equal(result.stage, "certificate_generation");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.category, "certificate_generation_failed");
  assert.equal(result.detail, "OpenSSL certificate generation failed");
  assert.equal(result.exitCode, 1);
  assert.match(result.stderrSha256, /^[a-f0-9]{64}$/);
});

test("classifies trust store update failure as fixture_construction", () => {
  const result = classifyBootstrapFailure("trust_store_update", {
    message: "Command failed: update-ca-certificates",
    status: 2,
    stderr: "update-ca-certificates: failed to install certificates",
  });
  assert.equal(result.stage, "trust_store_update");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.category, "trust_store_update_failed");
  assert.equal(result.detail, "System trust store update failed");
  assert.equal(result.exitCode, 2);
});

test("classifies filesystem permission error", () => {
  const result = classifyBootstrapFailure("staging_directories", {
    code: "EACCES",
    message: "EACCES: permission denied, mkdir '/fixture/secrets'",
  });
  assert.equal(result.category, "filesystem_permission");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(
    result.detail,
    "Filesystem permission denied during fixture setup",
  );
});

test("classifies missing file error", () => {
  const result = classifyBootstrapFailure("staging_directories", {
    code: "ENOENT",
    message: "ENOENT: no such file or directory, cpSync '/input/fixtures'",
  });
  assert.equal(result.category, "filesystem_missing");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.detail, "Required fixture file or directory is missing");
});

test("classifies storage or quota exhaustion", () => {
  const result = classifyBootstrapFailure("secrets_setup", {
    code: "ENOSPC",
    message: "ENOSPC: no space left on device, write",
  });
  assert.equal(result.category, "filesystem_storage");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(
    result.detail,
    "Storage or quota exhausted during fixture setup",
  );
});

test("classifies issuer startup failure from in-memory stderr", () => {
  const result = classifyBootstrapFailure(
    "issuer_start",
    new Error("issuer exited"),
    {
      issuerStderr: "Error: Cannot find module '/fixture/fixtures/issuer.mjs'",
    },
  );
  assert.equal(result.category, "issuer_startup_failed");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.detail, "Synthetic OIDC issuer failed to start");
});

test("classifies origin container launch failure from in-memory logs", () => {
  const result = classifyBootstrapFailure(
    "origin_start",
    new Error("docker run failed"),
    {
      originLogs: "docker: Error response from daemon: cannot start container",
    },
  );
  assert.equal(result.category, "origin_launch_failed");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.detail, "Origin service container failed to launch");
});

test("classifies dependency readiness timeout as fixture_construction", () => {
  const result = classifyBootstrapFailure(
    "dependencies_wait",
    new Error("real origin or synthetic issuer did not become ready"),
  );
  assert.equal(result.category, "dependency_timeout");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(
    result.detail,
    "Fixture dependencies did not become ready within timeout",
  );
});

test("classifies gateway startup failure as behavioral", () => {
  const result = classifyBootstrapFailure("gateway_startup", {
    message: "Command failed: bash /fixture/bundle/run.sh",
    status: 127,
    stderr: "bash: /fixture/bundle/run.sh: No such file or directory",
  });
  assert.equal(result.stage, "gateway_startup");
  assert.equal(result.failureClassification, "behavioral");
  assert.equal(result.category, "gateway_startup_failed");
  assert.equal(result.detail, "Gateway startup script execution failed");
  assert.equal(result.exitCode, 127);
});

test("classifies gateway cases failure as behavioral", () => {
  const result = classifyBootstrapFailure("gateway_cases", {
    message: "gateway assertions failed",
    status: 1,
  });
  assert.equal(result.stage, "gateway_cases");
  assert.equal(result.failureClassification, "behavioral");
  assert.equal(result.category, "gateway_cases_failed");
});

test("classifies cookie format failure as fixture_input_format", () => {
  const result = classifyBootstrapFailure(
    "cookie_format",
    new Error("cookie secret validation failed"),
  );
  assert.equal(result.stage, "cookie_format");
  assert.equal(result.failureClassification, "fixture_input_format");
  assert.equal(result.category, "fixture_cookie_format_invalid");
});

test("never reflects secrets, tokens, or private keys into diagnostic receipt", () => {
  const canary = "SUPER_SECRET_SYNTHETIC_TOKEN_xyz123";
  const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...";
  const result = classifyBootstrapFailure("certificate_generation", {
    message: `failed with token ${canary}`,
    stderr: `raw dump: ${privateKey}\nmore data`,
    status: 1,
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(canary), false);
  assert.equal(serialized.includes("PRIVATE KEY"), false);
  assert.ok(serialized.length < 512);
  assert.ok(STATIC_CONSTRUCTION_CATEGORIES.includes(result.category));
});

test("classifies origin crash during dependencies_wait as origin_launch_failed rather than issuer_startup_failed", () => {
  const result = classifyBootstrapFailure(
    "dependencies_wait",
    new Error("real origin or synthetic issuer did not become ready"),
    {
      issuerStderr: "",
      originLogs: "Error: fixture origin service identity differs\n",
    },
  );
  assert.equal(result.stage, "dependencies_wait");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.category, "origin_launch_failed");
});

test("classifies bundle_preparation failure as bundle_preparation_failed despite healthy origin readiness logs", () => {
  const result = classifyBootstrapFailure(
    "bundle_preparation",
    new Error("YAMLParseError: unexpected end of stream"),
    {
      issuerStderr: "",
      originLogs: '{"event":"fixture_origin_ready","port":18790}\n',
    },
  );
  assert.equal(result.stage, "bundle_preparation");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.category, "bundle_preparation_failed");
});

test("classifies client_network docker failure as docker_command_failed despite healthy origin readiness logs", () => {
  const result = classifyBootstrapFailure(
    "client_network",
    {
      message: "Command failed: /usr/bin/docker network create",
      stderr: "Error response from daemon: Pool overlaps with other one",
      status: 1,
    },
    {
      issuerStderr: "",
      originLogs: '{"event":"fixture_origin_ready","port":18790}\n',
    },
  );
  assert.equal(result.stage, "client_network");
  assert.equal(result.failureClassification, "fixture_construction");
  assert.equal(result.category, "docker_command_failed");
});

test("captures container logs in memory via bounded piped spawnSync without inheriting stderr", () => {
  const canary = "SYNTHETIC_CANARY_CONTAINER_STDERR_secret123";
  const direct = captureDockerLogs("origin-test", {
    command: process.execPath,
    args: [
      "-e",
      `process.stderr.write("uncaught container exception: ${canary}\\n"); process.stdout.write("fixture_origin_ready\\n");`,
    ],
  });
  assert.ok(direct.includes("fixture_origin_ready"), "must capture stdout");
  assert.ok(direct.includes(canary), "must capture stderr in memory");

  const probeScript = `
    import assert from "node:assert/strict";
    import { captureDockerLogs } from "./bootstrap-diagnostics.mjs";
    const logs = captureDockerLogs("probe", {
      command: process.execPath,
      args: ["-e", "process.stderr.write('${canary}\\\\n'); process.stdout.write('ready\\\\n');"],
    });
    assert.ok(logs.includes("${canary}"));
    process.stdout.write("PROBE_OK");
  `;
  const probeResult = spawnSync(
    process.execPath,
    ["--input-type=module", "-e", probeScript],
    {
      cwd: new URL(".", import.meta.url).pathname,
      stdio: "pipe",
      encoding: "utf8",
    },
  );
  assert.equal(probeResult.status, 0);
  assert.equal(probeResult.stdout, "PROBE_OK");
  assert.equal(
    probeResult.stderr.includes(canary),
    false,
    "raw container stderr must not be inherited to process.stderr",
  );
  assert.equal(probeResult.stderr, "");
});

test("captures whitelisted error code, signal, exit status, operation, and elapsedMs for child process timeout", () => {
  let timeoutError;
  try {
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 5000)"], {
      timeout: 50,
      stdio: "pipe",
    });
  } catch (err) {
    timeoutError = err;
  }
  assert.ok(timeoutError, "must produce actual timeout error");
  assert.equal(timeoutError.code, "ETIMEDOUT");

  const result = classifyBootstrapFailure("origin_start", timeoutError, {
    operation: "docker_run_origin",
    elapsedMs: 52,
  });

  assert.equal(result.operation, "docker_run_origin");
  assert.equal(result.elapsedMs, 52);
  assert.equal(result.errorCode, "ETIMEDOUT");
  assert.equal(result.errorSignal, "SIGTERM");
  assert.equal(result.exitStatus, null);
  assert.equal(result.exitCode, 1);
});

test("sanitizes non-whitelisted error codes, signals, and operations to safe defaults", () => {
  const result = classifyBootstrapFailure(
    "origin_start",
    {
      code: "SENSITIVE_SECRET_ERR_XYZ",
      signal: "SIGUNEXPECTED_CUSTOM",
      status: 125,
      message: "docker failed with secret token",
    },
    {
      operation: "UNREGISTERED_ARBITRARY_CMD",
      elapsedMs: 12.8,
    },
  );
  assert.equal(result.operation, "unknown_operation");
  assert.equal(result.elapsedMs, 13);
  assert.equal(result.errorCode, null);
  assert.equal(result.errorSignal, null);
  assert.equal(result.exitStatus, 125);
  assert.equal(result.exitCode, 125);
});

test("declares bounded container construction allowance and generic docker defaults", () => {
  assert.equal(DEFAULT_DOCKER_TIMEOUT_MS, 30_000);
  assert.equal(CONTAINER_CONSTRUCTION_TIMEOUT_MS, 60_000);
  assert.ok(CONTAINER_CONSTRUCTION_TIMEOUT_MS > DEFAULT_DOCKER_TIMEOUT_MS);
  assert.ok(CONTAINER_CONSTRUCTION_TIMEOUT_MS <= 360_000);
  assert.ok(CONTAINER_CONSTRUCTION_TIMEOUT_MS <= 600_000);
});

test("behavioral regression: delayed container creation fails under short deadline and succeeds with container construction allowance", () => {
  const runId = "a".repeat(24);
  const containerName = `gwrk-051-origin-${runId}`;
  const script =
    'setTimeout(() => { process.stdout.write("1122334455667788\\n"); }, 120);';

  let creationError;
  try {
    runFixtureContainer(containerName, ["node", "-e", script], {
      command: process.execPath,
      args: ["-e", script],
      timeout: 40,
      runId,
    });
  } catch (err) {
    creationError = err;
  }

  assert.ok(creationError, "must time out under short deadline");
  assert.equal(creationError.code, "ETIMEDOUT");

  const result = classifyBootstrapFailure("origin_start", creationError, {
    operation: "docker_run_origin",
    elapsedMs: 45,
  });
  assert.equal(result.stage, "origin_start");
  assert.equal(result.category, "origin_launch_failed");
  assert.equal(result.detail, "Origin service container failed to launch");
  assert.equal(result.operation, "docker_run_origin");
  assert.equal(result.errorCode, "ETIMEDOUT");
  assert.equal(result.exitCode, 1);
  assert.equal(result.failureClassification, "fixture_construction");

  const containerId = runFixtureContainer(
    containerName,
    ["node", "-e", script],
    {
      command: process.execPath,
      args: ["-e", script],
      timeout: 300,
      runId,
    },
  );
  assert.equal(containerId, "1122334455667788");
});

test("applies identical container construction allowance and labeling to origin and client containers", () => {
  const runId = "b".repeat(24);
  const operations = [];
  const fakeRunner = (cmd, args, options) => {
    operations.push({ cmd, args, options });
    return "fake-container-id-1234\n";
  };

  const originId = runFixtureContainer(
    `gwrk-051-origin-${runId}`,
    ["images.node", "node", "/fixture/fixtures/origin.mjs"],
    { runner: fakeRunner, runId },
  );
  assert.equal(originId, "fake-container-id-1234");

  const clientAId = runFixtureContainer(
    `gwrk-051-client-a-${runId}`,
    ["images.node", "node", "-e", "setInterval(()=>{},1000)"],
    { runner: fakeRunner, runId },
  );
  assert.equal(clientAId, "fake-container-id-1234");

  const clientBId = runFixtureContainer(
    `gwrk-051-client-b-${runId}`,
    ["images.node", "node", "-e", "setInterval(()=>{},1000)"],
    { runner: fakeRunner, runId },
  );
  assert.equal(clientBId, "fake-container-id-1234");

  assert.equal(operations.length, 3);
  for (const op of operations) {
    assert.equal(op.options.timeout, CONTAINER_CONSTRUCTION_TIMEOUT_MS);
    assert.ok(op.args.includes("--label"));
    assert.ok(op.args.includes(`gwrk.fixture.run=${runId}`));
    assert.ok(op.args.includes("--pull"));
    assert.ok(op.args.includes("never"));
  }
});

test("distinguishes docker create from docker start inside the frozen 60s construction budget", () => {
  assert.ok(STATIC_OPERATION_NAMES.includes("docker_create_origin"));
  assert.ok(STATIC_OPERATION_NAMES.includes("docker_start_origin"));
  assert.ok(WHITELISTED_CONTAINER_STATUSES.includes("created"));
  assert.ok(WHITELISTED_CONTAINER_STATUSES.includes("running"));
  assert.ok(WHITELISTED_CONTAINER_STATUSES.includes("missing"));

  const runId = "c".repeat(24);
  const calls = [];
  const phases = [];
  let clock = 1000;
  const fakeRunner = (_cmd, args, options) => {
    calls.push({ args, timeout: options.timeout });
    if (args.includes("create")) {
      clock += 1200;
      return "abcdef123456\n";
    }
    if (args.includes("start")) {
      clock += 350;
      return "abcdef123456\n";
    }
    throw new Error(`unexpected args: ${args.join(" ")}`);
  };

  const result = createAndStartFixtureContainer(
    `gwrk-051-origin-${runId}`,
    ["sha256:node", "node", "/fixture/fixtures/origin.mjs"],
    {
      runner: fakeRunner,
      runId,
      now: () => clock,
      onPhase: (phase) => phases.push(phase),
    },
  );

  assert.equal(result.containerId, "abcdef123456");
  assert.equal(result.createElapsedMs, 1200);
  assert.equal(result.startElapsedMs, 350);
  assert.deepEqual(phases, ["create", "start"]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[2], "create");
  assert.equal(calls[0].timeout, CONTAINER_CONSTRUCTION_TIMEOUT_MS);
  assert.equal(calls[1].args[2], "start");
  assert.equal(calls[1].timeout, CONTAINER_CONSTRUCTION_TIMEOUT_MS - 1200);
  assert.equal(calls[0].args.includes("run"), false);
  assert.ok(calls[0].args.includes("--pull"));
  assert.ok(calls[0].args.includes("never"));
  assert.ok(calls[0].args.includes(`gwrk.fixture.run=${runId}`));
});

test("records create timeout separately and skips docker start when create exhausts budget", () => {
  const runId = "d".repeat(24);
  const calls = [];
  let clock = 5000;
  const fakeRunner = (_cmd, args) => {
    calls.push(args[2]);
    clock += CONTAINER_CONSTRUCTION_TIMEOUT_MS;
    const err = new Error("create timed out");
    err.code = "ETIMEDOUT";
    err.status = 143;
    throw err;
  };

  let caught;
  try {
    createAndStartFixtureContainer(
      `gwrk-051-origin-${runId}`,
      ["sha256:node", "node", "/fixture/fixtures/origin.mjs"],
      { runner: fakeRunner, runId, now: () => clock },
    );
  } catch (err) {
    caught = err;
  }

  assert.ok(caught);
  assert.equal(caught.code, "ETIMEDOUT");
  assert.equal(caught.containerPhase, "create");
  assert.equal(caught.createElapsedMs, CONTAINER_CONSTRUCTION_TIMEOUT_MS);
  assert.equal(caught.startElapsedMs, null);
  assert.deepEqual(calls, ["create"]);
});

test("records start timeout separately with measured create and start elapsed times", () => {
  const runId = "e".repeat(24);
  let clock = 10_000;
  let seenStartTimeout = null;
  const fakeRunner = (_cmd, args, options) => {
    if (args[2] === "create") {
      clock += 42_000;
      return "cid-999\n";
    }
    seenStartTimeout = options.timeout;
    clock += 18_000;
    const err = new Error("start timed out");
    err.code = "ETIMEDOUT";
    err.status = 143;
    throw err;
  };

  let caught;
  try {
    createAndStartFixtureContainer(
      `gwrk-051-origin-${runId}`,
      ["sha256:node", "node", "/fixture/fixtures/origin.mjs"],
      { runner: fakeRunner, runId, now: () => clock },
    );
  } catch (err) {
    caught = err;
  }

  assert.ok(caught);
  assert.equal(seenStartTimeout, CONTAINER_CONSTRUCTION_TIMEOUT_MS - 42_000);
  assert.equal(caught.containerPhase, "start");
  assert.equal(caught.createElapsedMs, 42_000);
  assert.equal(caught.startElapsedMs, 18_000);
});

test("inspectFixtureContainerState projects only safe whitelisted fields and never leaks secrets", () => {
  const canary = "SECRET_INSPECT_ERROR_CANARY_999";
  const createdState = inspectFixtureContainerState("gwrk-051-origin-test", {
    runner: () => ({
      status: 0,
      stdout: JSON.stringify({
        Status: "created",
        Running: false,
        OOMKilled: false,
        ExitCode: 0,
        Pid: 0,
        Error: `leak ${canary}`,
      }),
      stderr: "",
    }),
  });
  assert.deepEqual(createdState, {
    containerExists: true,
    containerStatus: "created",
    oomKilled: false,
    containerExitCode: 0,
    containerPid: 0,
  });
  assert.equal(JSON.stringify(createdState).includes(canary), false);

  const missingState = inspectFixtureContainerState("gwrk-051-origin-missing", {
    runner: () => ({
      status: 1,
      stdout: "",
      stderr: `No such object: ${canary}`,
    }),
  });
  assert.deepEqual(missingState, {
    containerExists: false,
    containerStatus: "missing",
    oomKilled: null,
    containerExitCode: null,
    containerPid: null,
  });
  assert.equal(JSON.stringify(missingState).includes(canary), false);

  const classified = classifyBootstrapFailure(
    "origin_start",
    { code: "ETIMEDOUT", status: 143, message: `boom ${canary}` },
    {
      operation: "docker_create_origin",
      elapsedMs: 60010,
      createElapsedMs: 60010,
      startElapsedMs: null,
      containerState: {
        ...createdState,
        containerStatus: `evil_${canary}`,
        extraSecret: canary,
      },
    },
  );
  assert.equal(classified.operation, "docker_create_origin");
  assert.equal(classified.createElapsedMs, 60010);
  assert.equal(classified.startElapsedMs, null);
  assert.equal(classified.containerState.containerStatus, "unknown");
  assert.equal(classified.containerState.extraSecret, undefined);
  assert.equal(JSON.stringify(classified).includes(canary), false);
});
