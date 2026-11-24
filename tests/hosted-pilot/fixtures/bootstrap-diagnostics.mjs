import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const BOOTSTRAP_STAGES = [
  "init",
  "staging_directories",
  "secrets_setup",
  "certificate_generation",
  "trust_store_update",
  "issuer_start",
  "origin_start",
  "dependencies_wait",
  "dependencies_ready",
  "cookie_format",
  "bundle_preparation",
  "gateway_startup",
  "client_network",
  "gateway_cases",
  "completed_initial_cases",
];

export const STATIC_CONSTRUCTION_CATEGORIES = [
  "filesystem_permission",
  "filesystem_missing",
  "filesystem_storage",
  "certificate_generation_failed",
  "trust_store_update_failed",
  "issuer_startup_failed",
  "origin_launch_failed",
  "dependency_timeout",
  "bundle_preparation_failed",
  "docker_command_failed",
  "assertion_failed",
  "generic_construction_failed",
];

// Origin container stdout and stderr are captured in memory via piped spawnSync
// for safe static classification without inheriting raw stderr onto process.stderr.
export function captureDockerLogs(name, options = {}) {
  const runner = options.runner ?? spawnSync;
  const cmd = options.command ?? options.dockerPath ?? "/usr/bin/docker";
  const args = options.args ?? [
    "--host",
    options.dockerHost ?? "unix:///var/run/docker.sock",
    "logs",
    name,
  ];
  const timeout = options.timeout ?? 30_000;
  const maxBuffer = options.maxBuffer ?? 1048576;
  const result = runner(cmd, args, {
    stdio: "pipe",
    encoding: "utf8",
    timeout,
    maxBuffer,
  });
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  return [stdout, stderr].filter(Boolean).join("\n");
}

// CLI and runtime logs can contain reflected secrets or tokens. Persist only
// bounded static details, category codes, and a digest of in-memory logs.
export function classifyBootstrapFailure(stage, error, context = {}) {
  const isBehavioral = ["gateway_startup", "gateway_cases"].includes(stage);
  const isFormat = stage === "cookie_format";
  const failureClassification = isBehavioral
    ? "behavioral"
    : isFormat
      ? "fixture_input_format"
      : "fixture_construction";

  const message = typeof error?.message === "string" ? error.message : "";
  const stderr =
    typeof error?.stderr === "string"
      ? error.stderr
      : error?.stderr
        ? String(error.stderr)
        : "";
  const stdout =
    typeof error?.stdout === "string"
      ? error.stdout
      : error?.stdout
        ? String(error.stdout)
        : "";
  const issuerStderr =
    typeof context.issuerStderr === "string" ? context.issuerStderr : "";
  const originLogs =
    typeof context.originLogs === "string" ? context.originLogs : "";
  const errorText = [message, stderr, stdout].filter(Boolean).join("\n");
  const combined = [message, stderr, stdout, issuerStderr, originLogs]
    .filter(Boolean)
    .join("\n");

  const originReady = context.originReady === true;
  const issuerReady = context.issuerReady === true;
  const hasIssuerError = /fail|exit|error|died|cannot find/i.test(issuerStderr);
  const hasOriginError =
    /fail|error|cannot start|daemon/i.test(originLogs) &&
    !/fixture_origin_ready/.test(originLogs);

  let category;
  let detail;

  if (isBehavioral) {
    category =
      stage === "gateway_startup"
        ? "gateway_startup_failed"
        : "gateway_cases_failed";
    detail =
      stage === "gateway_startup"
        ? "Gateway startup script execution failed"
        : "Gateway test cases assertion failed";
  } else if (isFormat) {
    category = "fixture_cookie_format_invalid";
    detail = "Operator cookie secret format validation failed";
  } else if (
    error?.code === "EACCES" ||
    error?.code === "EPERM" ||
    /permission denied|operation not permitted/i.test(errorText)
  ) {
    category = "filesystem_permission";
    detail = "Filesystem permission denied during fixture setup";
  } else if (
    error?.code === "ENOENT" ||
    /no such file or directory/i.test(errorText)
  ) {
    category = "filesystem_missing";
    detail = "Required fixture file or directory is missing";
  } else if (
    error?.code === "ENOSPC" ||
    error?.code === "EDQUOT" ||
    /no space left on device/i.test(errorText)
  ) {
    category = "filesystem_storage";
    detail = "Storage or quota exhausted during fixture setup";
  } else if (
    stage === "trust_store_update" ||
    /update-ca-certificates/i.test(errorText)
  ) {
    category = "trust_store_update_failed";
    detail = "System trust store update failed";
  } else if (
    stage === "certificate_generation" ||
    /openssl|error in req|error in x509/i.test(errorText)
  ) {
    category = "certificate_generation_failed";
    detail = "OpenSSL certificate generation failed";
  } else if (
    stage === "issuer_start" ||
    (stage === "dependencies_wait" &&
      !issuerReady &&
      ((originReady && !hasIssuerError && !hasOriginError) ||
        (hasIssuerError && !hasOriginError) ||
        (hasIssuerError && originReady)))
  ) {
    category = "issuer_startup_failed";
    detail = "Synthetic OIDC issuer failed to start";
  } else if (
    stage === "origin_start" ||
    (stage === "dependencies_wait" &&
      !originReady &&
      ((issuerReady && !hasOriginError && !hasIssuerError) ||
        (hasOriginError && !hasIssuerError) ||
        (hasOriginError && issuerReady)))
  ) {
    category = "origin_launch_failed";
    detail = "Origin service container failed to launch";
  } else if (
    stage === "dependencies_wait" ||
    /real origin or synthetic issuer did not become ready|timed? ?out/i.test(
      errorText,
    )
  ) {
    category = "dependency_timeout";
    detail = "Fixture dependencies did not become ready within timeout";
  } else if (
    stage === "bundle_preparation" ||
    /compose\.yaml/i.test(errorText)
  ) {
    category = "bundle_preparation_failed";
    detail = "Fixture bundle preparation failed";
  } else if (
    error?.code === "ERR_ASSERTION" ||
    error?.name === "AssertionError" ||
    /AssertionError/i.test(errorText)
  ) {
    category = "assertion_failed";
    detail = "A fixture setup invariant assertion failed";
  } else if (
    /docker/i.test(errorText) ||
    error?.code === 125 ||
    error?.code === 127
  ) {
    category = "docker_command_failed";
    detail = "Docker command failed during fixture setup";
  } else {
    category = "generic_construction_failed";
    detail = "Fixture construction failed without a recognized safe diagnostic";
  }

  return {
    stage,
    failureClassification,
    category,
    detail,
    stderrBytes: Buffer.byteLength(combined),
    stderrSha256: createHash("sha256").update(combined).digest("hex"),
    exitCode: Number.isInteger(error?.status)
      ? error.status
      : Number.isInteger(error?.code)
        ? error.code
        : 1,
  };
}
