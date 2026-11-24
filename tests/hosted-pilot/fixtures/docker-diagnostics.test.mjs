import assert from "node:assert/strict";
import { test } from "vitest";
import { classifyDockerFailure } from "./docker-diagnostics.mjs";

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
