import assert from "node:assert/strict";

export const RUN_ID_RE = /^[a-f0-9]{24}$/;
export const MAX_ARMED_TTL_MS = 1000;
export const MAX_REMOVE_DURATION_MS = 1000;

export const SYN_GATE_STATE = Object.freeze({
  IDLE: "IDLE",
  ARMED: "ARMED",
  RELEASED: "RELEASED",
  TIMED_OUT: "TIMED_OUT",
  FAULTED: "FAULTED",
  STOPPED: "STOPPED",
});

export const HARDCODED_IPTABLES_RULE = Object.freeze([
  "-i",
  "lo",
  "-p",
  "tcp",
  "-s",
  "127.0.0.1",
  "-d",
  "127.0.0.1",
  "--dport",
  "18790",
  "--tcp-flags",
  "SYN,RST,ACK,FIN",
  "SYN",
  "-j",
  "DROP",
]);

export const HARDCODED_CHECK_ARGS = Object.freeze([
  "-C",
  "INPUT",
  ...HARDCODED_IPTABLES_RULE,
]);

export const HARDCODED_INSTALL_ARGS = Object.freeze([
  "-I",
  "INPUT",
  "1",
  ...HARDCODED_IPTABLES_RULE,
]);

export const HARDCODED_REMOVE_ARGS = Object.freeze([
  "-D",
  "INPUT",
  ...HARDCODED_IPTABLES_RULE,
]);

export function validateRunId(runId) {
  assert.ok(
    typeof runId === "string" && RUN_ID_RE.test(runId),
    `runId must be a 24-character lowercase hex string, got ${runId}`,
  );
  return true;
}

export function validateArmRequest(request, { expectedRunId } = {}) {
  assert.ok(
    request && typeof request === "object" && !Array.isArray(request),
    "arm request must be a JSON object",
  );
  for (const key of Object.keys(request)) {
    assert.ok(
      key === "version" || key === "runId" || key === "opId" || key === "ttlMs",
      `unexpected key ${key} in arm request`,
    );
  }
  assert.equal(request.version, 1, "arm request version must be 1");
  validateRunId(request.runId);
  if (expectedRunId !== undefined) {
    assert.equal(
      request.runId,
      expectedRunId,
      `runId mismatch: expected ${expectedRunId}, got ${request.runId}`,
    );
  }
  assert.equal(request.opId, 1, "opId must be exactly 1");
  assert.ok(
    Number.isSafeInteger(request.ttlMs) && request.ttlMs > 0,
    "ttlMs must be a positive integer",
  );
  assert.ok(
    request.ttlMs <= MAX_ARMED_TTL_MS,
    `ttlMs exceeds maximum bound of ${MAX_ARMED_TTL_MS} ms`,
  );
  return request;
}

export function validateReleaseRequest(request, { expectedRunId } = {}) {
  assert.ok(
    request && typeof request === "object" && !Array.isArray(request),
    "release request must be a JSON object",
  );
  for (const key of Object.keys(request)) {
    assert.ok(
      key === "version" ||
        key === "runId" ||
        key === "opId" ||
        key === "action",
      `unexpected key ${key} in release request`,
    );
  }
  assert.equal(request.version, 1, "release request version must be 1");
  validateRunId(request.runId);
  if (expectedRunId !== undefined) {
    assert.equal(
      request.runId,
      expectedRunId,
      `runId mismatch: expected ${expectedRunId}, got ${request.runId}`,
    );
  }
  assert.equal(request.opId, 1, "opId must be exactly 1");
  assert.equal(request.action, "release", 'action must be "release"');
  return request;
}

export function validateIptablesArgs(args, operation) {
  assert.ok(Array.isArray(args), "iptables args must be an array");

  // Coordinator correction: -w lock waiting is prohibited, busy lock must fail closed
  assert.equal(
    args.includes("-w"),
    false,
    "-w lock wait flag is prohibited by coordinator decision",
  );
  assert.equal(
    args.includes("-F") || args.includes("--flush"),
    false,
    "table or chain flush is prohibited",
  );

  let expectedArgs;
  if (operation === "check") {
    expectedArgs = HARDCODED_CHECK_ARGS;
  } else if (operation === "install") {
    expectedArgs = HARDCODED_INSTALL_ARGS;
  } else if (operation === "remove") {
    expectedArgs = HARDCODED_REMOVE_ARGS;
  } else {
    throw new Error(`unrecognized iptables operation: ${operation}`);
  }

  assert.equal(
    args.length,
    expectedArgs.length,
    `args length ${args.length} differs from expected ${expectedArgs.length}`,
  );
  for (let i = 0; i < expectedArgs.length; i++) {
    assert.equal(
      args[i],
      expectedArgs[i],
      `arg at index ${i} "${args[i]}" differs from hardcoded "${expectedArgs[i]}"`,
    );
  }
  return true;
}

export function validateTimingReceipt(receipt, { expectedRunId } = {}) {
  assert.ok(
    receipt && typeof receipt === "object" && !Array.isArray(receipt),
    "receipt must be an object",
  );
  assert.equal(receipt.version, 1, "receipt version must be 1");
  validateRunId(receipt.runId);
  if (expectedRunId !== undefined) {
    assert.equal(receipt.runId, expectedRunId, "receipt runId mismatch");
  }
  assert.equal(receipt.opId, 1, "receipt opId must be 1");
  assert.ok(
    receipt.state === SYN_GATE_STATE.RELEASED ||
      receipt.state === SYN_GATE_STATE.TIMED_OUT,
    `receipt state must be RELEASED or TIMED_OUT, got ${receipt.state}`,
  );
  assert.ok(
    Number.isFinite(receipt.installDurationMs) &&
      receipt.installDurationMs >= 0,
    "installDurationMs must be a non-negative number",
  );
  assert.ok(
    Number.isFinite(receipt.armedDurationMs) && receipt.armedDurationMs >= 0,
    "armedDurationMs must be a non-negative number",
  );
  assert.ok(
    receipt.armedDurationMs <= MAX_ARMED_TTL_MS,
    `armed duration exceeds ${MAX_ARMED_TTL_MS} ms: got ${receipt.armedDurationMs}`,
  );
  assert.ok(
    Number.isFinite(receipt.removeDurationMs) && receipt.removeDurationMs >= 0,
    "removeDurationMs must be a non-negative number",
  );
  assert.ok(
    receipt.removeDurationMs <= MAX_REMOVE_DURATION_MS,
    `removal duration exceeds ${MAX_REMOVE_DURATION_MS} ms: got ${receipt.removeDurationMs}`,
  );
  assert.equal(
    receipt.ruleRemovedVerified,
    true,
    "rule removal not verified by absence check",
  );
  return receipt;
}

export function validateScenarioBCausality(observation) {
  assert.ok(
    observation && typeof observation === "object",
    "observation must be an object",
  );
  assert.ok(
    typeof observation.synSentOriginFlowId === "string" &&
      observation.synSentOriginFlowId.length > 0,
    "synSentOriginFlowId is required and must be non-empty",
  );
  assert.ok(
    typeof observation.zeroPriorParkedFlowId === "string" &&
      observation.zeroPriorParkedFlowId.length > 0,
    "zeroPriorParkedFlowId is required and must be non-empty",
  );
  assert.equal(
    observation.lastZeroPriorReusedFlowId,
    observation.zeroPriorParkedFlowId,
    "reused flow does not match parked flow",
  );
  assert.ok(
    Number.isInteger(observation.zeroPriorRequestReusedConnections) &&
      observation.zeroPriorRequestReusedConnections >= 1,
    "zeroPriorRequestReusedConnections must be at least 1",
  );
  assert.equal(
    observation.unusedDialObserved,
    true,
    "unusedDialObserved must be true",
  );
  assert.equal(
    observation.armedOriginHttpAttempts,
    0,
    "origin HTTP was attempted while armed",
  );
  assert.equal(
    observation.armedProxyDelta,
    0,
    "proxy requests observed while armed",
  );
  return true;
}

export function transitionSynGateState(currentState, event) {
  switch (currentState) {
    case SYN_GATE_STATE.IDLE:
      if (event === "ARM") return SYN_GATE_STATE.ARMED;
      if (event === "STOP") return SYN_GATE_STATE.STOPPED;
      if (event === "FAULT") return SYN_GATE_STATE.FAULTED;
      break;
    case SYN_GATE_STATE.ARMED:
      if (event === "RELEASE") return SYN_GATE_STATE.RELEASED;
      if (event === "TIMEOUT") return SYN_GATE_STATE.TIMED_OUT;
      if (event === "FAULT") return SYN_GATE_STATE.FAULTED;
      break;
    case SYN_GATE_STATE.RELEASED:
    case SYN_GATE_STATE.TIMED_OUT:
      if (event === "STOP") return SYN_GATE_STATE.STOPPED;
      break;
    case SYN_GATE_STATE.FAULTED:
      if (event === "STOP") return SYN_GATE_STATE.STOPPED;
      break;
  }
  throw new Error(
    `invalid state transition from ${currentState} on event ${event}`,
  );
}
