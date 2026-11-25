/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createReadStream,
  existsSync,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { isAllowedFixtureScriptName } from "../fixtures/bootstrap-observer.mjs";
import { runNativeFixture } from "../fixtures/run-native.mjs";
import { toCanonicalJson } from "./canonical-json.mjs";
import { validateEvidenceEnvelope } from "./evidence-schema.mjs";
import { computeRuntimeManifest } from "./runtime-manifest.mjs";
import { loadTrustAnchor } from "./trust-anchor.mjs";

const CHECKPOINT_PATH_RE =
  /^\/opt\/gwrk-verification\/([a-f0-9]{24})\/execution-checkpoint\.json$/;

async function defaultHashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/**
 * Pure builder for the unsigned canonical native evidence envelope.
 * Never creates keys or signs evidence; external authority verifies and signs.
 */
export function buildUnsignedEvidenceEnvelope({
  reviewedCommitSha,
  runtimeManifestSha256,
  legacy041ScriptSha256,
  trustAnchorSha256,
  buildProvenance,
  executionProof,
  rawReceipts,
}) {
  const envelope = {
    schemaVersion: "1.0.0",
    nativeSuiteStatus: "passed",
    livePilotAcceptance: false,
    reviewedCommitSha,
    runtimeManifestSha256,
    legacy041ScriptSha256,
    trustAnchorSha256,
    buildProvenance,
    executionProof,
    rawReceipts,
  };
  validateEvidenceEnvelope(envelope);
  return {
    envelope,
    canonicalJson: `${toCanonicalJson(envelope)}\n`,
  };
}

/**
 * Operator native execution adapter connecting gateway-production.mjs
 * --execute-native to the owned run-native controller and offline legacy staging.
 */
export async function executeOperatorNativeProof({
  checkpointPath,
  repoRoot = process.cwd(),
  trustAnchorPath,
  trustAnchorSha256,
  platform = process.platform,
  getuid = () => (typeof process.getuid === "function" ? process.getuid() : -1),
  files = { existsSync, lstatSync, readFileSync, writeFileSync },
  hashFile = defaultHashFile,
  runNative = runNativeFixture,
  computeManifest = computeRuntimeManifest,
  loadAnchor = loadTrustAnchor,
} = {}) {
  if (platform !== "linux") {
    throw new Error(
      `--execute-native requires isolated Linux host execution (current platform: ${platform})`,
    );
  }
  if (getuid() !== 0) {
    throw new Error(
      `--execute-native requires root operator execution (uid 0, got ${getuid()})`,
    );
  }
  if (typeof checkpointPath !== "string" || !checkpointPath) {
    throw new Error(
      "--execute-native requires --checkpoint /opt/gwrk-verification/<runId>/execution-checkpoint.json",
    );
  }
  const pathMatch = CHECKPOINT_PATH_RE.exec(checkpointPath);
  if (!pathMatch) {
    throw new Error(
      `Invalid checkpoint path: expected /opt/gwrk-verification/<24-hex>/execution-checkpoint.json, got ${checkpointPath}`,
    );
  }
  const expectedRunId = pathMatch[1];

  const meta = files.lstatSync(checkpointPath);
  assert.equal(meta.isFile(), true, "checkpoint must be a regular file");
  assert.equal(
    meta.isSymbolicLink(),
    false,
    "checkpoint must not be a symlink",
  );
  assert.equal(meta.uid, 0, "checkpoint must be owned by uid 0");
  assert.equal(meta.mode & 0o777, 0o600, "checkpoint must have file mode 0600");

  const receipt = JSON.parse(files.readFileSync(checkpointPath, "utf8"));
  assert.equal(
    receipt.runId,
    expectedRunId,
    "checkpoint runId does not match checkpoint directory",
  );
  assert.equal(
    receipt.approvedPrivilegedExecution,
    true,
    "checkpoint approvedPrivilegedExecution must be true",
  );
  assert.equal(
    receipt.purpose,
    "acceptance",
    "--execute-native operator acceptance requires purpose === 'acceptance'",
  );
  assert.equal(
    receipt.reviewedSource,
    true,
    "--execute-native operator acceptance requires reviewedSource === true",
  );
  assert.equal(
    receipt.approvedPassiveNetRaw,
    true,
    "--execute-native operator acceptance requires approvedPassiveNetRaw === true",
  );
  assert.equal(
    receipt.approvedScenarioBSynGate,
    true,
    "--execute-native operator acceptance requires approvedScenarioBSynGate === true",
  );

  const root = `/opt/gwrk-verification/${expectedRunId}`;
  const scriptManifestPath = `${root}/input/script-manifest.json`;
  assert.equal(
    await hashFile(scriptManifestPath),
    receipt.scriptManifestSha256,
    "runtime script manifest differs from checkpoint",
  );
  const scriptManifest = JSON.parse(
    files.readFileSync(scriptManifestPath, "utf8"),
  );
  for (const [name, digest] of Object.entries(scriptManifest)) {
    assert.ok(
      isAllowedFixtureScriptName(name),
      `script manifest entry has invalid filename: ${name}`,
    );
    const entryPath = `${root}/input/fixtures/${name}`;
    const entryMeta = files.lstatSync(entryPath);
    assert.ok(
      entryMeta.isFile() && !entryMeta.isSymbolicLink() && entryMeta.uid === 0,
      `invalid fixture script ownership or type: ${name}`,
    );
    assert.equal(
      await hashFile(entryPath),
      digest,
      `runtime script differs from checkpoint: ${name}`,
    );
  }

  assert.equal(
    await hashFile(`${root}/input/preload-images.tar`),
    receipt.archiveSha256,
    "preload archive hash differs from checkpoint",
  );
  const images = JSON.parse(
    files.readFileSync(`${root}/input/loaded-images.json`, "utf8"),
  );

  const { manifestSha256 } = await computeManifest(repoRoot);
  if (
    !receipt.runtimeManifestSha256 ||
    typeof receipt.runtimeManifestSha256 !== "string" ||
    receipt.runtimeManifestSha256 !== manifestSha256
  ) {
    throw new Error(
      `Runtime manifest mismatch before native execution (checkpoint ${receipt.runtimeManifestSha256} vs current ${manifestSha256})`,
    );
  }
  if (!receipt.nodeImageId || images.node !== receipt.nodeImageId) {
    throw new Error(
      `Node image ID mismatch before native execution (checkpoint ${receipt.nodeImageId} vs loaded ${images.node})`,
    );
  }

  files.writeFileSync(
    `${root}/input/runtime-receipt.json`,
    JSON.stringify(receipt),
    { mode: 0o600 },
  );

  await runNative({ runId: expectedRunId, root, receipt, images });

  const nativeResult = JSON.parse(
    files.readFileSync(`${root}/native-result.json`, "utf8"),
  );
  assert.equal(
    nativeResult.runId,
    expectedRunId,
    `native-result runId mismatch: expected ${expectedRunId}, got ${nativeResult.runId}`,
  );
  assert.equal(
    nativeResult.nativeSuiteStatus,
    "passed",
    `native suite did not pass (status: ${nativeResult.nativeSuiteStatus})`,
  );
  assert.equal(
    nativeResult.livePilotAcceptance,
    false,
    "livePilotAcceptance must remain false for synthetic native suite",
  );

  const cleanup = JSON.parse(
    files.readFileSync(`${root}/native-cleanup.json`, "utf8"),
  );
  assert.equal(
    cleanup.runId,
    expectedRunId,
    `native-cleanup runId mismatch: expected ${expectedRunId}, got ${cleanup.runId}`,
  );
  assert.equal(
    cleanup.cleanupComplete,
    true,
    "native cleanup receipt did not record cleanupComplete: true",
  );
  assert.equal(
    cleanup.childrenDrained,
    true,
    "native cleanup receipt did not record childrenDrained: true",
  );
  assert.equal(
    cleanup.hostMountsUnderChild,
    false,
    "native cleanup receipt must record hostMountsUnderChild: false",
  );

  const ownership = JSON.parse(
    files.readFileSync(`${root}/controller-ownership.json`, "utf8"),
  );
  assert.equal(
    ownership.runId,
    expectedRunId,
    `controller-ownership runId mismatch: expected ${expectedRunId}, got ${ownership.runId}`,
  );
  assert.equal(
    ownership.nestedDaemonOnly,
    true,
    "controller ownership must prove nestedDaemonOnly: true",
  );

  const pilotReceiptRaw = files.readFileSync(
    `${root}/pilot-proof-result.json`,
    "utf8",
  );
  const legacyResultObj = JSON.parse(
    files.readFileSync(`${root}/legacy-proof-result.json`, "utf8"),
  );
  const legacyReceiptRaw = legacyResultObj.rawReceipt;

  const legacyScriptPath = path.join(
    repoRoot,
    "tests/hosted-auth-proof/gateway-proof.mjs",
  );
  const legacy041ScriptSha256 = createHash("sha256")
    .update(files.readFileSync(legacyScriptPath))
    .digest("hex");
  assert.equal(
    nativeResult.legacyProof.scriptSha256,
    legacy041ScriptSha256,
    "executed legacy script hash differs from repository tests/hosted-auth-proof/gateway-proof.mjs",
  );

  let resolvedTrustAnchorSha256 = trustAnchorSha256 ?? null;
  const effectiveAnchorPath =
    trustAnchorPath ??
    path.join(
      repoRoot,
      "specs/051-hosted-aws-pilot/contracts/native-evidence-trust-anchor.json",
    );
  if (!resolvedTrustAnchorSha256 && files.existsSync(effectiveAnchorPath)) {
    const anchor = loadAnchor(effectiveAnchorPath);
    resolvedTrustAnchorSha256 = createHash("sha256")
      .update(toCanonicalJson(anchor), "utf8")
      .digest("hex");
  }

  const buildProvenance = {
    architecture: "linux/amd64",
    applicationArtifact: {
      identity:
        receipt.applicationArtifactIdentity ??
        `gwrk-node-${receipt.sourceCommit}`,
      sha256:
        receipt.applicationArtifactSha256 ??
        images.node.replace(/^sha256:/, ""),
      runtimeManifestSha256: manifestSha256,
    },
    imagePayloadMap: {
      dind: {
        role: "dind",
        sourceDigest: receipt.outerImage.split("@")[1] ?? receipt.daemonImageId,
        loadedImageId: receipt.daemonImageId,
      },
      application: {
        role: "application",
        sourceDigest: images.node,
        loadedImageId: images.node,
      },
      traefik: {
        role: "traefik",
        sourceDigest:
          "sha256:9c437ac4f09ce6f4980a8544902d3475fdf70a1a7c578729581d2535dfa7d635",
        loadedImageId: images.traefik,
      },
      oauth2_proxy: {
        role: "oauth2_proxy",
        sourceDigest:
          "sha256:c3415e8660af553f5e18f5d90db050614c02493c0ac6260ac59442f6d9b12048",
        loadedImageId: images.proxy,
      },
      legacy_node20: {
        role: "legacy_node20",
        sourceDigest:
          "sha256:09e2b3d9726018aecf269bd35325f46bf75046a643a66d28360ec71132750ec8",
        loadedImageId: images.issuerNode,
      },
      legacy_nginx: {
        role: "legacy_nginx",
        sourceDigest:
          "sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311",
        loadedImageId: images.nginx,
      },
    },
  };

  const executionProof = {
    runId: expectedRunId,
    ownedNamespaceProof: {
      controllerContainer: ownership.name,
      nestedDaemonOnly: true,
    },
    cleanupComplete: true,
    hostMountsUnderChild: cleanup.hostMountsUnderChild,
    pilotProof: nativeResult.pilotProof,
    legacyProof: nativeResult.legacyProof,
  };

  const rawReceipts = {
    pilotReceipt: pilotReceiptRaw,
    legacyReceipt: legacyReceiptRaw,
  };

  const candidateTrustAnchorSha256 =
    resolvedTrustAnchorSha256 ?? "0".repeat(64);
  const candidateEnvelope = {
    schemaVersion: "1.0.0",
    nativeSuiteStatus: "passed",
    livePilotAcceptance: false,
    reviewedCommitSha: receipt.sourceCommit,
    runtimeManifestSha256: manifestSha256,
    legacy041ScriptSha256,
    trustAnchorSha256: candidateTrustAnchorSha256,
    buildProvenance,
    executionProof,
    rawReceipts,
  };
  validateEvidenceEnvelope(candidateEnvelope, {
    expectedManifestSha256: manifestSha256,
    expectedTrustAnchorSha256: candidateTrustAnchorSha256,
  });
  toCanonicalJson(candidateEnvelope);

  const unsignedBundle = {
    schemaVersion: "1.0.0",
    nativeSuiteStatus: "passed",
    livePilotAcceptance: false,
    reviewedCommitSha: receipt.sourceCommit,
    runtimeManifestSha256: manifestSha256,
    legacy041ScriptSha256,
    trustAnchorSha256: resolvedTrustAnchorSha256,
    buildProvenance,
    executionProof,
    rawReceipts,
    signingStatus: "unsigned_pending_external_operator_authority",
  };
  files.writeFileSync(
    `${root}/unsigned-evidence-bundle.json`,
    `${toCanonicalJson(unsignedBundle)}\n`,
    { mode: 0o600 },
  );

  let canonicalEnvelopePath = null;
  let envelope = null;
  if (resolvedTrustAnchorSha256) {
    envelope = candidateEnvelope;
    canonicalEnvelopePath = `${root}/unsigned-evidence-envelope.json`;
    files.writeFileSync(
      canonicalEnvelopePath,
      `${toCanonicalJson(envelope)}\n`,
      {
        mode: 0o600,
      },
    );
  }

  return {
    ok: true,
    runId: expectedRunId,
    nativeSuiteStatus: "passed",
    livePilotAcceptance: false,
    unsignedBundlePath: `${root}/unsigned-evidence-bundle.json`,
    canonicalEnvelopePath,
    envelope,
    nativeResult,
  };
}
