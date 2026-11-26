/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { parseOpaqueApiCredential } from "../../domain/auth-policy.js";
import type { CredentialCryptoPort } from "../../ports/auth-port.js";

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SHA256_LOWER_HEX_PATTERN = /^[0-9a-f]{64}$/;
const SECRET_ENTROPY_BYTES = 32;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function createCredentialCryptoAdapter(): CredentialCryptoPort {
  return {
    generateApiCredential(credentialId: string) {
      if (
        typeof credentialId !== "string" ||
        !CREDENTIAL_ID_PATTERN.test(credentialId)
      ) {
        throw new Error(
          "API credential identifier must match /^[A-Za-z0-9_-]{1,64}$/",
        );
      }

      const secret = randomBytes(SECRET_ENTROPY_BYTES).toString("base64url");
      const rawCredential = `gwrk_v1.${credentialId}.${secret}`;
      const parsed = parseOpaqueApiCredential(rawCredential);
      if (!parsed.ok) {
        throw new Error(parsed.message);
      }

      return {
        rawCredential,
        verifierSha256: sha256Hex(rawCredential),
      };
    },

    hashCredential(rawCredential: string): string {
      return sha256Hex(rawCredential);
    },

    hashTokenDigest(rawToken: string): string {
      return sha256Hex(rawToken);
    },

    verifySha256Equal(expectedHex: string, candidateHex: string): boolean {
      if (
        typeof expectedHex !== "string" ||
        typeof candidateHex !== "string" ||
        !SHA256_LOWER_HEX_PATTERN.test(expectedHex) ||
        !SHA256_LOWER_HEX_PATTERN.test(candidateHex)
      ) {
        return false;
      }

      const expectedBuf = Buffer.from(expectedHex, "hex");
      const candidateBuf = Buffer.from(candidateHex, "hex");
      if (expectedBuf.byteLength !== 32 || candidateBuf.byteLength !== 32) {
        return false;
      }

      return timingSafeEqual(expectedBuf, candidateBuf);
    },
  };
}
