import assert from "node:assert/strict";
import { test } from "vitest";
import {
  BOOTSTRAP_STAGES,
  STATIC_CONSTRUCTION_CATEGORIES,
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
