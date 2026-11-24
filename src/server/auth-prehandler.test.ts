/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";
import fastify from "fastify";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGoogleIdentityVerifier } from "../adapters/auth/google-id-token.js";
import { createRequestAuthenticator } from "../application/auth/authenticate-request.js";
import type {
  StoredApiCredential,
  StoredGoogleSession,
} from "../domain/auth-policy.js";
import type {
  AuthStorePort,
  BrowserCsrfPort,
  CredentialCryptoPort,
} from "../ports/auth-port.js";
import {
  readVerifiedAuthContext,
  registerHostedAuthGuard,
  resolveVerifiedPrincipal,
} from "./auth-guard.js";

const ORIGIN = "https://gwrk.gforge.ai";
const NOW = Date.parse("2026-11-23T18:00:00Z");
const KEY = `gwrk_v1.test-id.${"a".repeat(43)}`;
const iso = (time: number) => new Date(time).toISOString();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let forgedKeys: Awaited<ReturnType<typeof generateKeyPair>>;
let jwks: { keys: object[] };
let googleToken: string;
let forgedToken: string;
const cleanup: (() => Promise<void>)[] = [];

beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  forgedKeys = await generateKeyPair("RS256");
  jwks = {
    keys: [
      { ...(await exportJWK(keys.publicKey)), kid: "synthetic", alg: "RS256" },
    ],
  };
  const sign = (privateKey: typeof keys.privateKey) =>
    new SignJWT({ email: "operator@example.test", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: "synthetic" })
      .setIssuer("https://accounts.google.com")
      .setAudience("synthetic-client")
      .setSubject("operator")
      .setIssuedAt(NOW / 1000 - 1)
      .setExpirationTime(NOW / 1000 + 600)
      .sign(privateKey);
  googleToken = await sign(keys.privateKey);
  forgedToken = await sign(forgedKeys.privateKey);
});
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture(
  options: {
    configureGuard?: boolean;
    fetchGate?: Promise<void>;
    credential?: Partial<StoredApiCredential>;
    dependencyFailure?: boolean;
    csrf?: BrowserCsrfPort;
    expectedOrigin?: string;
  } = {},
) {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE operations (principal TEXT NOT NULL)");
  const app = fastify({ logger: false });
  cleanup.push(async () => {
    await app.close();
    db.close();
  });
  const sessions = new Map<string, StoredGoogleSession>();
  const record: StoredApiCredential = {
    credentialId: "test-id",
    label: "synthetic",
    issuer: "local",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 600_000),
    revokedAt: null,
    revokedReason: null,
    rotatedFromId: null,
    overlapUntil: null,
    verifierSha256: hash(KEY),
    ...options.credential,
  };
  const store: AuthStorePort = {
    findApiCredentialById: (id) => (id === record.credentialId ? record : null),
    listApiCredentials: () => [],
    revokeApiCredential: () => false,
    observeGoogleSession: (input) => {
      const old = sessions.get(input.tokenDigestSha256);
      if (old?.revokedAt) return { ok: false, code: "SESSION_REVOKED" };
      const session = old ?? { ...input, revokedAt: null, revokedReason: null };
      sessions.set(input.tokenDigestSha256, session);
      return { ok: true, session, created: !old };
    },
    getGoogleSession: (digest) => sessions.get(digest) ?? null,
    revokeGoogleSession: () => false,
    appendAuditEvent: () => {},
    close: () => {},
  };
  const crypto: CredentialCryptoPort = {
    generateApiCredential: () => {
      throw new Error("Issuance forbidden");
    },
    hashCredential: hash,
    hashTokenDigest: hash,
    verifySha256Equal: (expected, candidate) =>
      timingSafeEqual(
        Buffer.from(expected, "hex"),
        Buffer.from(candidate, "hex"),
      ),
  };
  let validationStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    validationStarted = resolve;
  });
  const google = createGoogleIdentityVerifier({
    clientId: "synthetic-client",
    readAllowlist: async () => ["operator@example.test"],
    fetch: async () => {
      validationStarted();
      await options.fetchGate;
      return Response.json(jwks);
    },
  });
  const authenticate = createRequestAuthenticator({
    store,
    crypto,
    google,
    clock: { nowMs: () => NOW, nowIso: () => iso(NOW) },
    expectedOrigin: ORIGIN,
  });
  registerHostedAuthGuard(
    app,
    options.configureGuard === false
      ? {}
      : {
          authenticate: options.dependencyFailure
            ? async () => {
                throw new Error(`upstream ${KEY}`);
              }
            : authenticate,
          csrf: options.csrf,
          expectedOrigin: options.expectedOrigin,
        },
  );
  const handler = vi.fn(async (request) => {
    const context = readVerifiedAuthContext(request);
    const principal = resolveVerifiedPrincipal(request);
    db.prepare("INSERT INTO operations VALUES (?)").run(
      principal?.principalId ?? "none",
    );
    return { context: context ?? null, principal: principal ?? null };
  });
  app.post("/api/dispatch", handler);
  app.get("/api/status", handler);
  app.get("/health", handler);
  app.get("/unclassified", handler);
  app.put("/api/status", handler);
  await app.ready();
  return {
    app,
    handler,
    sessions,
    started,
    rows: () =>
      (
        db.prepare("SELECT COUNT(*) AS count FROM operations").get() as {
          count: number;
        }
      ).count,
  };
}

describe("hosted asynchronous authentication guard", () => {
  it.each([
    {
      "x-forwarded-user": "admin",
      "x-forwarded-email": "operator@example.test",
      "x-forwarded-groups": "maintainer",
      "x-forwarded-preferred-username": "admin",
      "x-forwarded-access-token": "forged",
      "x-auth-request-email": "operator@example.test",
      "x-auth-request-access-token": "forged",
      "x-auth-request-user": "admin",
    },
    {
      "x-gwrk-auth-mode": "trusted_local",
      "x-gwrk-principal-id": "admin",
      "x-gwrk-role": "maintainer",
    },
    {
      "x-gwrk-auth-mode": "google_id_token",
      "x-auth-request-email": "operator@example.test",
    },
    { "x-gwrk-auth-mode": "api_key", "x-forwarded-for": "127.0.0.1" },
  ])(
    "AUTH-04: forged headers cannot create a principal or operation %#",
    async (headers) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers,
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        ok: false,
        requestId: expect.any(String),
      });
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    },
  );
  it.each([
    undefined,
    "Basic forbidden",
    "Bearer bad",
    `Bearer gwrk_v1.test-id.${"b".repeat(43)}`,
    "Bearer gwrk_v2.test-id.bad",
  ])(
    "AUTH-07: rejects invalid opaque credentials %#",
    async (authorization) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: authorization ? { authorization } : {},
      });
      expect(response.statusCode).toBe(401);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it.each([
    { expiresAt: iso(NOW) },
    { revokedAt: iso(NOW - 1) },
    { audienceOrigin: "https://other.example.test" },
  ])(
    "AUTH-07: denies inactive or wrong-origin credentials %#",
    async (credential) => {
      const f = await fixture({ credential });
      expect(
        (
          await f.app.inject({
            method: "POST",
            url: "/api/dispatch",
            headers: { authorization: `Bearer ${KEY}` },
          })
        ).statusCode,
      ).toBe(401);
      expect(f.rows()).toBe(0);
    },
  );
  it("reads a verified API principal synchronously and excludes secret material", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${KEY}`, "x-forwarded-user": "forged" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      context: {
        principalType: "cli_token",
        principalId: "test-id",
        credentialId: "test-id",
        expiresAt: iso(NOW + 600_000),
        authMethod: "api_key",
      },
      principal: { principalType: "cli_token", principalId: "test-id" },
    });
    expect(response.body).not.toContain(KEY);
    expect(f.rows()).toBe(1);
  });
  it("denies an absent authenticator instead of selecting local trust", async () => {
    const f = await fixture({ configureGuard: false });
    expect(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/dispatch",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(503);
    expect(f.rows()).toBe(0);
  });
  it.each([
    { method: "GET", url: "/unclassified", status: 404 },
    { method: "PUT", url: "/api/status", status: 405 },
  ])(
    "default-denies routes and methods %#",
    async ({ method, url, status }) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: method as "GET" | "PUT",
        url,
        headers: { authorization: `Bearer ${KEY}` },
      });
      expect(response.statusCode).toBe(status);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it("AUTH-04: request payload cannot populate the verified decoration", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        verifiedAuth: {
          principalType: "cli_token",
          principalId: "admin",
          authMethod: "api_key",
        },
        gwrkVerifiedAuth: { principalType: "google_sub", principalId: "admin" },
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.handler).not.toHaveBeenCalled();
    expect(f.rows()).toBe(0);
  });
  it("sanitizes thrown dependency failures and accepts no work", async () => {
    const f = await fixture({ dependencyFailure: true });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: { authorization: `Bearer ${KEY}` },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(response.body).not.toContain(KEY);
    expect(response.body).not.toContain("upstream");
    expect(f.rows()).toBe(0);
  });
  it("does not reuse a previous request's principal", async () => {
    const f = await fixture();
    expect(
      (
        await f.app.inject({
          method: "GET",
          url: "/api/status",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.app.inject({ method: "POST", url: "/api/dispatch" })).statusCode,
    ).toBe(401);
    expect(f.handler).toHaveBeenCalledTimes(1);
    expect(f.rows()).toBe(1);
  });
  it("local servers without the hosted guard retain their independent route behavior", async () => {
    const app = fastify();
    cleanup.push(async () => {
      await app.close();
    });
    app.post("/local-only", async () => ({ mode: "local" }));
    const response = await app.inject({ method: "POST", url: "/local-only" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "local" });
  });
  it("AUTH-04: a forged Google signature cannot create a session or work", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${forgedToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        "x-forwarded-user": "admin",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("AUTH_TOKEN_INVALID");
    expect(f.rows()).toBe(0);
    expect(f.sessions.size).toBe(0);
  });
  it("finishes cryptographic verification before calling the handler or inserting an operation", async () => {
    let release!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const f = await fixture({ fetchGate });
    const pending = f.app.inject({
      method: "GET",
      url: "/api/status",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    const responsePromise = Promise.resolve(pending);
    try {
      await Promise.race([
        f.started,
        responsePromise.then(() => {
          throw new Error(
            "Handler completed before cryptographic verification started",
          );
        }),
      ]);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    } finally {
      release();
    }
    const response = await responsePromise;
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      context: {
        authMethod: "google_id_token",
        principalId: "https://accounts.google.com:operator",
        sessionDigest: hash(googleToken),
      },
    });
    expect(f.rows()).toBe(1);
  });
  it.each([
    undefined,
    "api_key",
    "webhook",
    "trusted_local",
    "google_id_token, api_key",
  ])("Google tokens require the exact Google parser hint %#", async (hint) => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "GET",
      url: "/api/status",
      headers: {
        authorization: `Bearer ${googleToken}`,
        ...(hint ? { "x-gwrk-auth-mode": hint } : {}),
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.rows()).toBe(0);
    expect(f.sessions.size).toBe(0);
  });
  it.each([undefined, "api_key"])(
    "API keys work with absent or API parser hints %#",
    async (hint) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${KEY}`,
          ...(hint ? { "x-gwrk-auth-mode": hint } : {}),
          cookie: "unrelated=present",
        },
      });
      expect(response.statusCode).toBe(200);
      expect(f.rows()).toBe(1);
    },
  );
  it.each(["__Host-gwrk_session=proxy", "__Host-gwrk_session_0=chunk"])(
    "API key with a browser session denies without cookie fallback %#",
    async (cookie) => {
      const f = await fixture();
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${KEY}`,
          cookie,
          "x-gwrk-auth-mode": "api_key",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().code).toBe("AUTH_CONFLICTING_CREDENTIALS");
      expect(f.rows()).toBe(0);
      expect(f.sessions.size).toBe(0);
    },
  );
  it.each([{}, { expectedOrigin: ORIGIN }])(
    "Google mutations deny without the required CSRF dependencies %#",
    async (options) => {
      const f = await fixture(options);
      const response = await f.app.inject({
        method: "POST",
        url: "/api/dispatch",
        headers: {
          authorization: `Bearer ${googleToken}`,
          "x-gwrk-auth-mode": "google_id_token",
          origin: ORIGIN,
          "x-gwrk-csrf-token": "token",
        },
      });
      expect(response.statusCode).toBe(403);
      expect(f.handler).not.toHaveBeenCalled();
      expect(f.rows()).toBe(0);
    },
  );
  it.each([
    {
      origin: undefined,
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: "https://other.example.test",
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: ORIGIN,
      token: undefined,
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch",
    },
    {
      origin: ORIGIN,
      token: "token",
      cookie: "__Host-gwrk_csrf=secret",
      url: "/api/dispatch?csrf_token=query",
    },
    {
      origin: ORIGIN,
      token: "token",
      cookie: "__Host-gwrk_csrf=other",
      url: "/api/dispatch",
    },
  ])(
    "AUTH-11: origin and session-bound header CSRF checks precede operation effects %#",
    async ({ origin, token, cookie, url }) => {
      const csrf: BrowserCsrfPort = {
        issueToken: async () => ({ token: "token", cookieHeader: "cookie" }),
        clearCookieHeader: () => "clear",
        verifyToken: vi.fn(
          async ({ cookieValue, sessionDigest }) =>
            cookieValue === "secret" && sessionDigest === hash(googleToken),
        ),
      };
      const f = await fixture({ csrf, expectedOrigin: ORIGIN });
      const response = await f.app.inject({
        method: "POST",
        url,
        headers: {
          authorization: `Bearer ${googleToken}`,
          "x-gwrk-auth-mode": "google_id_token",
          cookie,
          ...(origin ? { origin } : {}),
          ...(token ? { "x-gwrk-csrf-token": token } : {}),
        },
      });
      expect(response.statusCode).toBe(403);
      expect(f.rows()).toBe(0);
      expect(f.handler).not.toHaveBeenCalled();
    },
  );
  it("binds a permitted browser mutation to the verified digest", async () => {
    const csrf: BrowserCsrfPort = {
      issueToken: async () => ({ token: "token", cookieHeader: "cookie" }),
      clearCookieHeader: () => "clear",
      verifyToken: vi.fn(async () => true),
    };
    const f = await fixture({ csrf, expectedOrigin: ORIGIN });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/dispatch",
      headers: {
        authorization: `Bearer ${googleToken}`,
        "x-gwrk-auth-mode": "google_id_token",
        origin: ORIGIN,
        "x-gwrk-csrf-token": "header-token",
        cookie: "unrelated=value; __Host-gwrk_csrf=secret",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(csrf.verifyToken).toHaveBeenCalledWith({
      sessionDigest: hash(googleToken),
      headerToken: "header-token",
      cookieValue: "secret",
    });
    expect(f.rows()).toBe(1);
  });
  it("HEAD follows authenticated read policy", async () => {
    const f = await fixture();
    expect(
      (await f.app.inject({ method: "HEAD", url: "/api/status" })).statusCode,
    ).toBe(401);
    expect(
      (
        await f.app.inject({
          method: "HEAD",
          url: "/api/status",
          headers: { authorization: `Bearer ${KEY}` },
        })
      ).statusCode,
    ).toBe(200);
    expect(f.rows()).toBe(1);
  });
  it("private liveness cannot manufacture a principal from headers", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "GET",
      url: "/health",
      headers: { authorization: `Bearer ${KEY}`, "x-forwarded-user": "admin" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ context: null, principal: null });
  });
});
