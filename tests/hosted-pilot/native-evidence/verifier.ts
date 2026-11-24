/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash, verify } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  parseAndVerifyCanonicalJson,
  toCanonicalJson,
} from "./canonical-json.ts";
import {
  type DetachedSignature,
  type NativeEvidenceEnvelope,
  validateEvidenceEnvelope,
} from "./evidence-schema.ts";
import { computeRuntimeManifest } from "./runtime-manifest.ts";
import {
  type NativeEvidenceTrustAnchor,
  loadTrustAnchor,
} from "./trust-anchor.ts";

export interface VerifyNativeEvidenceOptions {
  repoRoot?: string;
  trustAnchorPath?: string;
  envelopePath?: string;
  signaturePath?: string;
}

export interface VerificationResult {
  ok: boolean;
  envelope: NativeEvidenceEnvelope;
  trustAnchor: NativeEvidenceTrustAnchor;
  runtimeManifestSha256: string;
}

export async function verifyNativeEvidence(
  options: VerifyNativeEvidenceOptions = {},
): Promise<VerificationResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const trustAnchorPath =
    options.trustAnchorPath ??
    path.join(
      repoRoot,
      "specs/051-hosted-aws-pilot/contracts/native-evidence-trust-anchor.json",
    );
  const envelopePath =
    options.envelopePath ??
    path.join(
      repoRoot,
      "specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.json",
    );
  const signaturePath =
    options.signaturePath ??
    path.join(
      repoRoot,
      "specs/051-hosted-aws-pilot/evidence/native-evidence-envelope.sig.json",
    );

  // 1. Load trust anchor (fails if missing or tampered)
  if (!existsSync(trustAnchorPath)) {
    throw new Error(
      `Pinned reviewed trust anchor not found: ${trustAnchorPath}`,
    );
  }
  const trustAnchor = loadTrustAnchor(trustAnchorPath);

  // 2. Load envelope and signature files
  if (!existsSync(envelopePath)) {
    throw new Error(`Evidence envelope not found: ${envelopePath}`);
  }
  if (!existsSync(signaturePath)) {
    throw new Error(`Detached signature not found: ${signaturePath}`);
  }

  // 3. Parse and verify canonical JSON encoding of envelope
  const envelopeRaw = readFileSync(envelopePath, "utf8");
  const parsedEnvelope =
    parseAndVerifyCanonicalJson<NativeEvidenceEnvelope>(envelopeRaw);
  const envelope = validateEvidenceEnvelope(parsedEnvelope);

  // 4. Verify trust anchor hash binding
  const anchorCanonical = toCanonicalJson(trustAnchor);
  const computedAnchorSha256 = createHash("sha256")
    .update(anchorCanonical, "utf8")
    .digest("hex");
  if (computedAnchorSha256 !== envelope.trustAnchorSha256) {
    throw new Error(
      `Tampered trust anchor: envelope.trustAnchorSha256 (${envelope.trustAnchorSha256}) does not match computed anchor hash (${computedAnchorSha256})`,
    );
  }

  // 5. Parse and verify canonical JSON encoding of detached signature
  const signatureRaw = readFileSync(signaturePath, "utf8");
  const signature =
    parseAndVerifyCanonicalJson<DetachedSignature>(signatureRaw);

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

  // 6. Verify Ed25519 signature against canonical envelope bytes
  const canonicalEnvelopeBytes = Buffer.from(toCanonicalJson(envelope), "utf8");
  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(signature.signature, "base64");
  } catch (error) {
    throw new Error(
      `Invalid base64 signature encoding: ${(error as Error).message}`,
    );
  }

  let signatureValid = false;
  try {
    signatureValid = verify(
      undefined,
      canonicalEnvelopeBytes,
      trustAnchor.publicKeySpki,
      sigBytes,
    );
  } catch (error) {
    throw new Error(
      `Ed25519 signature verification error: ${(error as Error).message}`,
    );
  }

  if (!signatureValid) {
    throw new Error("Ed25519 signature verification failed");
  }

  // 7. Check legacy 041 script on disk
  const legacyScriptPath = path.join(
    repoRoot,
    "tests/hosted-auth-proof/gateway-proof.mjs",
  );
  if (!existsSync(legacyScriptPath)) {
    throw new Error(`Legacy 041 script missing at: ${legacyScriptPath}`);
  }
  const legacyBytes = readFileSync(legacyScriptPath);
  const legacySha256 = createHash("sha256").update(legacyBytes).digest("hex");
  if (legacySha256 !== envelope.legacy041ScriptSha256) {
    throw new Error(
      `Legacy 041 script changed: sha256 mismatch (expected ${envelope.legacy041ScriptSha256}, got ${legacySha256})`,
    );
  }

  // 8. Compute and verify current runtime manifest
  const { manifestSha256 } = await computeRuntimeManifest(repoRoot);
  if (manifestSha256 !== envelope.runtimeManifestSha256) {
    throw new Error(
      `Runtime manifest mismatch: files changed since evidence was signed (expected ${envelope.runtimeManifestSha256}, got ${manifestSha256})`,
    );
  }

  // 9. Verify Git commit ancestry
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", envelope.reviewedCommitSha, "HEAD"],
      {
        cwd: repoRoot,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
        },
      },
    );
  } catch {
    throw new Error(
      `Reviewed commit ${envelope.reviewedCommitSha} is not an ancestor of current HEAD`,
    );
  }

  return {
    ok: true,
    envelope,
    trustAnchor,
    runtimeManifestSha256: manifestSha256,
  };
}
