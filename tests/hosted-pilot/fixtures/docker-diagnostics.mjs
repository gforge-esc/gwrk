import { createHash } from "node:crypto";
import { RESOURCE_LIMITS } from "./runtime-policy.mjs";

export const WATCHDOG_POLICY = Object.freeze({
  watchedPath: "/var/lib/docker",
  sampleIntervalMs: 1000,
  commandTimeoutMs: 15_000,
  maxTransientRetriesPerTick: 2,
  transientRetryDelayMs: 150,
  maxConsecutiveTransientTicks: 3,
  maxValidSampleAgeMs: 15_000,
});

const EMPTY_SHA256 = createHash("sha256").update("").digest("hex");

const STATIC_LIFECYCLE_STAGES = new Set([
  "outer_lifecycle",
  "outer_image_verify",
  "outer_container_create",
  "outer_container_start",
  "outer_namespace_verify",
  "outer_daemon_readiness",
  "resource_watchdog",
  "image_preload",
  "controller_setup",
  "controller_execution",
  "fixture_lifecycle",
]);

const STATIC_LIFECYCLE_CATEGORY_DETAILS = Object.freeze({
  invalid_pid_mode: "Docker rejected the PID namespace option",
  unsupported_option: "Docker rejected an unsupported command option",
  preload_image_unavailable: "A required preloaded image is unavailable",
  fixture_mount_unavailable: "An owned fixture mount is unavailable",
  daemon_unavailable: "The selected Docker daemon is unavailable",
  docker_command_failed:
    "Docker command failed without a recognized safe diagnostic",
  outer_daemon_readiness_timeout:
    "Nested Docker daemon did not become ready within startup deadline",
  watchdog_data_budget_exceeded:
    "Nested daemon data usage reached or exceeded the 12 GiB budget",
  watchdog_suite_deadline_exceeded:
    "Nested fixture exceeded the startup plus suite wall-clock deadline",
  watchdog_permission_denied:
    "Resource watchdog encountered a filesystem permission error",
  watchdog_storage_error:
    "Resource watchdog encountered a filesystem storage or I/O error",
  watchdog_transient_vanished_entry:
    "Resource watchdog observed transient vanished entries under the monitored tree",
  watchdog_transient_exhausted:
    "Resource watchdog vanished-entry race persisted beyond bounded retry budget",
  watchdog_measurement_invalid:
    "Resource watchdog returned an unparseable byte count",
  watchdog_measurement_timeout:
    "Resource watchdog measurement command timed out",
  watchdog_process_failed:
    "Resource watchdog measurement command failed to execute",
  watchdog_measurement_failed:
    "Resource watchdog measurement failed without a recognized safe transient cause",
  fixture_cancelled: "Native fixture execution was cancelled before completion",
  fixture_process_timeout:
    "An owned fixture child process exceeded its timeout",
  fixture_output_bound:
    "An owned fixture child process exceeded its output bound",
  fixture_spawn_failed: "An owned fixture child process failed to spawn",
  fixture_drain_unconfirmed:
    "An owned fixture child process did not confirm exit after escalation",
  lifecycle_assertion_failed:
    "A native fixture lifecycle invariant assertion failed",
  generic_construction_failed:
    "Native fixture lifecycle failed without a recognized safe diagnostic",
});

const STATIC_LIFECYCLE_OPERATIONS = new Set([
  "docker_create",
  "docker_other",
  "docker_load_preload",
  "nested_daemon_info_wait",
  "resource_watchdog_du",
  "resource_watchdog_deadline",
  "outer_lifecycle",
]);

const WHITELISTED_PROCESS_CODES = new Set([
  "cancelled",
  "timeout",
  "output_bound",
  "spawn",
  "drain_unconfirmed",
]);

const PROCESS_ERROR_CATEGORIES = Object.freeze({
  cancelled: "fixture_cancelled",
  timeout: "fixture_process_timeout",
  output_bound: "fixture_output_bound",
  spawn: "fixture_spawn_failed",
  drain_unconfirmed: "fixture_drain_unconfirmed",
});

const VANISHED_ENTRY_LINE_PATTERN =
  /^(?:(?:\/[^\s:]+\/)?g?du):\s+(?:(?:cannot (?:access|read directory|stat)|can't (?:stat|open)|failed to (?:open|stat))\s+)?(?:'([^']+)'|"([^"]+)"|([^:]+?)):\s*No such file or directory$/;

function hasControlChar(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function digestText(value) {
  const text = typeof value === "string" ? value : "";
  return {
    bytes: Buffer.byteLength(text),
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

// CLI output can contain reflected arguments. Persist only bounded static details
// and a digest of stderr, never arbitrary daemon messages or environment values.
export function classifyDockerFailure(command, result) {
  const stderr = typeof result.stderr === "string" ? result.stderr : "";
  const candidates = [
    [
      /--pid:\s*invalid PID mode/i,
      "invalid_pid_mode",
      "Docker rejected the PID namespace option",
    ],
    [
      /unknown flag/i,
      "unsupported_option",
      "Docker rejected an unsupported command option",
    ],
    [
      /no such image|pull access denied|image.*not found/i,
      "preload_image_unavailable",
      "A required preloaded image is unavailable",
    ],
    [
      /invalid mount|bind source path does not exist|error while creating mount source path/i,
      "fixture_mount_unavailable",
      "An owned fixture mount is unavailable",
    ],
    [
      /cannot connect.*docker daemon|failed to connect to the docker API|error during connect/i,
      "daemon_unavailable",
      "The selected Docker daemon is unavailable",
    ],
  ];
  const match = candidates.find(([pattern]) => pattern.test(stderr));
  return {
    operation: command === "create" ? "create" : "other",
    exitCode: Number.isInteger(result.code) ? result.code : null,
    category: match?.[1] ?? "docker_command_failed",
    detail:
      match?.[2] ??
      "Docker command failed without a recognized safe diagnostic",
    stderrBytes: Buffer.byteLength(stderr),
    stderrSha256: createHash("sha256").update(stderr).digest("hex"),
  };
}

function isVanishedDescendantLine(line, watchedPath) {
  if (typeof line !== "string" || typeof watchedPath !== "string") {
    return false;
  }
  const base = watchedPath.replace(/\/+$/, "");
  if (!base.startsWith("/") || base.length <= 1) {
    return false;
  }
  const baseSegments = base.split("/");
  if (baseSegments.includes(".") || baseSegments.includes("..")) {
    return false;
  }
  const match = VANISHED_ENTRY_LINE_PATTERN.exec(line);
  if (!match) {
    return false;
  }
  const rawPath = (match[1] ?? match[2] ?? match[3] ?? "").trim();
  if (!rawPath || hasControlChar(rawPath)) {
    return false;
  }
  const normalizedPath = rawPath.replace(/\/+$/, "");
  if (!normalizedPath.startsWith(`${base}/`)) {
    return false;
  }
  const relative = normalizedPath.slice(base.length + 1);
  const nonEmptySegments = relative
    .split("/")
    .filter((segment) => segment.length > 0);
  if (
    nonEmptySegments.length === 0 ||
    nonEmptySegments.some((segment) => segment === "." || segment === "..")
  ) {
    return false;
  }
  return true;
}

// Classify one du watchdog sample without reflecting raw paths or stderr text.
// Only strict descendant vanished-entry exit-1 races qualify as transient.
export function classifyWatchdogMeasurement(result, options = {}) {
  const watchedPath = options.watchedPath ?? WATCHDOG_POLICY.watchedPath;
  const budgetBytes = options.budgetBytes ?? RESOURCE_LIMITS.dataBytes;
  const stdout = typeof result?.stdout === "string" ? result.stdout : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr : "";
  const stdoutDigest = digestText(stdout);
  const stderrDigest = digestText(stderr);
  const exitCode = Number.isInteger(result?.code) ? result.code : null;
  const firstToken = stdout.trim().split(/\s+/)[0] ?? "";
  const parsed = /^\d+$/.test(firstToken) ? Number(firstToken) : null;
  const validBytes =
    parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0
      ? parsed
      : null;

  const base = {
    bytes: validBytes,
    exitCode,
    stdoutBytes: stdoutDigest.bytes,
    stderrBytes: stderrDigest.bytes,
    stdoutSha256: stdoutDigest.sha256,
    stderrSha256: stderrDigest.sha256,
  };

  if (validBytes !== null && validBytes >= budgetBytes) {
    return {
      ...base,
      ok: false,
      transient: false,
      category: "watchdog_data_budget_exceeded",
      detail: "Nested daemon data usage reached or exceeded the 12 GiB budget",
    };
  }

  if (exitCode === 0) {
    if (validBytes === null) {
      return {
        ...base,
        ok: false,
        transient: false,
        category: "watchdog_measurement_invalid",
        detail: "Resource watchdog returned an unparseable byte count",
      };
    }
    return {
      ...base,
      ok: true,
      transient: false,
      category: "watchdog_sample_ok",
      detail: "Resource watchdog sample within budget",
    };
  }

  if (
    /cannot connect.*docker daemon|failed to connect to the docker API|error during connect|no such container|is not running|oci runtime exec failed/i.test(
      stderr,
    )
  ) {
    return {
      ...base,
      ok: false,
      transient: false,
      category: "daemon_unavailable",
      detail:
        "The selected Docker daemon or container is unavailable during watchdog measurement",
    };
  }

  if (/permission denied|operation not permitted/i.test(stderr)) {
    return {
      ...base,
      ok: false,
      transient: false,
      category: "watchdog_permission_denied",
      detail: "Resource watchdog encountered a filesystem permission error",
    };
  }

  if (
    /no space left on device|disk quota exceeded|input\/output error|read-only file system/i.test(
      stderr,
    )
  ) {
    return {
      ...base,
      ok: false,
      transient: false,
      category: "watchdog_storage_error",
      detail: "Resource watchdog encountered a filesystem storage or I/O error",
    };
  }

  const lines = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    exitCode === 1 &&
    lines.length > 0 &&
    lines.every((line) => isVanishedDescendantLine(line, watchedPath))
  ) {
    return {
      ...base,
      ok: false,
      transient: true,
      category: "watchdog_transient_vanished_entry",
      detail:
        "Resource watchdog observed transient vanished entries under the monitored tree",
    };
  }

  return {
    ...base,
    ok: false,
    transient: false,
    category: "watchdog_measurement_failed",
    detail:
      "Resource watchdog measurement failed without a recognized safe transient cause",
  };
}

function sanitizeStage(stage, fallback) {
  if (typeof stage === "string" && STATIC_LIFECYCLE_STAGES.has(stage)) {
    return stage;
  }
  return STATIC_LIFECYCLE_STAGES.has(fallback) ? fallback : "fixture_lifecycle";
}

function sanitizeWatchdogSummary(summary) {
  if (!summary || typeof summary !== "object") {
    return undefined;
  }
  return {
    transientRetries: Number.isSafeInteger(summary.transientRetries)
      ? summary.transientRetries
      : 0,
    transientRecoveries: Number.isSafeInteger(summary.transientRecoveries)
      ? summary.transientRecoveries
      : 0,
    consecutiveTransientTicks: Number.isSafeInteger(
      summary.consecutiveTransientTicks,
    )
      ? summary.consecutiveTransientTicks
      : 0,
    hasValidSample: summary.hasValidSample === true,
  };
}

// Build a safe durable native-result.json receipt for lifecycle or watchdog failures.
// Never copies raw error messages, stacks, stderr text, paths, or secrets.
export function buildLifecycleFailureReceipt({
  runId,
  error,
  fallbackStage = "fixture_lifecycle",
}) {
  if (error?.isFixtureLifecycleError === true) {
    const category =
      typeof error.category === "string" &&
      Object.hasOwn(STATIC_LIFECYCLE_CATEGORY_DETAILS, error.category)
        ? error.category
        : "generic_construction_failed";
    const operation = STATIC_LIFECYCLE_OPERATIONS.has(error.operation)
      ? error.operation
      : undefined;
    const receipt = {
      runId,
      exitCode:
        Number.isInteger(error.exitCode) && error.exitCode !== 0
          ? error.exitCode
          : 1,
      stdoutBytes: Number.isSafeInteger(error.stdoutBytes)
        ? error.stdoutBytes
        : 0,
      stderrBytes: Number.isSafeInteger(error.stderrBytes)
        ? error.stderrBytes
        : 0,
      stdoutSha256:
        typeof error.stdoutSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(error.stdoutSha256)
          ? error.stdoutSha256
          : EMPTY_SHA256,
      stderrSha256:
        typeof error.stderrSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(error.stderrSha256)
          ? error.stderrSha256
          : EMPTY_SHA256,
      nativeBehavioralRed: false,
      stage: sanitizeStage(error.stage, fallbackStage),
      fixtureConstructionFailure: true,
      positiveAcceptance: false,
      category,
      detail: STATIC_LIFECYCLE_CATEGORY_DETAILS[category],
    };
    if (operation !== undefined) {
      receipt.operation = operation;
    }
    if (
      typeof error.errorCode === "string" &&
      WHITELISTED_PROCESS_CODES.has(error.errorCode)
    ) {
      receipt.errorCode = error.errorCode;
    }
    const watchdog = sanitizeWatchdogSummary(error.watchdog);
    if (watchdog !== undefined) {
      receipt.watchdog = watchdog;
    }
    return receipt;
  }

  const processCode =
    typeof error?.code === "string" && WHITELISTED_PROCESS_CODES.has(error.code)
      ? error.code
      : null;
  if (processCode) {
    const category = PROCESS_ERROR_CATEGORIES[processCode];
    return {
      runId,
      exitCode: 1,
      stdoutBytes: 0,
      stderrBytes: 0,
      stdoutSha256: EMPTY_SHA256,
      stderrSha256: EMPTY_SHA256,
      nativeBehavioralRed: false,
      stage: sanitizeStage(error?.fixtureStage, fallbackStage),
      fixtureConstructionFailure: true,
      positiveAcceptance: false,
      category,
      detail: STATIC_LIFECYCLE_CATEGORY_DETAILS[category],
      errorCode: processCode,
    };
  }

  const isAssertion =
    error?.code === "ERR_ASSERTION" || error?.name === "AssertionError";
  const category = isAssertion
    ? "lifecycle_assertion_failed"
    : "generic_construction_failed";
  return {
    runId,
    exitCode: 1,
    stdoutBytes: 0,
    stderrBytes: 0,
    stdoutSha256: EMPTY_SHA256,
    stderrSha256: EMPTY_SHA256,
    nativeBehavioralRed: false,
    stage: sanitizeStage(error?.fixtureStage, fallbackStage),
    fixtureConstructionFailure: true,
    positiveAcceptance: false,
    category,
    detail: STATIC_LIFECYCLE_CATEGORY_DETAILS[category],
  };
}
