/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { assertExactKeys } from "./trust-anchor.mjs";

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
];

export const REQUIRED_IMAGE_ROLES = [
  "dind",
  "application",
  "traefik",
  "oauth2_proxy",
  "legacy_node20",
  "legacy_nginx",
];

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const HEX_40_REGEX = /^[0-9a-f]{40}$/;
const HEX_64_REGEX = /^[0-9a-f]{64}$/;
const RUN_ID_REGEX = /^[0-9a-f]{24}$/;
const IMAGE_DIGEST_REGEX = /^sha256:[0-9a-f]{64}$/;

const ALLOWED_ENVELOPE_KEYS = [
  "schemaVersion",
  "nativeSuiteStatus",
  "livePilotAcceptance",
  "reviewedCommitSha",
  "runtimeManifestSha256",
  "legacy041ScriptSha256",
  "trustAnchorSha256",
  "buildProvenance",
  "executionProof",
  "rawReceipts",
];

const ALLOWED_BUILD_KEYS = [
  "architecture",
  "applicationArtifact",
  "imagePayloadMap",
];

const ALLOWED_APPLICATION_ARTIFACT_KEYS = [
  "identity",
  "sha256",
  "runtimeManifestSha256",
];

const ALLOWED_IMAGE_ENTRY_KEYS = ["role", "sourceDigest", "loadedImageId"];

const ALLOWED_EXECUTION_KEYS = [
  "runId",
  "ownedNamespaceProof",
  "cleanupComplete",
  "hostMountsUnderChild",
  "pilotProof",
  "legacyProof",
];

const ALLOWED_OWNED_NAMESPACE_KEYS = [
  "controllerContainer",
  "nestedDaemonOnly",
];

const ALLOWED_RAW_RECEIPTS_KEYS = ["pilotReceipt", "legacyReceipt"];

const ALLOWED_PILOT_PROOF_KEYS = [
  "exitCode",
  "cases",
  "captureDrops",
  "captureFaults",
  "leakedSecrets",
  "rawReceiptSha256",
];

const ALLOWED_LEGACY_PROOF_KEYS = [
  "exitCode",
  "scriptSha256",
  "successMarker",
  "cleanupComplete",
  "rawReceiptSha256",
];

const ALLOWED_SIGNATURE_KEYS = ["schemaVersion", "keyId", "signature"];

export function validateEvidenceEnvelope(envelope) {
  assertExactKeys(envelope, ALLOWED_ENVELOPE_KEYS, "Evidence envelope");

  const env = envelope;

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
    !HEX_40_REGEX.test(env.reviewedCommitSha)
  ) {
    throw new Error(
      `Invalid reviewedCommitSha: ${String(env.reviewedCommitSha)}`,
    );
  }

  if (
    typeof env.runtimeManifestSha256 !== "string" ||
    !HEX_64_REGEX.test(env.runtimeManifestSha256)
  ) {
    throw new Error(
      `Invalid runtimeManifestSha256: ${String(env.runtimeManifestSha256)}`,
    );
  }

  if (
    typeof env.legacy041ScriptSha256 !== "string" ||
    !HEX_64_REGEX.test(env.legacy041ScriptSha256)
  ) {
    throw new Error(
      `Invalid legacy041ScriptSha256: ${String(env.legacy041ScriptSha256)}`,
    );
  }

  if (
    typeof env.trustAnchorSha256 !== "string" ||
    !HEX_64_REGEX.test(env.trustAnchorSha256)
  ) {
    throw new Error(
      `Invalid trustAnchorSha256: ${String(env.trustAnchorSha256)}`,
    );
  }

  // 1. Build provenance
  const build = env.buildProvenance;
  assertExactKeys(build, ALLOWED_BUILD_KEYS, "buildProvenance");

  if (build.architecture !== "linux/amd64") {
    throw new Error(
      `buildProvenance.architecture must be 'linux/amd64', got '${String(build.architecture)}'`,
    );
  }

  const appArtifact = build.applicationArtifact;
  assertExactKeys(
    appArtifact,
    ALLOWED_APPLICATION_ARTIFACT_KEYS,
    "buildProvenance.applicationArtifact",
  );

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
    !HEX_64_REGEX.test(appArtifact.sha256)
  ) {
    throw new Error(
      `Invalid applicationArtifact.sha256: ${String(appArtifact.sha256)}`,
    );
  }

  // Image payload map
  const imageMap = build.imagePayloadMap;
  if (!imageMap || typeof imageMap !== "object" || Array.isArray(imageMap)) {
    throw new Error("Missing buildProvenance.imagePayloadMap");
  }

  for (const role of REQUIRED_IMAGE_ROLES) {
    if (!(role in imageMap)) {
      throw new Error(`Image payload map missing role: ${role}`);
    }
  }

  assertExactKeys(
    imageMap,
    REQUIRED_IMAGE_ROLES,
    "buildProvenance.imagePayloadMap",
  );

  for (const role of REQUIRED_IMAGE_ROLES) {
    const entry = imageMap[role];
    assertExactKeys(
      entry,
      ALLOWED_IMAGE_ENTRY_KEYS,
      `imagePayloadMap[${role}]`,
    );
    if (entry.role !== role) {
      throw new Error(
        `Image payload entry role mismatch: expected ${role}, got ${String(entry.role)}`,
      );
    }
    if (
      typeof entry.sourceDigest !== "string" ||
      !IMAGE_DIGEST_REGEX.test(entry.sourceDigest)
    ) {
      throw new Error(
        `Invalid sourceDigest for image role ${role}: ${String(entry.sourceDigest)}`,
      );
    }
    if (
      typeof entry.loadedImageId !== "string" ||
      !IMAGE_DIGEST_REGEX.test(entry.loadedImageId)
    ) {
      throw new Error(
        `Invalid loadedImageId for image role ${role}: ${String(entry.loadedImageId)}`,
      );
    }
  }

  // 2. Execution proof
  const exec = env.executionProof;
  assertExactKeys(exec, ALLOWED_EXECUTION_KEYS, "executionProof");

  if (typeof exec.runId !== "string" || !RUN_ID_REGEX.test(exec.runId)) {
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

  // B-02: ownedNamespaceProof validation
  const owned = exec.ownedNamespaceProof;
  assertExactKeys(
    owned,
    ALLOWED_OWNED_NAMESPACE_KEYS,
    "executionProof.ownedNamespaceProof",
  );

  if (owned.nestedDaemonOnly !== true) {
    throw new Error(
      `executionProof.ownedNamespaceProof.nestedDaemonOnly must be true, got ${String(owned.nestedDaemonOnly)}`,
    );
  }

  const expectedContainer = `gwrk-051-controller-${exec.runId}`;
  if (owned.controllerContainer !== expectedContainer) {
    throw new Error(
      `executionProof.ownedNamespaceProof.controllerContainer mismatch (expected '${expectedContainer}', got '${String(owned.controllerContainer)}')`,
    );
  }

  // 3. Raw receipts
  const raw = env.rawReceipts;
  assertExactKeys(raw, ALLOWED_RAW_RECEIPTS_KEYS, "rawReceipts");

  if (
    typeof raw.pilotReceipt !== "string" ||
    raw.pilotReceipt.trim().length === 0
  ) {
    throw new Error("rawReceipts.pilotReceipt must be a non-empty string");
  }

  if (
    typeof raw.legacyReceipt !== "string" ||
    raw.legacyReceipt.trim().length === 0
  ) {
    throw new Error("rawReceipts.legacyReceipt must be a non-empty string");
  }

  // B-07: legacyReceipt must contain success marker
  if (!raw.legacyReceipt.includes("Hosted sign-in fixture passed")) {
    throw new Error(
      "rawReceipts.legacyReceipt missing required success marker 'Hosted sign-in fixture passed'",
    );
  }

  // B-07: pilotReceipt must not contain diagnostic or behavioral-red flags
  try {
    const parsedPilot = JSON.parse(raw.pilotReceipt);
    if (
      parsedPilot &&
      typeof parsedPilot === "object" &&
      (parsedPilot.diagnostic === true ||
        parsedPilot.behavioralRed === true ||
        parsedPilot.behavioral_red === true)
    ) {
      throw new Error(
        "pilotReceipt must not contain diagnostic or behavioral-red flags",
      );
    }
  } catch (e) {
    if (e.message.includes("diagnostic or behavioral-red")) throw e;
  }
  if (
    /"(diagnostic|behavioralRed|behavioral_red)"\s*:\s*true/i.test(
      raw.pilotReceipt,
    )
  ) {
    throw new Error(
      "pilotReceipt must not contain diagnostic or behavioral-red flags",
    );
  }

  // 4. Pilot proof
  const pilot = exec.pilotProof;
  assertExactKeys(pilot, ALLOWED_PILOT_PROOF_KEYS, "executionProof.pilotProof");

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

  // B-07: pilotProof.cases exact unique set equality with REQUIRED_PILOT_CASES
  if (!Array.isArray(pilot.cases)) {
    throw new Error("pilotProof.cases must be an array");
  }

  if (!pilot.cases.every((c) => typeof c === "string")) {
    throw new Error("Every entry in pilotProof.cases must be a string");
  }

  const caseSet = new Set(pilot.cases);
  const requiredCaseSet = new Set(REQUIRED_PILOT_CASES);
  const missingCases = REQUIRED_PILOT_CASES.filter((c) => !caseSet.has(c));
  if (missingCases.length > 0) {
    throw new Error(
      `Incomplete cases: missing required pilot case inventory: ${missingCases.join(", ")}`,
    );
  }

  if (caseSet.size !== pilot.cases.length) {
    throw new Error("pilotProof.cases contains duplicate entries");
  }

  for (const c of pilot.cases) {
    if (!requiredCaseSet.has(c)) {
      throw new Error(`Unexpected case in pilotProof.cases: ${c}`);
    }
  }

  const expectedPilotReceiptSha = sha256Hex(raw.pilotReceipt);
  if (pilot.rawReceiptSha256 !== expectedPilotReceiptSha) {
    throw new Error(
      `pilotProof.rawReceiptSha256 mismatch (expected ${expectedPilotReceiptSha}, got ${String(pilot.rawReceiptSha256)})`,
    );
  }
  if (!HEX_64_REGEX.test(pilot.rawReceiptSha256)) {
    throw new Error(
      `Invalid pilotProof.rawReceiptSha256 format: ${String(pilot.rawReceiptSha256)}`,
    );
  }

  // 5. Legacy proof
  const legacy = exec.legacyProof;
  assertExactKeys(
    legacy,
    ALLOWED_LEGACY_PROOF_KEYS,
    "executionProof.legacyProof",
  );

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

  if (!HEX_64_REGEX.test(legacy.scriptSha256)) {
    throw new Error(
      `Invalid legacyProof.scriptSha256 format: ${String(legacy.scriptSha256)}`,
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
  if (!HEX_64_REGEX.test(legacy.rawReceiptSha256)) {
    throw new Error(
      `Invalid legacyProof.rawReceiptSha256 format: ${String(legacy.rawReceiptSha256)}`,
    );
  }

  return envelope;
}

export function validateDetachedSignature(signature, trustAnchor) {
  assertExactKeys(signature, ALLOWED_SIGNATURE_KEYS, "Detached signature");

  if (signature.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported signature schemaVersion: ${String(signature.schemaVersion)}`,
    );
  }

  if (signature.keyId !== trustAnchor.keyId) {
    throw new Error(
      `Signature keyId mismatch with trust anchor (untrusted key): expected ${trustAnchor.keyId}, got ${signature.keyId}`,
    );
  }

  if (typeof signature.signature !== "string") {
    throw new Error("Detached signature.signature must be a base64 string");
  }

  let sigBytes;
  try {
    sigBytes = Buffer.from(signature.signature, "base64");
  } catch (error) {
    throw new Error(`Invalid base64 signature encoding: ${error.message}`);
  }

  if (sigBytes.length !== 64) {
    throw new Error(
      `Signature invalid: expected 64 bytes for Ed25519, got ${sigBytes.length}`,
    );
  }

  // Exact round-trip check rejects malleable / non-canonical base64 strings with trailing characters
  if (sigBytes.toString("base64") !== signature.signature) {
    throw new Error(
      "Signature invalid: detached signature.signature contains non-canonical base64 encoding",
    );
  }

  return { sigBytes, signature };
}
