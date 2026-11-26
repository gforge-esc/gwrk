/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { createSynGateClient } from "./syn-gate-client.mjs";
import {
  MAX_ARMED_TTL_MS,
  validateScenarioBCausality,
  validateTimingReceipt,
} from "./syn-gate-policy.mjs";

export const PILOT_CASE_INVENTORY = Object.freeze([
  "direct_root_get_and_head",
  "browser_round_trip_dual_wire",
  "state_nonce_code_reuse_error_canaries",
  "negative_signature_claims_allowlist_removal",
  "authorization_selection_headers",
  "forwardauth_root_admission_wire",
  "quota_exhaustion_spoofed_xff",
  "shared_capacity_limit_1000_buckets",
  "forwardauth_failure_cancellation",
  "lost_responses_warmed_transport",
  "webhook_hmac_routing",
  "browser_mutations_csrf_logout",
  "tls_strict_sni_closed_port80",
  "response_process_leak_scan",
  "fail_closed_observation_barrier",
]);

/**
 * Executes Scenario B preparation using the bounded outer SYN-gate helper.
 * Proves cancellation before origin HTTP while armed, verifies rule removal
 * within the 1000 ms bound, and polls bounded UDP barriers until the same
 * (5-tuple, synEpoch) flow parks with zero origin HTTP requests.
 */
export async function prepareScenarioBWithSynGate({
  runId,
  synGateDir,
  requireRootOwnership = true,
  sendControl,
  observe,
  barrier,
  readHealth,
  sendCancelledDial,
  ttlMs = MAX_ARMED_TTL_MS,
  parkPollTimeoutMs = 2500,
  parkPollIntervalMs = 50,
  wait = sleep,
  now = () => Date.now(),
}) {
  assert.ok(
    typeof synGateDir === "string" && synGateDir.length > 0,
    "Scenario B requires approved synGateDir for bounded SYN-gate helper",
  );
  assert.ok(
    Number.isSafeInteger(ttlMs) && ttlMs > 0 && ttlMs <= MAX_ARMED_TTL_MS,
    `Scenario B SYN-gate ttlMs must be in 1..${MAX_ARMED_TTL_MS}`,
  );

  // 1. Clear idle keep-alive sockets so Scenario B dials a fresh origin connection.
  sendControl({ closeIdleConnections: true });
  const beforeObs = observe();
  const beforeBarrier = barrier();
  const beforeHealth = readHealth();

  const beforeHandshakes = beforeHealth.originTcpSummary.handshakesCompleted;
  const beforeParked =
    beforeHealth.originTcpSummary.zeroPriorRequestParkedConnections;
  const beforeSynFlowId =
    beforeHealth.originTcpSummary.lastSynSentOriginFlowId ?? null;

  const synGate = createSynGateClient({
    synGateDir,
    runId,
    requireRootOwnership,
    wait,
  });

  // 2. Arm bounded outer SYN gate (single opId=1, ttlMs <= 1000).
  const armedStatus = await synGate.arm({
    ttlMs,
    opId: 1,
    timeoutMs: MAX_ARMED_TTL_MS,
  });
  assert.equal(armedStatus.state, "ARMED", "SYN gate did not enter ARMED");
  assert.equal(
    armedStatus.ruleInstalled,
    true,
    "SYN gate did not report ruleInstalled",
  );

  let synSentOriginFlowId = null;
  let armedHandshakeDelta = null;
  let armedOriginHttpAttempts = null;
  let armedProxyDelta = null;
  let releaseReceipt = null;
  let primaryError = null;

  try {
    // 3. Send cancelled login dial while SYN gate is armed.
    const cancelledDial = await sendCancelledDial();
    assert.equal(
      cancelledDial.cancelled,
      true,
      "Scenario B armed dial must be cancelled before completion",
    );

    // 4. Barrier while armed to observe SYN_SENT flow and zero origin HTTP/proxy work.
    const armedBarrier = barrier();
    const armedHealth = readHealth();
    const armedObs = observe();

    synSentOriginFlowId =
      armedHealth.originTcpSummary.lastSynSentOriginFlowId ?? null;
    assert.ok(
      typeof synSentOriginFlowId === "string" && synSentOriginFlowId.length > 0,
      "Scenario B failed to observe SYN_SENT origin flow while armed",
    );
    if (beforeSynFlowId !== null) {
      assert.notEqual(
        synSentOriginFlowId,
        beforeSynFlowId,
        "Scenario B SYN_SENT flow did not advance past prior baseline flow",
      );
    }

    armedHandshakeDelta =
      armedHealth.originTcpSummary.handshakesCompleted - beforeHandshakes;
    armedOriginHttpAttempts = armedObs.loginAttempts - beforeObs.loginAttempts;
    armedProxyDelta =
      armedBarrier.proxyRequests.length - beforeBarrier.proxyRequests.length;

    assert.equal(
      armedHandshakeDelta,
      0,
      "origin TCP handshake completed while SYN gate was armed",
    );
    assert.equal(
      armedOriginHttpAttempts,
      0,
      "origin HTTP login attempt observed while SYN gate was armed",
    );
    assert.equal(
      armedProxyDelta,
      0,
      "downstream proxy request observed while SYN gate was armed",
    );
  } catch (error) {
    primaryError = error;
  } finally {
    // 5. Always release bounded SYN gate and verify removal receipt.
    try {
      const receipt = await synGate.release({
        opId: 1,
        timeoutMs: MAX_ARMED_TTL_MS,
      });
      releaseReceipt = validateTimingReceipt(receipt, {
        expectedRunId: runId,
      });
    } catch (releaseError) {
      if (!primaryError) {
        primaryError = releaseError;
      }
    }
  }

  if (primaryError) {
    throw primaryError;
  }

  // 6. Poll bounded barriers after release until Linux SYN retransmit completes
  // handshake and parks the exact same flow with zero origin HTTP requests.
  const parkDeadline = now() + parkPollTimeoutMs;
  let parkedHealth = null;
  let zeroPriorParkedFlowId = null;

  while (now() <= parkDeadline) {
    barrier();
    const health = readHealth();
    const parkedDelta =
      health.originTcpSummary.zeroPriorRequestParkedConnections - beforeParked;
    const candidateFlowId =
      health.originTcpSummary.lastZeroPriorParkedFlowId ?? null;
    if (parkedDelta >= 1 && candidateFlowId === synSentOriginFlowId) {
      parkedHealth = health;
      zeroPriorParkedFlowId = candidateFlowId;
      break;
    }
    const remaining = parkDeadline - now();
    if (remaining <= 0) break;
    await wait(Math.min(parkPollIntervalMs, remaining));
  }

  assert.ok(
    parkedHealth && zeroPriorParkedFlowId === synSentOriginFlowId,
    `Scenario B parked flow mismatch or timeout: expected ${synSentOriginFlowId}, got ${zeroPriorParkedFlowId}`,
  );
  const afterParkObs = observe();
  assert.equal(
    afterParkObs.loginAttempts,
    beforeObs.loginAttempts,
    "origin received HTTP login request during post-release unused-dial parking",
  );

  return {
    synSentOriginFlowId,
    zeroPriorParkedFlowId,
    armedHandshakeDelta,
    armedOriginHttpAttempts,
    armedProxyDelta,
    releaseReceipt,
  };
}

/**
 * Verifies post-drop Scenario B same-flow causality using the shared pure policy.
 */
export function verifyScenarioBAfterDrop({ preparation, afterDropHealth }) {
  const tcp = afterDropHealth?.originTcpSummary;
  assert.ok(tcp && typeof tcp === "object", "originTcpSummary missing");
  const observation = {
    synSentOriginFlowId: preparation.synSentOriginFlowId,
    zeroPriorParkedFlowId: preparation.zeroPriorParkedFlowId,
    lastZeroPriorReusedFlowId: tcp.lastZeroPriorReusedFlowId ?? null,
    zeroPriorRequestReusedConnections: tcp.zeroPriorRequestReusedConnections,
    zeroPriorRequestParkedConnections: tcp.zeroPriorRequestParkedConnections,
    armedHandshakeDelta: preparation.armedHandshakeDelta,
    unusedDialObserved: tcp.unusedDialObserved,
    armedOriginHttpAttempts: preparation.armedOriginHttpAttempts,
    armedProxyDelta: preparation.armedProxyDelta,
  };
  validateScenarioBCausality(observation);
  return observation;
}
