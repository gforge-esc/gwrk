/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseAndVerifyCanonicalJson } from "./canonical-json.ts";

export interface NativeEvidenceTrustAnchor {
  schemaVersion: "1.0.0";
  algorithm: "ed25519";
  keyId: string;
  publicKeySpki: string;
  role: "operator-root";
}

export function validateTrustAnchor(
  anchor: unknown,
): NativeEvidenceTrustAnchor {
  if (!anchor || typeof anchor !== "object") {
    throw new Error("Trust anchor must be an object");
  }
  const rec = anchor as Record<string, unknown>;
  if (rec.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported trust anchor schema version: ${String(rec.schemaVersion)}`,
    );
  }
  if (rec.algorithm !== "ed25519") {
    throw new Error(`Unsupported algorithm: ${String(rec.algorithm)}`);
  }
  if (rec.role !== "operator-root") {
    throw new Error(`Invalid trust anchor role: ${String(rec.role)}`);
  }
  if (
    typeof rec.publicKeySpki !== "string" ||
    !rec.publicKeySpki.includes("PUBLIC KEY")
  ) {
    throw new Error("Invalid or missing publicKeySpki");
  }

  try {
    const key = createPublicKey(rec.publicKeySpki);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `Expected Ed25519 key, got ${String(key.asymmetricKeyType)}`,
      );
    }
  } catch (error) {
    throw new Error(`Invalid SPKI public key: ${(error as Error).message}`);
  }

  const computedKeyId = createHash("sha256")
    .update(rec.publicKeySpki, "utf8")
    .digest("hex");
  if (rec.keyId !== computedKeyId) {
    throw new Error(
      `Tampered trust anchor: keyId mismatch (expected ${computedKeyId}, got ${String(rec.keyId)})`,
    );
  }

  return anchor as NativeEvidenceTrustAnchor;
}

export function loadTrustAnchor(filePath: string): NativeEvidenceTrustAnchor {
  if (!existsSync(filePath)) {
    throw new Error(`Pinned reviewed trust anchor not found: ${filePath}`);
  }
  const content = readFileSync(filePath, "utf8");
  const parsed = parseAndVerifyCanonicalJson(content);
  return validateTrustAnchor(parsed);
}
