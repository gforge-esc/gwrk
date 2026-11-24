import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { test } from "vitest";
import {
  BOOTSTRAP_STAGES,
  STATIC_CONSTRUCTION_CATEGORIES,
  STATIC_OPERATION_NAMES,
  WHITELISTED_ERROR_CODES,
  WHITELISTED_SIGNALS,
  captureDockerLogs,
  classifyBootstrapFailure,
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
