/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";

export const REQUIRED_PILOT_CASES = [
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
] as const;

export const REQUIRED_IMAGE_ROLES = [
  "dind",
  "application",
  "traefik",
  "oauth2_proxy",
  "legacy_node20",
  "legacy_nginx",
] as const;

export interface ImagePayloadEntry {
  role: string;
  sourceDigest: string;
  loadedImageId: string;
}

export interface NativeEvidenceEnvelope {
  schemaVersion: "1.0.0";
  nativeSuiteStatus: "passed";
  livePilotAcceptance: false;
  reviewedCommitSha: string;
  runtimeManifestSha256: string;
  legacy041ScriptSha256: string;
  trustAnchorSha256: string;
  buildProvenance: {
    architecture: "linux/amd64";
    applicationArtifact: {
      identity: string;
      sha256: string;
      runtimeManifestSha256: string;
    };
    imagePayloadMap: Record<
      (typeof REQUIRED_IMAGE_ROLES)[number],
      ImagePayloadEntry
    >;
  };
  executionProof: {
    runId: string;
    ownedNamespaceProof: {
      controllerContainer: string;
      nestedDaemonOnly: boolean;
    };
    cleanupComplete: true;
    hostMountsUnderChild: false;
    pilotProof: {
      exitCode: 0;
      cases: string[];
      captureDrops: 0;
      captureFaults: 0;
      leakedSecrets: 0;
      rawReceiptSha256: string;
    };
    legacyProof: {
      exitCode: 0;
      scriptSha256: string;
      successMarker: "Hosted sign-in fixture passed";
      cleanupComplete: true;
      rawReceiptSha256: string;
    };
  };
  rawReceipts: {
    pilotReceipt: string;
    legacyReceipt: string;
  };
}

export interface DetachedSignature {
  schemaVersion: "1.0.0";
  keyId: string;
  signature: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function validateEvidenceEnvelope(
  envelope: unknown,
): NativeEvidenceEnvelope {
  if (!envelope || typeof envelope !== "object") {
    throw new Error("Evidence envelope must be an object");
  }

  const env = envelope as Record<string, unknown>;

  if (env.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported envelope schemaVersion: ${String(env.schemaVersion)}`,
    );
  }

  if (env.nativeSuiteStatus !== "passed") {
    throw new Error(
      `nativeSuiteStatus must be 'passed', got '${String(env.nativeSuiteStatus)}'`,
    );
  }

  if (env.livePilotAcceptance !== false) {
    throw new Error(
      `livePilotAcceptance must be false, got ${String(env.livePilotAcceptance)}`,
    );
  }

  if (
    typeof env.reviewedCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(env.reviewedCommitSha)
  ) {
    throw new Error(
      `Invalid reviewedCommitSha: ${String(env.reviewedCommitSha)}`,
    );
  }

  if (
    typeof env.runtimeManifestSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(env.runtimeManifestSha256)
  ) {
    throw new Error(
      `Invalid runtimeManifestSha256: ${String(env.runtimeManifestSha256)}`,
    );
  }

  if (
    typeof env.legacy041ScriptSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(env.legacy041ScriptSha256)
  ) {
    throw new Error(
      `Invalid legacy041ScriptSha256: ${String(env.legacy041ScriptSha256)}`,
    );
  }

  if (
    typeof env.trustAnchorSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(env.trustAnchorSha256)
  ) {
    throw new Error(
      `Invalid trustAnchorSha256: ${String(env.trustAnchorSha256)}`,
    );
  }

  // Build provenance
  const build = env.buildProvenance as Record<string, unknown> | undefined;
  if (!build || typeof build !== "object") {
    throw new Error("Missing buildProvenance");
  }

  if (build.architecture !== "linux/amd64") {
    throw new Error(
      `buildProvenance.architecture must be 'linux/amd64', got '${String(build.architecture)}'`,
    );
  }

  const appArtifact = build.applicationArtifact as
    | Record<string, unknown>
    | undefined;
  if (!appArtifact || typeof appArtifact !== "object") {
    throw new Error("Missing buildProvenance.applicationArtifact");
  }

  if (appArtifact.runtimeManifestSha256 !== env.runtimeManifestSha256) {
    throw new Error(
      `Stale build: applicationArtifact.runtimeManifestSha256 (${String(appArtifact.runtimeManifestSha256)}) does not match envelope runtimeManifestSha256 (${env.runtimeManifestSha256})`,
    );
  }

  if (typeof appArtifact.identity !== "string" || !appArtifact.identity) {
    throw new Error("Invalid applicationArtifact.identity");
  }

  if (
    typeof appArtifact.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(appArtifact.sha256)
  ) {
    throw new Error(
      `Invalid applicationArtifact.sha256: ${String(appArtifact.sha256)}`,
    );
  }

  // Image payload map
  const imageMap = build.imagePayloadMap as Record<string, unknown> | undefined;
  if (!imageMap || typeof imageMap !== "object") {
    throw new Error("Missing buildProvenance.imagePayloadMap");
  }

  const actualRoles = Object.keys(imageMap);
  for (const role of REQUIRED_IMAGE_ROLES) {
    if (!imageMap[role]) {
      throw new Error(`Image payload map missing role: ${role}`);
    }
    const entry = imageMap[role] as Record<string, unknown>;
    if (entry.role !== role) {
      throw new Error(
        `Image payload entry role mismatch: expected ${role}, got ${String(entry.role)}`,
      );
    }
    if (
      typeof entry.sourceDigest !== "string" ||
      !entry.sourceDigest.startsWith("sha256:")
    ) {
      throw new Error(
        `Invalid sourceDigest for image role ${role}: ${String(entry.sourceDigest)}`,
      );
    }
    if (
      typeof entry.loadedImageId !== "string" ||
      !entry.loadedImageId.startsWith("sha256:")
    ) {
      throw new Error(
        `Invalid loadedImageId for image role ${role}: ${String(entry.loadedImageId)}`,
      );
    }
  }

  if (actualRoles.length !== REQUIRED_IMAGE_ROLES.length) {
    throw new Error(
      `Image payload map contains invalid or extra roles: ${actualRoles.filter((r) => !REQUIRED_IMAGE_ROLES.includes(r as (typeof REQUIRED_IMAGE_ROLES)[number])).join(", ")}`,
    );
  }

  // Execution proof
  const exec = env.executionProof as Record<string, unknown> | undefined;
  if (!exec || typeof exec !== "object") {
    throw new Error("Missing executionProof");
  }

  if (typeof exec.runId !== "string" || !/^[a-f0-9]{24}$/.test(exec.runId)) {
    throw new Error(`Invalid runId in executionProof: ${String(exec.runId)}`);
  }

  if (exec.cleanupComplete !== true) {
    throw new Error(
      `cleanupComplete must be true, got ${String(exec.cleanupComplete)}`,
    );
  }

  if (exec.hostMountsUnderChild !== false) {
    throw new Error(
      `hostMountsUnderChild must be false, got ${String(exec.hostMountsUnderChild)}`,
    );
  }

  // Raw receipts
  const raw = env.rawReceipts as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== "object") {
    throw new Error("Missing rawReceipts");
  }
  if (
    typeof raw.pilotReceipt !== "string" ||
    typeof raw.legacyReceipt !== "string"
  ) {
    throw new Error(
      "rawReceipts must contain string pilotReceipt and legacyReceipt",
    );
  }

  // Pilot proof
  const pilot = exec.pilotProof as Record<string, unknown> | undefined;
  if (!pilot || typeof pilot !== "object") {
    throw new Error("Missing executionProof.pilotProof");
  }

  if (pilot.exitCode !== 0) {
    throw new Error(
      `pilotProof.exitCode must be 0, got ${String(pilot.exitCode)}`,
    );
  }

  if (pilot.captureDrops !== 0) {
    throw new Error(
      `captureDrops must be 0, got ${String(pilot.captureDrops)}`,
    );
  }

  if (pilot.captureFaults !== 0) {
    throw new Error(
      `captureFaults must be 0, got ${String(pilot.captureFaults)}`,
    );
  }

  if (pilot.leakedSecrets !== 0) {
    throw new Error(
      `leakedSecrets must be 0, got ${String(pilot.leakedSecrets)}`,
    );
  }

  if (!Array.isArray(pilot.cases)) {
    throw new Error("pilotProof.cases must be an array");
  }

  const missingCases = REQUIRED_PILOT_CASES.filter(
    (c) => !pilot.cases?.includes(c),
  );
  if (missingCases.length > 0) {
    throw new Error(
      `Incomplete cases: missing required pilot case inventory: ${missingCases.join(", ")}`,
    );
  }

  const expectedPilotReceiptSha = sha256Hex(raw.pilotReceipt);
  if (pilot.rawReceiptSha256 !== expectedPilotReceiptSha) {
    throw new Error(
      `pilotProof.rawReceiptSha256 mismatch (expected ${expectedPilotReceiptSha}, got ${String(pilot.rawReceiptSha256)})`,
    );
  }

  // Legacy proof
  const legacy = exec.legacyProof as Record<string, unknown> | undefined;
  if (!legacy || typeof legacy !== "object") {
    throw new Error("Missing executionProof.legacyProof");
  }

  if (legacy.exitCode !== 0) {
    throw new Error(
      `legacyProof.exitCode must be 0, got ${String(legacy.exitCode)}`,
    );
  }

  if (legacy.scriptSha256 !== env.legacy041ScriptSha256) {
    throw new Error(
      `legacyProof.scriptSha256 mismatch with envelope.legacy041ScriptSha256 (got ${String(legacy.scriptSha256)}, expected ${env.legacy041ScriptSha256})`,
    );
  }

  if (legacy.successMarker !== "Hosted sign-in fixture passed") {
    throw new Error(
      `legacyProof.successMarker invalid: ${String(legacy.successMarker)}`,
    );
  }

  if (legacy.cleanupComplete !== true) {
    throw new Error(
      `legacyProof.cleanupComplete must be true, got ${String(legacy.cleanupComplete)}`,
    );
  }

  const expectedLegacyReceiptSha = sha256Hex(raw.legacyReceipt);
  if (legacy.rawReceiptSha256 !== expectedLegacyReceiptSha) {
    throw new Error(
      `legacyProof.rawReceiptSha256 mismatch (expected ${expectedLegacyReceiptSha}, got ${String(legacy.rawReceiptSha256)})`,
    );
  }

  return envelope as NativeEvidenceEnvelope;
}
