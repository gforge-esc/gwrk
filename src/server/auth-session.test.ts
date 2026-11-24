/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash } from "node:crypto";
import fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserCsrfAdapter } from "../adapters/auth/browser-csrf.js";
import { createCredentialCryptoAdapter } from "../adapters/auth/credential-crypto.js";
import { createRequestAuthenticator } from "../application/auth/authenticate-request.js";
import { createBrowserSessionService } from "../application/auth/browser-session.js";
import type { StoredGoogleSession } from "../domain/auth-policy.js";
import type {
  AuthStorePort,
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
  VerifiedAuthContext,
} from "../ports/auth-port.js";
import { registerHostedAuthGuard } from "./auth-guard.js";
import { registerAuthRoutes } from "./routes/auth.js";

const NOW = Date.parse("2026-11-23T18:00:00Z");
const ORIGIN = "https://gwrk.gforge.ai";
const TOKEN = "CANARY_SYNTHETIC_GOOGLE_ID_TOKEN";
const OTHER_TOKEN = "CANARY_OTHER_GOOGLE_ID_TOKEN";
const API_KEY = `gwrk_v1.synthetic-api.${"a".repeat(43)}`;
const PROXY_COOKIE = "__Host-gwrk_session=CANARY_PROXY_COOKIE";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
const proxyClearing = [
  "__Host-gwrk_session_0=; Path=/; Secure; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  "__Host-gwrk_session_1=; Path=/; Secure; HttpOnly; Max-Age=0",
];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
  vi.restoreAllMocks();
});

function cookies(response: { headers: Record<string, unknown> }): string[] {
  const value = response.headers["set-cookie"];
  return value === undefined
    ? []
    : Array.isArray(value)
      ? (value as string[])
      : [String(value)];
}
function browserHeaders(token = TOKEN) {
  return {
    authorization: `Bearer ${token}`,
    "x-gwrk-auth-mode": "google_id_token",
    cookie: PROXY_COOKIE,
  };
}
function privateBody(body: string) {
  for (const secret of [
    TOKEN,
    OTHER_TOKEN,
    API_KEY,
    digest(TOKEN),
    digest(OTHER_TOKEN),
    "CANARY_PROXY_COOKIE",
    "CANARY_UPSTREAM",
    "https://accounts.google.com:user-",
  ])
    expect(body).not.toContain(secret);
}

async function fixture(
  options: {
    proxyFailure?: "typed" | "throw";
    revokeFailure?: boolean;
    csrfIssueFailure?: "reject" | "throw";
    revokeAfterGuard?: boolean;
    initialCapMs?: number;
    noGuard?: boolean;
  } = {},
) {
  let now = NOW;
  const events: string[] = [];
  const records = new Map<string, StoredGoogleSession>();
  const record = (
    token: string,
    cap = NOW + 3600_000,
  ): StoredGoogleSession => ({
    tokenDigestSha256: digest(token),
    principalId: `https://accounts.google.com:user-${token === TOKEN ? "one" : "two"}`,
    issuedAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 7200_000),
    sessionCapAt: iso(cap),
    revokedAt: null,
    revokedReason: null,
  });
  if (options.initialCapMs !== undefined)
    records.set(digest(TOKEN), record(TOKEN, options.initialCapMs));
  const crypto = createCredentialCryptoAdapter();
  const store: AuthStorePort = {
    findApiCredentialById: () => ({
      credentialId: "synthetic-api",
      label: "synthetic",
      issuer: "local",
      audienceOrigin: ORIGIN,
      createdAt: iso(NOW - 1000),
      expiresAt: iso(NOW + 600_000),
      revokedAt: null,
      revokedReason: null,
      rotatedFromId: null,
      overlapUntil: null,
      verifierSha256: crypto.hashCredential(API_KEY),
    }),
    listApiCredentials: () => [],
    revokeApiCredential: () => false,
    observeGoogleSession: (input) => {
      const existing = records.get(input.tokenDigestSha256);
      if (existing?.revokedAt) return { ok: false, code: "SESSION_REVOKED" };
      if (
        existing &&
        (existing.principalId !== input.principalId ||
          existing.issuedAt !== input.issuedAt ||
          existing.expiresAt !== input.expiresAt)
      )
        return { ok: false, code: "SESSION_METADATA_CONFLICT" };
      const session = existing ?? {
        ...input,
        revokedAt: null,
        revokedReason: null,
      };
      records.set(input.tokenDigestSha256, session);
      return { ok: true, session, created: !existing };
    },
    getGoogleSession: (key) => records.get(key) ?? null,
    revokeGoogleSession: vi.fn(({ tokenDigestSha256, revokedAt, reason }) => {
      if (options.revokeFailure) return false;
      const current = records.get(tokenDigestSha256);
      if (!current) return false;
      records.set(tokenDigestSha256, {
        ...current,
        revokedAt,
        revokedReason: reason,
      });
      events.push("revoke");
      return true;
    }),
    appendAuditEvent: () => {},
    close: () => {},
  };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: async ({ token }) => {
      if (token !== TOKEN && token !== OTHER_TOKEN)
        return { ok: false, code: "AUTH_TOKEN_INVALID", message: "Denied" };
      const current = record(token);
      return {
        ok: true,
        claims: {
          canonicalIssuer: "https://accounts.google.com",
          subject: token === TOKEN ? "user-one" : "user-two",
          principalId: current.principalId,
          email: "synthetic@example.test",
          emailVerified: true,
          issuedAtMs: NOW - 1000,
          expiresAtMs: NOW + 7200_000,
          tokenDigestSha256: current.tokenDigestSha256,
        },
      };
    },
  };
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => {
      events.push("proxy");
      expect(records.get(digest(TOKEN))?.revokedAt).not.toBeNull();
      if (options.proxyFailure === "throw")
        throw new Error(`CANARY_UPSTREAM ${TOKEN} ${PROXY_COOKIE}`);
      if (options.proxyFailure === "typed")
        return {
          ok: false,
          code: "PROXY_LOGOUT_FAILED",
          message: `CANARY_UPSTREAM ${TOKEN}`,
        };
      return { ok: true, setCookieHeaders: proxyClearing };
    }),
  };
  const clock = { nowMs: () => now, nowIso: () => iso(now) };
  const sessions = createBrowserSessionService({ store, proxy, clock });
  const csrf = createBrowserCsrfAdapter({
    hmacKey: Buffer.alloc(32, 7),
    clock,
  });
  const issue = vi.spyOn(csrf, "issueToken");
  if (options.csrfIssueFailure === "reject")
    issue.mockRejectedValue(new Error(`CANARY_UPSTREAM ${TOKEN}`));
  if (options.csrfIssueFailure === "throw")
    issue.mockImplementation(() => {
      throw new Error(`CANARY_UPSTREAM ${TOKEN}`);
    });
  const clear = vi.spyOn(csrf, "clearCookieHeader");
  const read = vi.spyOn(sessions, "readSession");
  const logout = vi.spyOn(sessions, "logout");
  const app = fastify({ logger: false });
  cleanup.push(async () => {
    await app.close();
  });
  if (!options.noGuard)
    registerHostedAuthGuard(app, {
      authenticate: createRequestAuthenticator({
        store,
        crypto,
        google,
        clock,
        expectedOrigin: ORIGIN,
      }),
      csrf,
      expectedOrigin: ORIGIN,
    });
  if (options.noGuard)
    app.addHook("preHandler", async (request) => {
      const forged: VerifiedAuthContext = {
        principalType: "google_sub",
        principalId: record(TOKEN).principalId,
        credentialId: digest(TOKEN),
        expiresAt: iso(NOW + 3600_000),
        authMethod: "google_id_token",
        sessionDigest: digest(TOKEN),
      };
      request.gwrkVerifiedAuth = forged;
    });
  if (options.revokeAfterGuard)
    app.addHook("preHandler", async () => {
      const current = records.get(digest(TOKEN));
      if (current)
        records.set(digest(TOKEN), {
          ...current,
          revokedAt: iso(now),
          revokedReason: "concurrent-revocation",
        });
    });
  registerAuthRoutes(app, { sessions, csrf });
  await app.ready();
  const session = () =>
    app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
  const mutationHeaders = async (token = TOKEN) => {
    const response = await session();
    expect(response.statusCode).toBe(200);
    return {
      ...browserHeaders(token),
      origin: ORIGIN,
      "x-gwrk-csrf-token": response.json().csrfToken as string,
      cookie: `${PROXY_COOKIE}; ${cookies(response)[0].split(";", 1)[0]}`,
    };
  };
  return {
    app,
    store,
    records,
    proxy,
    events,
    issue,
    clear,
    read,
    logout,
    session,
    mutationHeaders,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("browser authentication HTTP routes", () => {
  it("serves one static login entry without identity or project metadata", async () => {
    const f = await fixture();
    const first = await f.app.inject({ url: "/" });
    const second = await f.app.inject({
      url: "/?project=CANARY_PROJECT&code=CANARY_CODE",
      headers: { "x-forwarded-user": "CANARY_USER" },
    });
    expect(first.statusCode).toBe(200);
    expect(first.headers["content-type"]).toContain("text/html");
    expect(first.body).toContain('href="/oauth2/start"');
    expect(second.body).toBe(first.body);
    expect(first.body).not.toMatch(/CANARY|project|checkout|principal/i);
    expect(f.records.size).toBe(0);
    expect(f.issue).not.toHaveBeenCalled();
    expect(f.read).not.toHaveBeenCalled();
  });
  it("returns only expiry and a CSRF token after checking the verified session", async () => {
    const f = await fixture({ initialCapMs: NOW + 120_000 });
    const response = await f.session();
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      ok: true,
      expiresAt: iso(NOW + 120_000),
      csrfToken: expect.any(String),
    });
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).toHaveBeenCalledWith({
      sessionDigest: digest(TOKEN),
      expiresAt: iso(NOW + 120_000),
    });
    const header = cookies(response)[0];
    expect(header).toMatch(/__Host-gwrk_csrf=.*; Path=\/.*HttpOnly.*Secure/);
    expect(header).not.toMatch(/Domain=|Max-Age=/i);
    expect(Date.parse(/Expires=([^;]+)/.exec(header)![1])).toBeLessThanOrEqual(
      NOW + 120_000,
    );
    expect(response.body).not.toContain(header.split(";", 1)[0].split("=")[1]);
    privateBody(response.body);
  });
  it("HEAD rechecks the same Google session without issuing or rotating CSRF", async () => {
    const f = await fixture();
    const response = await f.app.inject({
      method: "HEAD",
      url: "/api/auth/session",
      headers: browserHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toBe("");
    expect(cookies(response)).toEqual([]);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).not.toHaveBeenCalled();
  });
  it.each(["GET", "HEAD"] as const)(
    "requires Google authentication for %s session",
    async (method) => {
      const f = await fixture();
      expect(
        (await f.app.inject({ method, url: "/api/auth/session" })).statusCode,
      ).toBe(401);
      expect(f.issue).not.toHaveBeenCalled();
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it.each(["reject", "throw"] as const)(
    "returns a static 503 on CSRF issuance %s",
    async (csrfIssueFailure) => {
      const f = await fixture({ csrfIssueFailure });
      const response = await f.session();
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        ok: false,
        code: "AUTH_DEPENDENCY_UNAVAILABLE",
        requestId: expect.any(String),
      });
      expect(cookies(response)).toEqual([]);
      privateBody(response.body);
    },
  );
  it("rechecks revocation after guard completion before issuing CSRF", async () => {
    const f = await fixture({ revokeAfterGuard: true });
    const response = await f.session();
    expect(response.statusCode).toBe(401);
    expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.issue).not.toHaveBeenCalled();
    expect(cookies(response)).toEqual([]);
    privateBody(response.body);
  });
  it.each([
    { key: API_KEY, method: "GET" as const, url: "/api/auth/session" },
    {
      key: "CANARY_INVALID_API_KEY",
      method: "GET" as const,
      url: "/api/auth/session",
    },
    { key: API_KEY, method: "POST" as const, url: "/api/auth/logout" },
    {
      key: "CANARY_INVALID_API_KEY",
      method: "POST" as const,
      url: "/api/auth/logout",
    },
  ])(
    "does not fall back from API authentication to a browser cookie %#",
    async ({ key, method, url }) => {
      const f = await fixture();
      const response = await f.app.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${key}`,
          "x-gwrk-auth-mode": "api_key",
          cookie: PROXY_COOKIE,
        },
      });
      expect(response.statusCode).toBe(401);
      expect(f.records.size).toBe(0);
      expect(f.read).not.toHaveBeenCalled();
      expect(f.issue).not.toHaveBeenCalled();
      privateBody(response.body);
    },
  );
  it("cannot establish a session from a forged public decoration without the guard", async () => {
    const f = await fixture({ noGuard: true });
    const response = await f.app.inject({
      url: "/api/auth/session",
      headers: {
        "x-forwarded-user": "CANARY_USER",
        "x-gwrk-auth-mode": "google_id_token",
      },
    });
    expect(response.statusCode).toBe(401);
    expect(f.read).not.toHaveBeenCalled();
    expect(f.issue).not.toHaveBeenCalled();
    privateBody(response.body);
  });
  it("AUTH-06: revokes before proxy clearing, preserves cookie headers and denies copied replay", async () => {
    const f = await fixture();
    const headers = await f.mutationHeaders();
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, proxyCleared: true });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(f.events).toEqual(["revoke", "proxy"]);
    expect(f.proxy.clearProxySession).toHaveBeenCalledWith({
      cookieHeader: headers.cookie,
    });
    expect(cookies(response)).toEqual([
      ...proxyClearing,
      expect.stringMatching(/^__Host-gwrk_csrf=;/),
    ]);
    expect(cookies(response)[2]).toContain("Max-Age=0");
    expect(f.clear).toHaveBeenCalledTimes(1);
    privateBody(response.body);
    const replay = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers,
    });
    expect(replay.statusCode).toBe(401);
    expect((await f.session()).statusCode).toBe(401);
    expect(f.proxy.clearProxySession).toHaveBeenCalledTimes(1);
    privateBody(replay.body);
  });
  it.each(["typed", "throw"] as const)(
    "keeps origin logout committed and clears CSRF when proxy %s fails",
    async (proxyFailure) => {
      const f = await fixture({ proxyFailure });
      const response = await f.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: await f.mutationHeaders(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true, proxyCleared: false });
      expect(f.records.get(digest(TOKEN))?.revokedAt).toBe(iso(NOW));
      expect(cookies(response)).toEqual([
        expect.stringMatching(/^__Host-gwrk_csrf=;/),
      ]);
      expect(f.clear).toHaveBeenCalledTimes(1);
      expect((await f.session()).statusCode).toBe(401);
      privateBody(response.body);
    },
  );
  it("does not claim logout success when origin revocation fails", async () => {
    const f = await fixture({ revokeFailure: true });
    const response = await f.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: await f.mutationHeaders(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      requestId: expect.any(String),
    });
    expect(f.records.get(digest(TOKEN))?.revokedAt).toBeNull();
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
    expect(cookies(response)).toEqual([]);
    privateBody(response.body);
  });
  it.each([
    "missing-origin",
    "wrong-origin",
    "missing-csrf",
    "query-csrf",
    "wrong-session",
  ])(
    "guard denies %s before invoking mutating logout effects",
    async (failure) => {
      const f = await fixture();
      const originalHeaders = await f.mutationHeaders(
        failure === "wrong-session" ? OTHER_TOKEN : TOKEN,
      );
      const omitted =
        failure === "missing-origin"
          ? "origin"
          : failure === "missing-csrf"
            ? "x-gwrk-csrf-token"
            : undefined;
      const headers: Record<string, string> = Object.fromEntries(
        Object.entries(originalHeaders).filter(([key]) => key !== omitted),
      );
      let url = "/api/auth/logout";
      if (failure === "wrong-origin")
        headers.origin = "https://other.example.test";
      if (failure === "query-csrf")
        url += `?csrf_token=${encodeURIComponent(headers["x-gwrk-csrf-token"])}`;
      const response = await f.app.inject({ method: "POST", url, headers });
      expect(response.statusCode).toBe(403);
      expect(f.logout).not.toHaveBeenCalled();
      expect(f.store.revokeGoogleSession).not.toHaveBeenCalled();
      expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
      expect(f.events).toEqual([]);
      expect(cookies(response)).toEqual([]);
      privateBody(response.body);
    },
  );
});
