/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseOpaqueApiCredential } from "../../domain/auth-policy.js";
import type { CredentialCryptoPort } from "../../ports/auth-port.js";
import { createCredentialCryptoAdapter } from "./credential-crypto.js";

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

describe("FR-004 opaque API credential crypto adapter (CredentialCryptoPort)", () => {
  it("TR-007 TC-008 generates gwrk_v1.<id>.<32-byte-base64url> credentials with matching SHA-256 verifiers", () => {
    const crypto: CredentialCryptoPort = createCredentialCryptoAdapter();

    const first = crypto.generateApiCredential("cred_pilot_01");
    const second = crypto.generateApiCredential("cred_pilot_01");

    const parsedFirst = parseOpaqueApiCredential(first.rawCredential);
    expect(parsedFirst).toMatchObject({
      ok: true,
      version: "v1",
      credentialId: "cred_pilot_01",
    });
    if (!parsedFirst.ok) {
      throw new Error("Expected generated credential to parse");
    }

    expect(Buffer.from(parsedFirst.secret, "base64url").byteLength).toBe(32);
    expect(first.verifierSha256).toMatch(SHA256_HEX_PATTERN);

    const expectedSha256 = createHash("sha256")
      .update(first.rawCredential, "utf8")
      .digest("hex");
    expect(first.verifierSha256).toBe(expectedSha256);
    expect(crypto.hashCredential(first.rawCredential)).toBe(
      first.verifierSha256,
    );

    // Consecutive generations for the same ID must use fresh CSPRNG entropy.
    expect(second.rawCredential).not.toBe(first.rawCredential);
    expect(second.verifierSha256).not.toBe(first.verifierSha256);
    expect(parseOpaqueApiCredential(second.rawCredential)).toMatchObject({
      ok: true,
      version: "v1",
      credentialId: "cred_pilot_01",
    });
  });

  it("TR-007 US-003 hashes the complete credential string and Google token digests into 64-char lowercase hex SHA-256", () => {
    const crypto: CredentialCryptoPort = createCredentialCryptoAdapter();
    const secret = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno_0";
    const keyA = `gwrk_v1.cred_a.${secret}`;
    const keyB = `gwrk_v1.cred_b.${secret}`;

    const hashA = crypto.hashCredential(keyA);
    const hashB = crypto.hashCredential(keyB);

    expect(hashA).toMatch(SHA256_HEX_PATTERN);
    expect(hashB).toMatch(SHA256_HEX_PATTERN);
    // Verifier MUST bind the full credential string, not only the secret segment.
    expect(hashA).not.toBe(hashB);
    expect(hashA).toBe(createHash("sha256").update(keyA, "utf8").digest("hex"));

    const rawIdToken = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature";
    const digest = crypto.hashTokenDigest(rawIdToken);
    expect(digest).toMatch(SHA256_HEX_PATTERN);
    expect(digest).toBe(
      createHash("sha256").update(rawIdToken, "utf8").digest("hex"),
    );
    expect(digest).not.toContain(rawIdToken);
  });

  it("TR-007 TC-008 compares fixed-length SHA-256 verifiers in constant time and rejects malformed or mismatched digests", () => {
    const crypto: CredentialCryptoPort = createCredentialCryptoAdapter();
    const { verifierSha256 } = crypto.generateApiCredential("cred_ct_01");

    expect(crypto.verifySha256Equal(verifierSha256, verifierSha256)).toBe(true);

    // Flip the last hex nibble to ensure single-bit/char changes fail.
    const flippedLast = verifierSha256.endsWith("0") ? "1" : "0";
    const mutated = `${verifierSha256.slice(0, -1)}${flippedLast}`;
    expect(crypto.verifySha256Equal(verifierSha256, mutated)).toBe(false);

    // Different lengths, empty inputs, oversized inputs, and non-hex strings must return false without throwing.
    const invalidCandidates = [
      "",
      "short",
      verifierSha256.slice(0, 63),
      `${verifierSha256}0`,
      "z".repeat(64),
      "g".repeat(64),
      verifierSha256.toUpperCase(),
      "a".repeat(512),
    ];
    for (const candidate of invalidCandidates) {
      expect(
        crypto.verifySha256Equal(verifierSha256, candidate),
        `expected false for candidate=${candidate.slice(0, 24)}`,
      ).toBe(false);
      expect(
        crypto.verifySha256Equal(candidate, verifierSha256),
        `expected false for expected=${candidate.slice(0, 24)}`,
      ).toBe(false);
    }
  });

  it("TR-007 rejects malformed credential IDs before generating an unparseable credential", () => {
    const crypto: CredentialCryptoPort = createCredentialCryptoAdapter();

    for (const badId of [
      "",
      "   ",
      "bad.dot",
      "bad/slash",
      "bad space",
      "a".repeat(65),
    ]) {
      expect(
        () => crypto.generateApiCredential(badId),
        `expected rejection for credentialId=${JSON.stringify(badId)}`,
      ).toThrow();
    }
  });
});
