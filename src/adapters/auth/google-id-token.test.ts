/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOSTED_SECURITY_POLICY } from "../../domain/auth-policy.js";
import {
  GOOGLE_JWKS_URL,
  createGoogleIdentityVerifier,
} from "./google-id-token.js";

const NOW = Date.parse("2026-11-23T18:00:00Z");
const SEC = NOW / 1000;
const AUD = "test.apps.googleusercontent.com";
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let publicJwk: Awaited<ReturnType<typeof exportJWK>>;

beforeAll(async () => {
  pair = await generateKeyPair("RS256", { extractable: true });
  publicJwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };
});
afterEach(() => vi.useRealTimers());

async function signed(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
) {
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: AUD,
    sub: "subject-42",
    email: "operator@example.com",
    email_verified: true,
    iat: SEC - 10,
    exp: SEC + 3600,
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", ...header })
    .sign(pair.privateKey);
}
function fixture() {
  let accounts = ["operator@example.com"];
  const fetcher = vi.fn(
    async (_url: string, _options: { signal: AbortSignal }) =>
      Response.json({ keys: [publicJwk] }),
  );
  const readAllowlist = vi.fn(async () => accounts);
  const verifier = createGoogleIdentityVerifier({
    clientId: AUD,
    readAllowlist,
    fetch: fetcher,
  });
  return {
    verifier,
    fetcher,
    readAllowlist,
    removeAccount: () => {
      accounts = [];
    },
  };
}

describe("Google verifier signed fixtures", () => {
  it.each(["accounts.google.com", "https://accounts.google.com"])(
    "AUTH-01 FR-002: normalizes issuer and maps google_sub for %s and hashes original token",
    async (iss) => {
      const f = fixture();
      const token = await signed({ iss });
      expect(await f.verifier.verifyIdToken({ token, nowMs: NOW })).toEqual({
        ok: true,
        claims: {
          canonicalIssuer: "https://accounts.google.com",
          subject: "subject-42",
          principalId: "https://accounts.google.com:subject-42",
          email: "operator@example.com",
          emailVerified: true,
          issuedAtMs: (SEC - 10) * 1000,
          expiresAtMs: (SEC + 3600) * 1000,
          tokenDigestSha256: createHash("sha256").update(token).digest("hex"),
        },
      });
      expect(f.fetcher).toHaveBeenCalledWith(
        GOOGLE_JWKS_URL,
        expect.objectContaining({ redirect: "manual", method: "GET" }),
      );
    },
  );
  it("AUTH-01 rejects a real wrong signature and a modified payload", async () => {
    const other = await generateKeyPair("RS256");
    const bad = await new SignJWT({
      iss: "https://accounts.google.com",
      aud: AUD,
      sub: "x",
      iat: SEC,
      exp: SEC + 60,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .sign(other.privateKey);
    const token = await signed();
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ sub: "forged" })).toString(
      "base64url",
    );
    for (const input of [bad, parts.join(".")])
      expect(
        await fixture().verifier.verifyIdToken({ token: input, nowMs: NOW }),
      ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
  });
  it.each([
    { jku: "https://attacker.invalid/keys" },
    { x5u: "https://attacker.invalid/cert" },
    { jwk: {} },
    { x5c: [] },
  ])(
    "AUTH-01 rejects token key headers before transport %j",
    async (header) => {
      const f = fixture();
      expect(
        await f.verifier.verifyIdToken({
          token: await signed({}, header),
          nowMs: NOW,
        }),
      ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it("AUTH-01 rejects none and HS256 headers before transport", async () => {
    const f = fixture();
    for (const alg of ["none", "HS256"]) {
      const token = `${Buffer.from(JSON.stringify({ alg })).toString("base64url")}.e30.invalid`;
      expect(
        await f.verifier.verifyIdToken({ token, nowMs: NOW }),
      ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    }
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { iss: "https://attacker.invalid" },
    { aud: "wrong" },
    { sub: "" },
    { sub: undefined },
    { iat: undefined },
    { exp: undefined },
  ])("AUTH-01 requires verified claims %j", async (claims) => {
    expect(
      await fixture().verifier.verifyIdToken({
        token: await signed(claims),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
  });
  it.each([SEC, SEC - 1])("AUTH-02 denies strict expiry %s", async (exp) => {
    expect(
      await fixture().verifier.verifyIdToken({
        token: await signed({ exp }),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_EXPIRED" });
  });
  it("AUTH-02 allows 60-second future iat but denies 61 seconds", async () => {
    const f = fixture();
    expect(
      await f.verifier.verifyIdToken({
        token: await signed({ iat: SEC + 60 }),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await f.verifier.verifyIdToken({
        token: await signed({ iat: SEC + 61 }),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_EXPIRED" });
  });
  it.each([
    { email_verified: false },
    { email_verified: "true" },
    { email: "unlisted@example.com" },
    { email: undefined },
  ])("AUTH-03 denies account %j", async (claims) => {
    expect(
      await fixture().verifier.verifyIdToken({
        token: await signed(claims),
        nowMs: NOW,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });
  });
  it("AUTH-03 reloads allowlist without recreating verifier", async () => {
    const f = fixture();
    const token = await signed();
    expect(await f.verifier.verifyIdToken({ token, nowMs: NOW })).toMatchObject(
      { ok: true },
    );
    f.removeAccount();
    expect(await f.verifier.verifyIdToken({ token, nowMs: NOW })).toMatchObject(
      { ok: false, code: "AUTH_ACCOUNT_DENIED" },
    );
    expect(f.readAllowlist).toHaveBeenCalledTimes(2);
  });
  it("AUTH-03 denies empty, unreadable, and wildcard allowlists", async () => {
    for (const readAllowlist of [
      async () => [],
      async () => {
        throw new Error("CANARY_ALLOWLIST");
      },
      async () => ["*@example.com"],
    ]) {
      const f = fixture();
      const v = createGoogleIdentityVerifier({
        clientId: AUD,
        readAllowlist,
        fetch: f.fetcher,
      });
      const result = await v.verifyIdToken({
        token: await signed(),
        nowMs: NOW,
      });
      expect(result).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });
      expect(JSON.stringify(result)).not.toContain("CANARY");
    }
  });
  it("rejects oversized and malformed tokens before transport", async () => {
    const f = fixture();
    for (const token of ["x".repeat(8193), "not.a.jwt", ""])
      expect(
        await f.verifier.verifyIdToken({ token, nowMs: NOW }),
      ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
  it("construction and import perform no transport or allowlist I/O", async () => {
    vi.resetModules();
    const module = await import("./google-id-token.js");
    const fetcher = vi.fn();
    const readAllowlist = vi.fn();
    module.createGoogleIdentityVerifier({
      clientId: AUD,
      readAllowlist,
      fetch: fetcher,
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(readAllowlist).not.toHaveBeenCalled();
    expect(() =>
      module.createGoogleIdentityVerifier({
        clientId: "",
        readAllowlist,
        fetch: fetcher,
      }),
    ).toThrow();
  });
});

describe("bounded JWKS transport and cache", () => {
  it.each([302, 500])(
    "AUTH-14 denies HTTP %s without redirect follow",
    async (status) => {
      const f = fixture();
      f.fetcher.mockImplementation(
        async () =>
          new Response("", {
            status,
            headers: { location: "https://attacker.invalid" },
          }),
      );
      expect(
        await f.verifier.verifyIdToken({ token: await signed(), nowMs: NOW }),
      ).toMatchObject({ ok: false, code: "AUTH_VERIFIER_UNAVAILABLE" });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("AUTH-14 cancels rejected HTTP response bodies", async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetcher.mockImplementation(
      async () => new Response(new ReadableStream({ cancel }), { status: 302 }),
    );
    expect(
      await f.verifier.verifyIdToken({ token: await signed(), nowMs: NOW }),
    ).toMatchObject({ ok: false, code: "AUTH_VERIFIER_UNAVAILABLE" });
    expect(cancel).toHaveBeenCalled();
  });
  it("AUTH-14 rejects 101 keys and malformed JSON", async () => {
    for (const body of [
      JSON.stringify({ keys: Array(101).fill(publicJwk) }),
      "not json",
    ]) {
      const f = fixture();
      f.fetcher.mockImplementation(async () => new Response(body));
      expect(
        await f.verifier.verifyIdToken({ token: await signed(), nowMs: NOW }),
      ).toMatchObject({ ok: false, code: "AUTH_VERIFIER_UNAVAILABLE" });
    }
  });
  it("AUTH-14 cancels an oversized stream despite dishonest length", async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetcher.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(new Uint8Array(65537));
            },
            cancel,
          }),
          { headers: { "content-length": "2" } },
        ),
    );
    expect(
      await f.verifier.verifyIdToken({ token: await signed(), nowMs: NOW }),
    ).toMatchObject({ ok: false, code: "AUTH_VERIFIER_UNAVAILABLE" });
    expect(cancel).toHaveBeenCalled();
  });
  it("AUTH-14 times out a stalled body even after headers arrive", async () => {
    const token = await signed();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    const cancel = vi.fn();
    const f = fixture();
    f.fetcher.mockImplementation(
      async () => new Response(new ReadableStream({ cancel })),
    );
    const result = f.verifier.verifyIdToken({ token, nowMs: NOW });
    await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("AUTH-14 times out a transport that ignores cancellation", async () => {
    const token = await signed();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(NOW);
    const f = fixture();
    f.fetcher.mockImplementation(() => new Promise(() => {}));
    const result = f.verifier.verifyIdToken({ token, nowMs: NOW });
    await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
    });
  });
  it("reuses cached keys and coalesces concurrent verification", async () => {
    const f = fixture();
    const token = await signed();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.verifier.verifyIdToken({ token, nowMs: NOW }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    await f.verifier.verifyIdToken({ token, nowMs: NOW });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });
  it("refreshes rotated keys only after cooldown", async () => {
    const token = await signed();
    const rotated = await signed({}, { kid: "rotated" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const f = fixture();
    await f.verifier.verifyIdToken({ token, nowMs: NOW });
    expect(
      await f.verifier.verifyIdToken({ token: rotated, nowMs: NOW }),
    ).toMatchObject({ ok: false });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 30001);
    f.fetcher.mockImplementation(async () =>
      Response.json({ keys: [{ ...publicJwk, kid: "rotated" }] }),
    );
    expect(
      await f.verifier.verifyIdToken({ token: rotated, nowMs: NOW + 30001 }),
    ).toMatchObject({ ok: true });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });
  it("fails closed on expired cache when refresh fails", async () => {
    const token = await signed();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const f = fixture();
    await f.verifier.verifyIdToken({ token, nowMs: NOW });
    vi.setSystemTime(NOW + 600001);
    f.fetcher.mockRejectedValue(new Error("CANARY_FETCH"));
    const result = await f.verifier.verifyIdToken({
      token,
      nowMs: NOW + 600001,
    });
    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });
  it("validates configured bounds without I/O", () => {
    const f = fixture();
    expect(() =>
      createGoogleIdentityVerifier({
        clientId: AUD,
        readAllowlist: f.readAllowlist,
        fetch: f.fetcher,
        policy: {
          ...DEFAULT_HOSTED_SECURITY_POLICY,
          jwksRequestTimeoutSeconds: 6,
        },
      }),
    ).toThrow();
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
