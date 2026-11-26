/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openDatabase } from "../../db/index.js";
import type { HostedServerAuthOptions } from "../../server/index.js";
import { createSqliteAuthStoreAdapter } from "../sqlite/auth-store.js";
import { createBrowserCsrfAdapter } from "./browser-csrf.js";
import { createCredentialCryptoAdapter } from "./credential-crypto.js";
import { GOOGLE_JWKS_URL } from "./google-id-token.js";
import { createHostedAuthFactory } from "./hosted-auth-factory.js";
import * as protectedFiles from "./protected-hosted-auth-files.js";
import { PROXY_LOGOUT_URL } from "./proxy-logout.js";

const ORIGIN = "https://gwrk.gforge.ai";
const ROOT = "/etc/gwrk/secrets";
const NOW = Date.parse("2026-11-24T12:00:00Z");
const AUTH = Object.freeze({
  mode: "hosted",
  publicOrigin: ORIGIN,
  googleClientId: "factory-fixture",
  googleAllowlistFile: `${ROOT}/accounts`,
  csrfHmacKeyFile: `${ROOT}/hmac`,
});
const ENV = Object.freeze({
  GWRK_AUTH_MODE: "hosted",
  GWRK_AUTH_PUBLIC_ORIGIN: ORIGIN,
  GWRK_AUTH_GOOGLE_CLIENT_ID: AUTH.googleClientId,
  GWRK_AUTH_GOOGLE_ALLOWLIST_FILE: AUTH.googleAllowlistFile,
  GWRK_AUTH_CSRF_HMAC_FILE: AUTH.csrfHmacKeyFile,
});
const KEY = Buffer.alloc(32, 27);
const cleanup: (() => void)[] = [];
let token: string;
let jwks: { keys: Record<string, unknown>[] };
beforeAll(async () => {
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "factory-key",
    alg: "RS256",
    use: "sig",
  };
  jwks = { keys: [jwk] };
  token = await new SignJWT({
    email: "operator@example.test",
    email_verified: true,
  })
    .setProtectedHeader({ alg: "RS256", kid: jwk.kid })
    .setIssuer("https://accounts.google.com")
    .setAudience(AUTH.googleClientId)
    .setSubject("factory-operator")
    .setIssuedAt(NOW / 1000 - 1)
    .setExpirationTime(NOW / 1000 + 7200)
    .sign(keys.privateKey);
});
afterEach(() => {
  for (const close of cleanup.splice(0)) close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function fixture() {
  const db = openDatabase({ dbPath: ":memory:" });
  cleanup.push(() => {
    if (db.open) db.close();
  });
  const store = createSqliteAuthStoreAdapter({ db });
  const borrowedClose = vi.spyOn(store, "close");
  let now = NOW;
  let accounts: readonly string[] = ["operator@example.test"];
  const clock = { nowMs: () => now, nowIso: () => new Date(now).toISOString() };
  const events: string[] = [];
  const resolveGroupId = vi.fn(async () => {
    events.push("group");
    return 1479;
  });
  const readAllowlist = vi.fn(async () => {
    events.push("allowlist");
    return accounts;
  });
  const readCsrfHmacKey = vi.fn(async () => {
    events.push("hmac");
    return Buffer.from(KEY);
  });
  const createFiles = vi.fn(() => {
    events.push("files");
    return { readAllowlist, readCsrfHmacKey };
  });
  const jwksFetch = vi.fn(async () => Response.json(jwks));
  const logoutFetch = vi.fn(async () => {
    const digest = createHash("sha256").update(token).digest("hex");
    expect(store.getGoogleSession(digest)?.revokedAt).not.toBeNull();
    return new Response(null, {
      status: 302,
      headers: {
        "Set-Cookie":
          "__Host-gwrk_session=; Path=/; Secure; HttpOnly; Max-Age=0",
        Location: "https://untrusted.invalid/CANARY",
      },
    });
  });
  const dependencies = {
    store,
    clock,
    effects: { resolveGroupId, createFiles, jwksFetch, logoutFetch },
  };
  return {
    db,
    store,
    borrowedClose,
    clock,
    events,
    resolveGroupId,
    readAllowlist,
    readCsrfHmacKey,
    createFiles,
    jwksFetch,
    logoutFetch,
    dependencies,
    factory: createHostedAuthFactory(dependencies),
    setNow: (value: number) => {
      now = value;
    },
    setAccounts: (value: readonly string[]) => {
      accounts = value;
    },
  };
}
async function hosted(f: ReturnType<typeof fixture>) {
  const result = await f.factory.initialize({ auth: AUTH, secretsRoot: ROOT });
  expect(result).toMatchObject({ ok: true, mode: "hosted" });
  if (!result.ok || result.mode !== "hosted")
    throw new Error("Expected hosted composition");
  const bundle: HostedServerAuthOptions = result.hostedAuth;
  expect(bundle).toBeDefined();
  return result.hostedAuth;
}
function expectNoEffects(f: ReturnType<typeof fixture>) {
  for (const effect of [
    f.resolveGroupId,
    f.createFiles,
    f.readAllowlist,
    f.readCsrfHmacKey,
    f.jwksFetch,
    f.logoutFetch,
    f.borrowedClose,
  ])
    expect(effect).not.toHaveBeenCalled();
}
async function authenticateGoogle(bundle: Awaited<ReturnType<typeof hosted>>) {
  return bundle.authenticate({
    routeAuthPolicy: "google_or_api_key",
    forwardedGoogleIdToken: token,
  });
}

describe("hosted auth factory startup composition", () => {
  it("imports and constructs without filesystem, group, transport, ledger or clock effects", async () => {
    const f = fixture();
    const command = vi
      .spyOn(childProcess, "execFile")
      .mockImplementation(() => {
        throw new Error("Unexpected process call");
      });
    const open = vi.spyOn(fs, "open");
    const stat = vi.spyOn(fs, "lstat");
    const fetch = vi.spyOn(globalThis, "fetch");
    const time = vi.spyOn(f.clock, "nowMs");
    vi.resetModules();
    const module = await import("./hosted-auth-factory.js");
    module.createHostedAuthFactory(f.dependencies);
    expectNoEffects(f);
    expect(command).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(time).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { auth: {} },
    { auth: { mode: "trusted_local" } },
    { environment: { GWRK_AUTH_MODE: "trusted_local" } },
  ])(
    "preserves explicit or default local startup without any auth effects %#",
    async (input) => {
      const f = fixture();
      expect(await f.factory.initialize(input)).toEqual({
        ok: true,
        mode: "trusted_local",
      });
      expectNoEffects(f);
    },
  );
  it("does not discover machine auth environment when separate inputs are absent", async () => {
    const f = fixture();
    for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
    expect(await f.factory.initialize()).toEqual({
      ok: true,
      mode: "trusted_local",
    });
    expectNoEffects(f);
  });
  it.each([
    { auth: { ...AUTH, googleClientId: "" }, code: "AUTH_CONFIG_INVALID" },
    { auth: { mode: "hosted" }, code: "AUTH_CONFIG_INCOMPLETE" },
    {
      auth: AUTH,
      environment: { GWRK_AUTH_GOOGLE_CLIENT_ID: "different" },
      code: "AUTH_CONFIG_CONFLICT",
    },
    { auth: { ...AUTH, mode: "trusted_local" }, code: "AUTH_CONFIG_INVALID" },
    {
      auth: { ...AUTH, jwksUrl: "https://CANARY.invalid" },
      code: "AUTH_CONFIG_INVALID",
    },
    {
      auth: { ...AUTH, logoutUrl: "http://CANARY.invalid" },
      code: "AUTH_CONFIG_INVALID",
    },
    {
      environment: { ...ENV, GWRK_AUTH_GID: "1479" },
      code: "AUTH_CONFIG_INVALID",
    },
    {
      environment: { ...ENV, GWRK_AUTH_JWKS_URL: "https://CANARY.invalid" },
      code: "AUTH_CONFIG_INVALID",
    },
    {
      environment: { ...ENV, GWRK_AUTH_LOGOUT_URL: "http://CANARY.invalid" },
      code: "AUTH_CONFIG_INVALID",
    },
  ])(
    "preserves config denial before file or group effects %#",
    async ({ code, ...input }) => {
      const f = fixture();
      const result = await f.factory.initialize({
        ...input,
        secretsRoot: ROOT,
      });
      expect(result).toMatchObject({ ok: false, error: { code } });
      expect(JSON.stringify(result)).not.toContain("CANARY");
      expectNoEffects(f);
    },
  );
  it.each([
    { auth: AUTH },
    { environment: ENV },
    {
      auth: { googleClientId: AUTH.googleClientId },
      environment: { ...ENV, GWRK_AUTH_GOOGLE_CLIENT_ID: undefined },
    },
  ])(
    "builds hosted auth from separate valid configuration sources %#",
    async (input) => {
      const f = fixture();
      const result = await f.factory.initialize({
        ...input,
        secretsRoot: ROOT,
      });
      expect(result).toMatchObject({
        ok: true,
        mode: "hosted",
        hostedAuth: { expectedOrigin: ORIGIN },
      });
      expect(f.events).toEqual(["group", "files", "allowlist", "hmac"]);
      expect(f.createFiles).toHaveBeenCalledWith({
        secretsRoot: ROOT,
        googleAllowlistFile: AUTH.googleAllowlistFile,
        csrfHmacKeyFile: AUTH.csrfHmacKeyFile,
        trustedGroupId: 1479,
      });
      expect(f.jwksFetch).not.toHaveBeenCalled();
      expect(f.logoutFetch).not.toHaveBeenCalled();
      expect(f.borrowedClose).not.toHaveBeenCalled();
    },
  );
  it("defaults to the reviewed named group and protected reader without adding another configuration source", async () => {
    const f = fixture();
    const group = vi
      .spyOn(protectedFiles, "resolveTrustedGwrkGroupId")
      .mockResolvedValue(1479);
    const files = vi
      .spyOn(protectedFiles, "createProtectedHostedAuthFiles")
      .mockReturnValue({
        readAllowlist: f.readAllowlist,
        readCsrfHmacKey: f.readCsrfHmacKey,
      });
    const factory = createHostedAuthFactory({ store: f.store, clock: f.clock });
    const network = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected network"));
    const result = await factory.initialize({ auth: AUTH, secretsRoot: ROOT });
    expect(result).toMatchObject({ ok: true, mode: "hosted" });
    expect(group).toHaveBeenCalledTimes(1);
    expect(files).toHaveBeenCalledWith({
      secretsRoot: ROOT,
      googleAllowlistFile: AUTH.googleAllowlistFile,
      csrfHmacKeyFile: AUTH.csrfHmacKeyFile,
      trustedGroupId: 1479,
    });
    expect(f.readAllowlist).toHaveBeenCalledTimes(1);
    expect(f.readCsrfHmacKey).toHaveBeenCalledTimes(1);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "relative", "/etc/gwrk/../secrets"])(
    "fails closed on absent or malformed trusted secrets root %#",
    async (secretsRoot) => {
      const f = fixture();
      const result = await f.factory.initialize({ auth: AUTH, secretsRoot });
      expect(result).toMatchObject({
        ok: false,
        error: { field: "secretsRoot" },
      });
      expectNoEffects(f);
    },
  );
  it.each(["group", "files", "allowlist", "hmac"])(
    "returns static startup failure and keeps borrowed ledger open when %s fails",
    async (which) => {
      const f = fixture();
      const canary = new Error(`CANARY ${token} ${ROOT}`);
      if (which === "group") f.resolveGroupId.mockRejectedValueOnce(canary);
      if (which === "files")
        f.createFiles.mockImplementationOnce(() => {
          throw canary;
        });
      if (which === "allowlist") f.readAllowlist.mockRejectedValueOnce(canary);
      if (which === "hmac") f.readCsrfHmacKey.mockRejectedValueOnce(canary);
      const result = await f.factory.initialize({
        auth: AUTH,
        secretsRoot: ROOT,
      });
      expect(result).toMatchObject({
        ok: false,
        error: {
          code: "AUTH_DEPENDENCY_UNAVAILABLE",
          message: "Hosted authentication initialization failed",
        },
      });
      for (const value of ["CANARY", token, ROOT])
        expect(JSON.stringify(result)).not.toContain(value);
      expect(f.db.open).toBe(true);
      expect(f.borrowedClose).not.toHaveBeenCalled();
      expect(f.jwksFetch).not.toHaveBeenCalled();
      expect(f.logoutFetch).not.toHaveBeenCalled();
      if (which === "allowlist")
        expect(f.readCsrfHmacKey).not.toHaveBeenCalled();
    },
  );
  it("does not own a rate limiter, database lifecycle, process listener or startup network request", async () => {
    const f = fixture();
    const before = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ];
    const bundle = await hosted(f);
    expect(bundle).not.toHaveProperty("rateAdmission");
    expect(bundle).not.toHaveProperty("close");
    expect([
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ]).toEqual(before);
    expect(f.db.open).toBe(true);
    expect(f.borrowedClose).not.toHaveBeenCalled();
    expect(f.jwksFetch).not.toHaveBeenCalled();
    expect(f.logoutFetch).not.toHaveBeenCalled();
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM google_sessions").get(),
    ).toEqual({ n: 0 });
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM project_role_bindings").get(),
    ).toEqual({ n: 0 });
  });
  it("uses fixed Google transport only when authenticating and persists the session in the injected ledger", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    const result = await authenticateGoogle(bundle);
    expect(result).toMatchObject({
      ok: true,
      context: {
        principalType: "google_sub",
        principalId: "https://accounts.google.com:factory-operator",
        expiresAt: new Date(NOW + 3600000).toISOString(),
      },
    });
    expect(f.jwksFetch).toHaveBeenCalledTimes(1);
    expect(GOOGLE_JWKS_URL).toBe("https://www.googleapis.com/oauth2/v3/certs");
    expect(f.jwksFetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/oauth2/v3/certs",
      expect.objectContaining({ method: "GET", redirect: "manual" }),
    );
    const digest = createHash("sha256").update(token).digest("hex");
    expect(f.store.getGoogleSession(digest)).toMatchObject({
      principalId: "https://accounts.google.com:factory-operator",
      sessionCapAt: new Date(NOW + 3600000).toISOString(),
    });
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM google_sessions").get(),
    ).toEqual({ n: 1 });
    expect(
      JSON.stringify(f.db.prepare("SELECT * FROM google_sessions").all()),
    ).not.toContain(token);
    expect(
      f.db.prepare("SELECT COUNT(*) AS n FROM project_role_bindings").get(),
    ).toEqual({ n: 0 });
  });
  it("keeps the protected live allowlist callback after preflight instead of freezing a startup snapshot", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    expect((await authenticateGoogle(bundle)).ok).toBe(true);
    expect(f.readAllowlist).toHaveBeenCalledTimes(2);
    f.setAccounts(["other@example.test"]);
    expect(await authenticateGoogle(bundle)).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
    });
    expect(f.readAllowlist).toHaveBeenCalledTimes(3);
    f.readAllowlist.mockRejectedValueOnce(new Error("CANARY"));
    expect(await authenticateGoogle(bundle)).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
    });
  });
  it("composes existing CSRF issuance with the injected clock and the protected decoded key", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    const result = await authenticateGoogle(bundle);
    if (!result.ok || !result.context?.sessionDigest)
      throw new Error("Expected Google session");
    const current = bundle.sessions.readSession(result.context);
    expect(current.ok).toBe(true);
    const issued = await bundle.csrf.issueToken({
      sessionDigest: result.context.sessionDigest,
      expiresAt: result.context.expiresAt,
    });
    const cookieValue = issued.cookieHeader.split(";", 1)[0].split("=")[1];
    expect(issued.cookieHeader).toContain("HttpOnly");
    expect(issued.cookieHeader).toContain("Secure");
    expect(issued.cookieHeader).not.toContain("Max-Age=");
    expect(
      await bundle.csrf.verifyToken({
        sessionDigest: result.context.sessionDigest,
        headerToken: issued.token,
        cookieValue,
      }),
    ).toBe(true);
    expect(
      await bundle.csrf.verifyToken({
        sessionDigest: "b".repeat(64),
        headerToken: issued.token,
        cookieValue,
      }),
    ).toBe(false);
    const independent = createBrowserCsrfAdapter({
      hmacKey: KEY,
      clock: f.clock,
    });
    const otherKey = createBrowserCsrfAdapter({
      hmacKey: Buffer.alloc(32, 99),
      clock: f.clock,
    });
    expect(
      await independent.verifyToken({
        sessionDigest: result.context.sessionDigest,
        headerToken: issued.token,
        cookieValue,
      }),
    ).toBe(true);
    expect(
      await otherKey.verifyToken({
        sessionDigest: result.context.sessionDigest,
        headerToken: issued.token,
        cookieValue,
      }),
    ).toBe(false);
    f.setNow(NOW + 3600000);
    expect(bundle.sessions.readSession(result.context)).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
    });
  });
  it("revokes the injected ledger before calling the fixed proxy endpoint and prevents replay", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    const auth = await authenticateGoogle(bundle);
    if (!auth.ok || !auth.context) throw new Error("Expected Google session");
    const response = await bundle.sessions.logout(auth.context, {
      cookieHeader: "__Host-gwrk_session=CANARY_COOKIE",
    });
    expect(response).toMatchObject({ ok: true, proxyCleared: true });
    expect(PROXY_LOGOUT_URL).toBe("http://127.0.0.1:4180/oauth2/sign_out");
    expect(f.logoutFetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4180/oauth2/sign_out",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: { Cookie: "__Host-gwrk_session=CANARY_COOKIE" },
      }),
    );
    expect(JSON.stringify(response)).not.toContain("Location");
    expect(JSON.stringify(response)).not.toContain("CANARY");
    expect(await authenticateGoogle(bundle)).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_REVOKED",
    });
  });
  it("keeps origin revocation when proxy transport fails without leaking its error", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    const auth = await authenticateGoogle(bundle);
    if (!auth.ok || !auth.context) throw new Error("Expected Google session");
    f.logoutFetch.mockRejectedValueOnce(new Error(`CANARY ${token}`));
    expect(
      await bundle.sessions.logout(auth.context, {
        cookieHeader: "__Host-gwrk_session=fixture",
      }),
    ).toEqual({ ok: true, proxyCleared: false, setCookieHeaders: [] });
    expect(await authenticateGoogle(bundle)).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_REVOKED",
    });
  });
  it("uses the same injected credential store and existing crypto for opaque API authentication", async () => {
    const f = fixture();
    const bundle = await hosted(f);
    const crypto = createCredentialCryptoAdapter();
    const key = crypto.generateApiCredential("factory-api");
    f.db
      .prepare(
        "INSERT INTO api_credentials(credential_id,verifier_sha256,label,issuer,audience_origin,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        "factory-api",
        key.verifierSha256,
        "factory",
        "local",
        ORIGIN,
        new Date(NOW - 1000).toISOString(),
        new Date(NOW + 600000).toISOString(),
      );
    expect(
      await bundle.authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${key.rawCredential}`,
        cookieHeader: "__Host-gwrk_session=fixture",
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CONFLICTING_CREDENTIALS" });
    expect(
      await bundle.authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${key.rawCredential}`,
      }),
    ).toMatchObject({
      ok: true,
      context: { principalType: "cli_token", principalId: "factory-api" },
    });
    f.store.revokeApiCredential({
      credentialId: "factory-api",
      revokedAt: new Date(NOW).toISOString(),
      reason: "fixture",
    });
    expect(
      await bundle.authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${key.rawCredential}`,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });
    expect(f.jwksFetch).not.toHaveBeenCalled();
    expect(f.logoutFetch).not.toHaveBeenCalled();
  });
});
