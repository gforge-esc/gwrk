/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, createPublicKey } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { parseAndVerifyCanonicalJson } from "./canonical-json.mjs";

const ALLOWED_ANCHOR_KEYS = [
  "schemaVersion",
  "algorithm",
  "keyId",
  "publicKeySpki",
  "role",
];

export function assertExactKeys(obj, allowedKeys, objectName) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`${objectName} must be a non-null object`);
  }
  const actualKeys = Object.keys(obj);
  const allowedSet = new Set(allowedKeys);
  for (const k of actualKeys) {
    if (!allowedSet.has(k)) {
      throw new Error(`${objectName} contains unknown field: ${k}`);
    }
  }
  for (const k of allowedKeys) {
    if (!(k in obj)) {
      throw new Error(`${objectName} missing required field: ${k}`);
    }
  }
}

export function validateTrustAnchor(anchor) {
  assertExactKeys(anchor, ALLOWED_ANCHOR_KEYS, "Trust anchor");

  if (anchor.schemaVersion !== "1.0.0") {
    throw new Error(
      `Unsupported trust anchor schema version: ${String(anchor.schemaVersion)}`,
    );
  }
  if (anchor.algorithm !== "ed25519") {
    throw new Error(`Unsupported algorithm: ${String(anchor.algorithm)}`);
  }
  if (anchor.role !== "operator-root") {
    throw new Error(`Invalid trust anchor role: ${String(anchor.role)}`);
  }
  if (
    typeof anchor.publicKeySpki !== "string" ||
    !anchor.publicKeySpki.includes("PUBLIC KEY")
  ) {
    throw new Error("Invalid or missing publicKeySpki");
  }

  try {
    const key = createPublicKey(anchor.publicKeySpki);
    if (key.asymmetricKeyType !== "ed25519") {
      throw new Error(
        `Expected Ed25519 key, got ${String(key.asymmetricKeyType)}`,
      );
    }
  } catch (error) {
    throw new Error(`Invalid SPKI public key: ${error.message}`);
  }

  const computedKeyId = createHash("sha256")
    .update(anchor.publicKeySpki, "utf8")
    .digest("hex");
  if (anchor.keyId !== computedKeyId) {
    throw new Error(
      `Tampered trust anchor: keyId mismatch (expected ${computedKeyId}, got ${String(anchor.keyId)})`,
    );
  }

  return anchor;
}

export function loadTrustAnchor(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Pinned reviewed trust anchor not found: ${filePath}`);
  }
  const content = readFileSync(filePath);
  const parsed = parseAndVerifyCanonicalJson(content);
  return validateTrustAnchor(parsed);
}
