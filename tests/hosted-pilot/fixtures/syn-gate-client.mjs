import assert from "node:assert/strict";
import {
  closeSync,
  fchmodSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  SYN_GATE_STATE,
  validateArmRequest,
  validateReleaseRequest,
  validateRunId,
  validateTimingReceipt,
} from "./syn-gate-policy.mjs";

const MAX_JSON_FILE_BYTES = 64 * 1024;

export function verifySynGateDirectory(
  synGateDir,
  { requireRootOwnership = true } = {},
) {
  assert.ok(
    typeof synGateDir === "string" && synGateDir.length > 0,
    "synGateDir is required",
  );
  const st = lstatSync(synGateDir);
  assert.equal(st.isSymbolicLink(), false, "synGateDir must not be a symlink");
  assert.equal(st.isDirectory(), true, "synGateDir must be a directory");
  assert.equal(
    st.mode & 0o777,
    0o700,
    `synGateDir must have mode 0700, got ${(st.mode & 0o777).toString(8)}`,
  );
  if (requireRootOwnership) {
    assert.equal(st.uid, 0, "synGateDir must be owned by root uid 0");
    assert.equal(st.gid, 0, "synGateDir must be owned by root gid 0");
  }
  return st;
}

export function writeSynGateJsonAtomic(
  synGateDir,
  filename,
  value,
  { requireRootOwnership = true } = {},
) {
  verifySynGateDirectory(synGateDir, { requireRootOwnership });
  const targetPath = join(synGateDir, filename);
  const nextPath = `${targetPath}.next`;
  const content = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  assert.ok(
    content.length <= MAX_JSON_FILE_BYTES,
    `${filename} exceeds ${MAX_JSON_FILE_BYTES} bytes bound`,
  );

  const fd = openSync(
    nextPath,
    fsConstants.O_WRONLY |
      fsConstants.O_CREAT |
      fsConstants.O_TRUNC |
      fsConstants.O_NOFOLLOW,
    0o600,
  );
  try {
    fchmodSync(fd, 0o600);
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  renameSync(nextPath, targetPath);
}

export function readSynGateJsonSafe(
  synGateDir,
  filename,
  { requireRootOwnership = true } = {},
) {
  verifySynGateDirectory(synGateDir, { requireRootOwnership });
  const filePath = join(synGateDir, filename);
  let lst;
  try {
    lst = lstatSync(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }

  assert.equal(
    lst.isSymbolicLink(),
    false,
    `${filename} must not be a symlink`,
  );
  assert.equal(lst.isFile(), true, `${filename} must be a regular file`);
  assert.equal(
    lst.mode & 0o777,
    0o600,
    `${filename} must have mode 0600, got ${(lst.mode & 0o777).toString(8)}`,
  );
  assert.ok(
    lst.size <= MAX_JSON_FILE_BYTES,
    `${filename} exceeds ${MAX_JSON_FILE_BYTES} bytes bound`,
  );
  if (requireRootOwnership) {
    assert.equal(lst.uid, 0, `${filename} must be owned by root uid 0`);
    assert.equal(lst.gid, 0, `${filename} must be owned by root gid 0`);
  }

  const fd = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  let rawText;
  try {
    const fst = fstatSync(fd);
    assert.equal(
      fst.isFile(),
      true,
      `${filename} descriptor must be a regular file`,
    );
    assert.equal(
      fst.mode & 0o777,
      0o600,
      `${filename} descriptor must have mode 0600, got ${(fst.mode & 0o777).toString(8)}`,
    );
    assert.equal(fst.ino, lst.ino, `${filename} identity changed during open`);
    assert.equal(fst.dev, lst.dev, `${filename} device changed during open`);
    assert.ok(fst.size <= MAX_JSON_FILE_BYTES, `${filename} exceeds bound`);
    if (requireRootOwnership) {
      assert.equal(
        fst.uid,
        0,
        `${filename} descriptor must be owned by root uid 0`,
      );
      assert.equal(
        fst.gid,
        0,
        `${filename} descriptor must be owned by root gid 0`,
      );
    }
    rawText = readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }

  return JSON.parse(rawText);
}

export function createSynGateClient({
  synGateDir,
  runId,
  requireRootOwnership = true,
  wait = sleep,
  now = () => performance.now(),
}) {
  validateRunId(runId);
  verifySynGateDirectory(synGateDir, { requireRootOwnership });

  function writeArmRequest({ ttlMs = 1000, opId = 1 } = {}) {
    const req = validateArmRequest(
      { version: 1, runId, opId, ttlMs },
      { expectedRunId: runId },
    );
    writeSynGateJsonAtomic(synGateDir, "arm.json", req, {
      requireRootOwnership,
    });
    return req;
  }

  async function arm({ ttlMs = 1000, opId = 1, timeoutMs = 1000 } = {}) {
    assert.ok(
      timeoutMs <= 1000,
      `timeoutMs must not exceed 1000 ms, got ${timeoutMs}`,
    );
    writeArmRequest({ ttlMs, opId });
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const remaining = deadline - now();
      const status = readStatusSafe();
      if (
        status &&
        status.state === SYN_GATE_STATE.ARMED &&
        status.ruleInstalled === true
      ) {
        return status;
      }
      if (remaining <= 0) break;
      await wait(Math.min(20, Math.max(1, remaining)));
    }
    throw new Error(`syn-gate arm timed out after ${timeoutMs} ms`);
  }

  function writeReleaseRequest({ opId = 1 } = {}) {
    const req = validateReleaseRequest(
      { version: 1, runId, opId, action: "release" },
      { expectedRunId: runId },
    );
    writeSynGateJsonAtomic(synGateDir, "release.json", req, {
      requireRootOwnership,
    });
    return req;
  }

  async function release({ opId = 1, timeoutMs = 1000 } = {}) {
    assert.ok(
      timeoutMs <= 1000,
      `timeoutMs must not exceed 1000 ms, got ${timeoutMs}`,
    );
    writeReleaseRequest({ opId });
    return pollReceipt({ timeoutMs });
  }

  async function pollReceipt({ timeoutMs = 1000 } = {}) {
    assert.ok(
      timeoutMs <= 1000,
      `timeoutMs must not exceed 1000 ms, got ${timeoutMs}`,
    );
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const remaining = deadline - now();
      const receipt = readReceiptSafe();
      if (receipt) {
        return validateTimingReceipt(receipt, { expectedRunId: runId });
      }
      if (remaining <= 0) break;
      await wait(Math.min(20, Math.max(1, remaining)));
    }
    throw new Error(`syn-gate receipt polling timed out after ${timeoutMs} ms`);
  }

  function readStatusSafe() {
    return readSynGateJsonSafe(synGateDir, "status.json", {
      requireRootOwnership,
    });
  }

  function readReceiptSafe() {
    return readSynGateJsonSafe(synGateDir, "receipt.json", {
      requireRootOwnership,
    });
  }

  return {
    runId,
    synGateDir,
    writeArmRequest,
    arm,
    writeReleaseRequest,
    release,
    pollReceipt,
    readStatusSafe,
    readReceiptSafe,
  };
}
