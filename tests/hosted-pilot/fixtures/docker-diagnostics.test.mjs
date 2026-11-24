import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import {
  WATCHDOG_POLICY,
  buildLifecycleFailureReceipt,
  classifyDockerFailure,
  classifyWatchdogMeasurement,
} from "./docker-diagnostics.mjs";
import { RESOURCE_LIMITS } from "./runtime-policy.mjs";

test("retains the supported CLI failure category without raw reflected input", () => {
  const result = classifyDockerFailure("create", {
    code: 125,
    stderr: "docker: --pid: invalid PID mode\nSECRET_CANARY\n",
  });
  assert.equal(result.operation, "create");
  assert.equal(result.category, "invalid_pid_mode");
  assert.equal(result.exitCode, 125);
  assert.equal(result.detail, "Docker rejected the PID namespace option");
  assert.equal(JSON.stringify(result).includes("SECRET_CANARY"), false);
  assert.match(result.stderrSha256, /^[a-f0-9]{64}$/);
});

test("unknown daemon output cannot reflect secrets into the diagnostic receipt", () => {
  const result = classifyDockerFailure("create", {
    code: 125,
    stderr: "Bearer PRIVATE_CANARY\n-----BEGIN PRIVATE KEY-----\n".repeat(
      10000,
    ),
  });
  assert.equal(result.category, "docker_command_failed");
  assert.equal(JSON.stringify(result).includes("PRIVATE_CANARY"), false);
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
  assert.ok(JSON.stringify(result).length < 512);
});

test("watchdog classifier accepts valid exit-0 usage under the unchanged 12 GiB budget", () => {
  assert.equal(WATCHDOG_POLICY.watchedPath, "/var/lib/docker");
  assert.equal(RESOURCE_LIMITS.dataBytes, 12 * 1024 ** 3);
  const result = classifyWatchdogMeasurement({
    code: 0,
    stdout: "4096\t/var/lib/docker\n",
    stderr: "",
  });
  assert.equal(result.ok, true);
  assert.equal(result.transient, false);
  assert.equal(result.bytes, 4096);
  assert.equal(result.exitCode, 0);
});

test("watchdog classifier recognizes only strict descendant vanished-entry du lines across GNU, BusyBox, and BSD", () => {
  const samples = [
    "du: cannot access '/var/lib/docker/vfs/dir/abc123': No such file or directory\n",
    "du: cannot read directory '/var/lib/docker/tmp/layer-9': No such file or directory\n",
    "du: can't stat '/var/lib/docker/vfs/dir/xyz': No such file or directory\n",
    "du: /var/lib/docker/vfs/dir/churn-0: No such file or directory\n",
  ];
  for (const stderr of samples) {
    const result = classifyWatchdogMeasurement({
      code: 1,
      stdout: "1024\t/var/lib/docker\n",
      stderr,
    });
    assert.equal(result.ok, false);
    assert.equal(result.transient, true);
    assert.equal(result.category, "watchdog_transient_vanished_entry");
    assert.equal(result.stderrBytes, Buffer.byteLength(stderr));
    assert.equal(
      result.stderrSha256,
      createHash("sha256").update(stderr).digest("hex"),
    );
    assert.equal(JSON.stringify(result).includes("/var/lib/docker"), false);
  }
});

test("watchdog classifier fails closed on permission, storage, root-missing, mixed, unknown, and oversized samples", () => {
  const oversizedZero = classifyWatchdogMeasurement({
    code: 0,
    stdout: `${RESOURCE_LIMITS.dataBytes}\t/var/lib/docker\n`,
    stderr: "",
  });
  assert.equal(oversizedZero.ok, false);
  assert.equal(oversizedZero.transient, false);
  assert.equal(oversizedZero.category, "watchdog_data_budget_exceeded");

  const oversizedDuringRace = classifyWatchdogMeasurement({
    code: 1,
    stdout: `${RESOURCE_LIMITS.dataBytes + 4096}\t/var/lib/docker\n`,
    stderr:
      "du: cannot access '/var/lib/docker/vfs/dir/ephemeral': No such file or directory\n",
  });
  assert.equal(oversizedDuringRace.ok, false);
  assert.equal(oversizedDuringRace.transient, false);
  assert.equal(oversizedDuringRace.category, "watchdog_data_budget_exceeded");

  const permission = classifyWatchdogMeasurement({
    code: 1,
    stdout: "1024\t/var/lib/docker\n",
    stderr:
      "du: cannot read directory '/var/lib/docker/vfs/dir/restricted': Permission denied\n",
  });
  assert.equal(permission.transient, false);
  assert.equal(permission.category, "watchdog_permission_denied");

  const storage = classifyWatchdogMeasurement({
    code: 1,
    stdout: "1024\t/var/lib/docker\n",
    stderr: "du: /var/lib/docker/vfs/dir/bad: Input/output error\n",
  });
  assert.equal(storage.transient, false);
  assert.equal(storage.category, "watchdog_storage_error");

  const rootMissing = classifyWatchdogMeasurement({
    code: 1,
    stdout: "",
    stderr: "du: cannot access '/var/lib/docker': No such file or directory\n",
  });
  assert.equal(rootMissing.transient, false);
  assert.equal(rootMissing.category, "watchdog_measurement_failed");

  const traversal = classifyWatchdogMeasurement({
    code: 1,
    stdout: "",
    stderr:
      "du: cannot access '/var/lib/docker/../etc/secret': No such file or directory\n",
  });
  assert.equal(traversal.transient, false);
  assert.equal(traversal.category, "watchdog_measurement_failed");

  const mixed = classifyWatchdogMeasurement({
    code: 1,
    stdout: "1024\t/var/lib/docker\n",
    stderr: [
      "du: cannot access '/var/lib/docker/vfs/dir/a': No such file or directory",
      "du: cannot access '/var/lib/docker/vfs/dir/b': Permission denied",
    ].join("\n"),
  });
  assert.equal(mixed.transient, false);
  assert.equal(mixed.category, "watchdog_permission_denied");

  const emptyExitOne = classifyWatchdogMeasurement({
    code: 1,
    stdout: "1024\t/var/lib/docker\n",
    stderr: "",
  });
  assert.equal(emptyExitOne.transient, false);
  assert.equal(emptyExitOne.category, "watchdog_measurement_failed");

  const unknownSecret = classifyWatchdogMeasurement({
    code: 1,
    stdout: "",
    stderr:
      "unexpected failure SECRET_WATCHDOG_CANARY /var/lib/docker/secret\n",
  });
  assert.equal(unknownSecret.transient, false);
  assert.equal(unknownSecret.category, "watchdog_measurement_failed");
  assert.equal(
    JSON.stringify(unknownSecret).includes("SECRET_WATCHDOG_CANARY"),
    false,
  );

  const malformed = classifyWatchdogMeasurement({
    code: 0,
    stdout: "not-a-number\t/var/lib/docker\n",
    stderr: "",
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.transient, false);
  assert.equal(malformed.category, "watchdog_measurement_invalid");
});

test("lifecycle failure receipt preserves hashes and static cause without reflecting raw error strings", () => {
  const receipt = buildLifecycleFailureReceipt({
    runId: "a".repeat(24),
    error: new Error("RAW_SECRET_CANARY /var/lib/docker/private"),
    fallbackStage: "outer_lifecycle",
  });
  assert.equal(receipt.runId, "a".repeat(24));
  assert.equal(receipt.nativeBehavioralRed, false);
  assert.equal(receipt.fixtureConstructionFailure, true);
  assert.equal(receipt.positiveAcceptance, false);
  assert.equal(receipt.stage, "outer_lifecycle");
  assert.equal(receipt.category, "generic_construction_failed");
  assert.match(receipt.stdoutSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.stderrSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(receipt).includes("RAW_SECRET_CANARY"), false);
  assert.equal(JSON.stringify(receipt).includes("/var/lib/docker"), false);
});

test("watchdog classifier rejects watched root dot aliases as non-transient", () => {
  for (const stderr of [
    "du: cannot access '/var/lib/docker/.': No such file or directory\n",
    "du: cannot access '/var/lib/docker/./': No such file or directory\n",
    "du: cannot access '/var/lib/docker/./.': No such file or directory\n",
    "du: cannot access '/var/lib/docker/vfs/./layer': No such file or directory\n",
    "du: cannot access '/var/lib/docker/vfs/..': No such file or directory\n",
    "du: cannot access '/var/lib/docker/..': No such file or directory\n",
    "du: cannot access '/var/lib/docker///': No such file or directory\n",
  ]) {
    const result = classifyWatchdogMeasurement({
      code: 1,
      stdout: "1024\t/var/lib/docker\n",
      stderr,
    });
    assert.equal(result.transient, false);
    assert.equal(result.category, "watchdog_measurement_failed");
  }

  const hiddenDescendant = classifyWatchdogMeasurement({
    code: 1,
    stdout: "1024\t/var/lib/docker\n",
    stderr:
      "du: cannot access '/var/lib/docker/vfs/dir/.tmp-layer': No such file or directory\n",
  });
  assert.equal(hiddenDescendant.transient, true);
  assert.equal(hiddenDescendant.category, "watchdog_transient_vanished_entry");
});

test("lifecycle failure receipt never reflects arbitrary detail text on typed errors", () => {
  const receipt = buildLifecycleFailureReceipt({
    runId: "a".repeat(24),
    error: {
      isFixtureLifecycleError: true,
      stage: "resource_watchdog",
      category: "watchdog_measurement_failed",
      detail: "SECRET_CANARY /var/lib/docker/private/key",
      exitCode: 1,
    },
    fallbackStage: "resource_watchdog",
  });
  const serialized = JSON.stringify(receipt);
  assert.equal(serialized.includes("SECRET_CANARY"), false);
  assert.equal(serialized.includes("/var/lib/docker"), false);
  assert.equal(
    receipt.detail,
    "Resource watchdog measurement failed without a recognized safe transient cause",
  );

  const protoReceipt = buildLifecycleFailureReceipt({
    runId: "a".repeat(24),
    error: {
      isFixtureLifecycleError: true,
      stage: "resource_watchdog",
      category: "toString",
      detail: "SECRET_PROTO_CANARY",
      exitCode: 1,
    },
    fallbackStage: "resource_watchdog",
  });
  assert.equal(protoReceipt.category, "generic_construction_failed");
  assert.equal(
    JSON.stringify(protoReceipt).includes("SECRET_PROTO_CANARY"),
    false,
  );
});
