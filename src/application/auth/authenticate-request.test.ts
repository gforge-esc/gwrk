/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { describe, expect, it, vi } from "vitest";
import { createCredentialCryptoAdapter } from "../../adapters/auth/credential-crypto.js";
import { createGoogleIdentityVerifier } from "../../adapters/auth/google-id-token.js";
import {
  PROXY_LOGOUT_URL,
  createProxySessionLogout,
} from "../../adapters/auth/proxy-logout.js";
import { repositoryGitEnv } from "../../adapters/git/process-env.js";
import {
  createSqliteAuthStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../../adapters/sqlite/index.js";
import { openDatabase } from "../../db/index.js";
import type {
  StoredApiCredential,
  StoredGoogleSession,
} from "../../domain/auth-policy.js";
import { computeProjectId } from "../../domain/project-id.js";
import type { EnrolledProject } from "../../domain/project-registry.js";
import type {
  AuthStorePort,
  CredentialCryptoPort,
  GoogleIdentityVerifierPort,
  ProxySessionLogoutPort,
  VerifiedAuthContext,
} from "../../ports/auth-port.js";
import * as applicationBarrel from "../index.js";
import { createRequestAuthenticator } from "./authenticate-request.js";
import { createBrowserSessionService } from "./browser-session.js";

const NOW = Date.parse("2026-11-23T18:00:00Z");
const iso = (time: number) => new Date(time).toISOString();
const ORIGIN = "https://gwrk.gforge.ai";
const TOKEN = `gwrk_v1.test-id.${"a".repeat(43)}`;
const DIGEST = "b".repeat(64);
const PRINCIPAL = "https://accounts.google.com:subject";
const claims = {
  canonicalIssuer: "https://accounts.google.com" as const,
  subject: "subject",
  principalId: PRINCIPAL,
  email: "operator@example.test",
  emailVerified: true as const,
  issuedAtMs: NOW - 1000,
  expiresAtMs: NOW + 7_200_000,
  tokenDigestSha256: DIGEST,
};
function fixture() {
  let now = NOW;
  let credential: StoredApiCredential | null = {
    credentialId: "test-id",
    label: "synthetic",
    issuer: "local-admin",
    audienceOrigin: ORIGIN,
    createdAt: iso(NOW - 1000),
    expiresAt: iso(NOW + 60_000),
    revokedAt: null,
    revokedReason: null,
    rotatedFromId: null,
    overlapUntil: null,
    verifierSha256: "expected-hash",
  };
  const sessions = new Map<string, StoredGoogleSession>();
  const effects: string[] = [];
  const store: AuthStorePort = {
    findApiCredentialById: vi.fn(() => credential),
    listApiCredentials: () => [],
    revokeApiCredential: () => false,
    observeGoogleSession: vi.fn((input) => {
      effects.push("observe");
      const old = sessions.get(input.tokenDigestSha256);
      if (old?.revokedAt) return { ok: false, code: "SESSION_REVOKED" };
      if (
        old &&
        (old.principalId !== input.principalId ||
          old.issuedAt !== input.issuedAt ||
          old.expiresAt !== input.expiresAt)
      )
        return { ok: false, code: "SESSION_METADATA_CONFLICT" };
      const session = old ?? { ...input, revokedAt: null, revokedReason: null };
      sessions.set(input.tokenDigestSha256, session);
      return { ok: true, session, created: !old };
    }),
    getGoogleSession: vi.fn((digest) => sessions.get(digest) ?? null),
    revokeGoogleSession: vi.fn(({ tokenDigestSha256, revokedAt, reason }) => {
      effects.push("revoke");
      const session = sessions.get(tokenDigestSha256);
      if (!session) return false;
      sessions.set(tokenDigestSha256, {
        ...session,
        revokedAt: session.revokedAt ?? revokedAt,
        revokedReason: session.revokedReason ?? reason,
      });
      return true;
    }),
    appendAuditEvent: vi.fn(),
    close: () => {},
  };
  const crypto: CredentialCryptoPort = {
    generateApiCredential: () => {
      throw new Error("issuance forbidden");
    },
    hashCredential: vi.fn(() => "candidate-hash"),
    hashTokenDigest: vi.fn(() => DIGEST),
    verifySha256Equal: vi.fn(() => true),
  };
  const google: GoogleIdentityVerifierPort = {
    verifyIdToken: vi.fn(async () => ({ ok: true, claims: { ...claims } })),
  };
  const proxy: ProxySessionLogoutPort = {
    clearProxySession: vi.fn(async () => {
      effects.push("proxy");
      expect(sessions.get(DIGEST)?.revokedAt).not.toBeNull();
      return { ok: true, setCookieHeaders: ["synthetic=; Max-Age=0"] };
    }),
  };
  const clock = { nowMs: () => now, nowIso: () => iso(now) };
  const authenticate = createRequestAuthenticator({
    store,
    crypto,
    google,
    clock,
    expectedOrigin: ORIGIN,
  });
  const browser = createBrowserSessionService({ store, proxy, clock });
  const api = () =>
    authenticate({
      routeAuthPolicy: "google_or_api_key",
      authorizationHeader: `Bearer ${TOKEN}`,
    });
  const googleRequest = () =>
    authenticate({
      routeAuthPolicy: "google_or_api_key",
      forwardedGoogleIdToken: "synthetic-google-token",
    });
  return {
    store,
    crypto,
    google,
    proxy,
    sessions,
    effects,
    authenticate,
    browser,
    api,
    googleRequest,
    advance: (ms: number) => {
      now += ms;
    },
    credential: (patch: Partial<StoredApiCredential> | null) => {
      credential = patch === null ? null : { ...credential!, ...patch };
    },
  };
}
async function googleContext(
  f: ReturnType<typeof fixture>,
): Promise<VerifiedAuthContext> {
  const result = await f.googleRequest();
  expect(result.ok).toBe(true);
  if (!result.ok || !result.context)
    throw new Error("expected verified context");
  return result.context;
}

describe("request authentication orchestration", () => {
  it("verifies an opaque credential using crypto and returns only public context", async () => {
    const f = fixture();
    expect(await f.api()).toEqual({
      ok: true,
      context: {
        principalType: "cli_token",
        principalId: "test-id",
        credentialId: "test-id",
        authMethod: "api_key",
        expiresAt: iso(NOW + 60_000),
      },
    });
    expect(f.crypto.hashCredential).toHaveBeenCalledWith(TOKEN);
    expect(f.crypto.verifySha256Equal).toHaveBeenCalledWith(
      "expected-hash",
      "candidate-hash",
    );
    expect(f.google.verifyIdToken).not.toHaveBeenCalled();
    expect(f.store.observeGoogleSession).not.toHaveBeenCalled();
  });
  it.each([
    "",
    "Basic bad",
    "Bearer bad",
    `Bearer ${TOKEN} extra`,
    `Bearer ${"x".repeat(300)}`,
  ])(
    "denies absent or malformed caller credential %j without fallback",
    async (header) => {
      const f = fixture();
      expect(
        await f.authenticate({
          routeAuthPolicy: "google_or_api_key",
          authorizationHeader: header,
        }),
      ).toMatchObject({ ok: false });
      expect(f.store.findApiCredentialById).not.toHaveBeenCalled();
      expect(f.google.verifyIdToken).not.toHaveBeenCalled();
    },
  );
  it.each([
    { audienceOrigin: "https://other.invalid" },
    { expiresAt: iso(NOW) },
    { expiresAt: "invalid" },
    { revokedAt: iso(NOW - 1) },
    { overlapUntil: iso(NOW) },
  ])("denies invalid credential lifecycle %j", async (patch) => {
    const f = fixture();
    f.credential(patch);
    expect(await f.api()).toMatchObject({
      ok: false,
      code: "AUTH_CREDENTIAL_REJECTED",
    });
  });
  it("denies unknown and wrong-secret credentials", async () => {
    const f = fixture();
    f.credential(null);
    expect(await f.api()).toMatchObject({ ok: false });
    const other = fixture();
    vi.mocked(other.crypto.verifySha256Equal).mockReturnValue(false);
    expect(await other.api()).toMatchObject({ ok: false });
  });
  it("uses the earlier rotation overlap deadline", async () => {
    const f = fixture();
    f.credential({ overlapUntil: iso(NOW + 5000) });
    expect(await f.api()).toMatchObject({
      ok: true,
      context: { expiresAt: iso(NOW + 5000) },
    });
  });
  it.each([
    { cookieHeader: "_oauth2_proxy=synthetic" },
    { forwardedGoogleIdToken: "synthetic" },
  ])("rejects API/browser conflict %j before ports", async (extra) => {
    const f = fixture();
    expect(
      await f.authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${TOKEN}`,
        ...extra,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CONFLICTING_CREDENTIALS" });
    expect(f.store.findApiCredentialById).not.toHaveBeenCalled();
    expect(f.google.verifyIdToken).not.toHaveBeenCalled();
  });
  it("does not treat unrelated cookies as a browser credential", async () => {
    const f = fixture();
    expect(
      await f.authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${TOKEN}`,
        cookieHeader: "theme=dark",
      }),
    ).toMatchObject({ ok: true });
  });
  it.each(["private_liveness_only", "provider_webhook"] as const)(
    "keeps %s outside identity creation",
    async (routeAuthPolicy) => {
      const f = fixture();
      expect(
        await f.authenticate({ routeAuthPolicy, authorizationHeader: "bad" }),
      ).toMatchObject({ ok: true, context: null });
      expect(f.store.findApiCredentialById).not.toHaveBeenCalled();
      expect(f.google.verifyIdToken).not.toHaveBeenCalled();
    },
  );
  it.each(["store", "crypto", "google"] as const)(
    "fails closed when %s throws without leaking its error",
    async (port) => {
      const f = fixture();
      if (port === "store")
        vi.mocked(f.store.findApiCredentialById).mockImplementation(() => {
          throw new Error(TOKEN);
        });
      if (port === "crypto")
        vi.mocked(f.crypto.hashCredential).mockImplementation(() => {
          throw new Error(TOKEN);
        });
      if (port === "google")
        vi.mocked(f.google.verifyIdToken).mockRejectedValue(new Error(TOKEN));
      const result = await (port === "google" ? f.googleRequest() : f.api());
      expect(result).toMatchObject({
        ok: false,
        code: "AUTH_DEPENDENCY_UNAVAILABLE",
      });
      expect(JSON.stringify(result)).not.toContain(TOKEN);
    },
  );
  it("does not forward upstream verifier messages", async () => {
    const f = fixture();
    vi.mocked(f.google.verifyIdToken).mockResolvedValue({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
      message: "CANARY_PRIVATE_ERROR",
    });
    const result = await f.googleRequest();
    expect(result).toMatchObject({
      ok: false,
      code: "AUTH_VERIFIER_UNAVAILABLE",
    });
    expect(JSON.stringify(result)).not.toContain("CANARY");
    expect(f.store.observeGoogleSession).not.toHaveBeenCalled();
  });
});

describe("immutable browser session observation and logout", () => {
  it("denies observation after revocation commits while verification and proxy calls are in flight", async () => {
    const f = fixture();
    const context = await googleContext(f);
    let releaseVerification: (() => void) | undefined;
    let releaseProxy: (() => void) | undefined;
    vi.mocked(f.google.verifyIdToken).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        releaseVerification = resolve;
      });
      return { ok: true, claims: { ...claims } };
    });
    vi.mocked(f.proxy.clearProxySession).mockImplementation(async () => {
      expect(f.sessions.get(DIGEST)?.revokedAt).toBe(iso(NOW));
      await new Promise<void>((resolve) => {
        releaseProxy = resolve;
      });
      return {
        ok: false,
        code: "PROXY_LOGOUT_FAILED",
        message: "synthetic failure",
      };
    });
    const pendingAuthentication = f.googleRequest();
    const pendingLogout = f.browser.logout(context);
    expect(releaseVerification).toBeTypeOf("function");
    expect(releaseProxy).toBeTypeOf("function");
    releaseVerification?.();
    expect(await pendingAuthentication).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_REVOKED",
    });
    releaseProxy?.();
    expect(await pendingLogout).toMatchObject({
      ok: true,
      proxyCleared: false,
    });
  });

  it("checks token expiry again after asynchronous verification", async () => {
    const f = fixture();
    vi.mocked(f.google.verifyIdToken).mockImplementation(async (input) => {
      expect(input).toEqual({ token: "synthetic-google-token", nowMs: NOW });
      f.advance(5000);
      return { ok: true, claims: { ...claims, expiresAtMs: NOW + 5000 } };
    });
    expect(await f.googleRequest()).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
    });
    expect(f.store.observeGoogleSession).not.toHaveBeenCalled();
  });
  it.each([
    "AUTH_TOKEN_INVALID",
    "AUTH_TOKEN_EXPIRED",
    "AUTH_ACCOUNT_DENIED",
    "AUTH_VERIFIER_UNAVAILABLE",
  ] as const)(
    "preserves verifier denial code %s with zero observation",
    async (code) => {
      const f = fixture();
      vi.mocked(f.google.verifyIdToken).mockResolvedValue({
        ok: false,
        code,
        message: "CANARY",
      });
      const result = await f.googleRequest();
      expect(result).toMatchObject({ ok: false, code });
      expect(JSON.stringify(result)).not.toContain("CANARY");
      expect(f.store.observeGoogleSession).not.toHaveBeenCalled();
    },
  );
  it("denies session reads and logout during store outage", async () => {
    const f = fixture();
    const context = await googleContext(f);
    vi.mocked(f.store.getGoogleSession).mockImplementation(() => {
      throw new Error("CANARY_STORE");
    });
    expect(f.browser.readSession(context)).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
    });
    expect(await f.browser.logout(context)).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
    });
    expect(f.store.revokeGoogleSession).not.toHaveBeenCalled();
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
  });

  it("caps first observation at one hour and never extends it", async () => {
    const f = fixture();
    const first = await googleContext(f);
    expect(first.expiresAt).toBe(iso(NOW + 3_600_000));
    expect(first.sessionDigest).toBe(DIGEST);
    expect(f.store.observeGoogleSession).toHaveBeenCalledWith({
      tokenDigestSha256: DIGEST,
      principalId: PRINCIPAL,
      issuedAt: iso(claims.issuedAtMs),
      expiresAt: iso(claims.expiresAtMs),
      sessionCapAt: iso(NOW + 3_600_000),
    });
    f.advance(60_000);
    expect(await googleContext(f)).toEqual(first);
    expect(JSON.stringify(f.sessions.get(DIGEST))).not.toContain(
      "synthetic-google-token",
    );
    expect(JSON.stringify(f.sessions.get(DIGEST))).not.toContain(claims.email);
    f.advance(3_540_000);
    expect(await f.googleRequest()).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
    });
  });
  it("caps at earlier verified token expiry", async () => {
    const f = fixture();
    vi.mocked(f.google.verifyIdToken).mockResolvedValue({
      ok: true,
      claims: { ...claims, expiresAtMs: NOW + 30_000 },
    });
    expect((await googleContext(f)).expiresAt).toBe(iso(NOW + 30_000));
  });
  it.each(["SESSION_REVOKED", "SESSION_METADATA_CONFLICT"] as const)(
    "denies atomic observation result %s",
    async (code) => {
      const f = fixture();
      vi.mocked(f.store.observeGoogleSession).mockReturnValue({
        ok: false,
        code,
      });
      expect(await f.googleRequest()).toMatchObject({ ok: false });
    },
  );
  it("denies changed verified metadata for an already observed digest", async () => {
    const f = fixture();
    await googleContext(f);
    vi.mocked(f.google.verifyIdToken).mockResolvedValue({
      ok: true,
      claims: { ...claims, issuedAtMs: NOW - 2000 },
    });
    expect(await f.googleRequest()).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_METADATA_CONFLICT",
    });
  });
  it("denies observation failures without a successful context", async () => {
    const f = fixture();
    vi.mocked(f.store.observeGoogleSession).mockImplementation(() => {
      throw new Error("CANARY_STORE");
    });
    expect(await f.googleRequest()).toMatchObject({
      ok: false,
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
    });
  });
  it("reads only current matching live Google sessions", async () => {
    const f = fixture();
    const context = await googleContext(f);
    expect(f.browser.readSession(context)).toEqual({ ok: true, context });
    expect(
      f.browser.readSession({ ...context, principalId: "other" }),
    ).toMatchObject({ ok: false });
    expect(
      f.browser.readSession({ ...context, sessionDigest: "unknown" }),
    ).toMatchObject({ ok: false });
    f.advance(3_600_000);
    expect(f.browser.readSession(context)).toMatchObject({
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
    });
  });
  it.each(["failure", "throw"] as const)(
    "revokes before proxy %s and denies copied replay",
    async (failure) => {
      const f = fixture();
      const context = await googleContext(f);
      vi.mocked(f.proxy.clearProxySession).mockImplementation(async () => {
        f.effects.push("proxy");
        expect(f.sessions.get(DIGEST)?.revokedAt).toBe(iso(NOW));
        if (failure === "throw") throw new Error("CANARY_PROXY");
        return {
          ok: false,
          code: "PROXY_LOGOUT_FAILED",
          message: "CANARY_PROXY",
        };
      });
      const result = await f.browser.logout(context, {
        cookieHeader: "synthetic-cookie",
      });
      expect(result).toMatchObject({
        ok: true,
        proxyCleared: false,
        setCookieHeaders: [],
      });
      expect(JSON.stringify(result)).not.toContain("CANARY");
      expect(f.effects.slice(-2)).toEqual(["revoke", "proxy"]);
      expect(await f.googleRequest()).toMatchObject({
        ok: false,
        code: "AUTH_SESSION_REVOKED",
      });
      expect(f.browser.readSession(context)).toMatchObject({
        ok: false,
        code: "AUTH_SESSION_REVOKED",
      });
    },
  );
  it("revokes before a successful proxy call and returns its clear-cookie instructions", async () => {
    const f = fixture();
    const context = await googleContext(f);
    expect(await f.browser.logout(context)).toEqual({
      ok: true,
      proxyCleared: true,
      setCookieHeaders: ["synthetic=; Max-Age=0"],
    });
    expect(f.effects.slice(-2)).toEqual(["revoke", "proxy"]);
  });
  it("does not call proxy when origin revocation fails", async () => {
    const f = fixture();
    const context = await googleContext(f);
    vi.mocked(f.store.revokeGoogleSession).mockReturnValue(false);
    expect(await f.browser.logout(context)).toMatchObject({ ok: false });
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
    vi.mocked(f.store.revokeGoogleSession).mockImplementation(() => {
      throw new Error("CANARY");
    });
    expect(await f.browser.logout(context)).toMatchObject({ ok: false });
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
  });
  it("rejects API/browser conflicts using configured production __Host-gwrk_session cookie name", async () => {
    const f = fixture();
    const authenticate = createRequestAuthenticator({
      store: f.store,
      crypto: f.crypto,
      google: f.google,
      clock: { nowMs: () => NOW, nowIso: () => iso(NOW) },
      expectedOrigin: ORIGIN,
      sessionCookieName: "__Host-gwrk_session",
    });
    for (const cookieHeader of [
      "__Host-gwrk_session=synthetic",
      "__Host-gwrk_session_0=part0; __Host-gwrk_session_1=part1",
    ]) {
      expect(
        await authenticate({
          routeAuthPolicy: "google_or_api_key",
          authorizationHeader: `Bearer ${TOKEN}`,
          cookieHeader,
        }),
      ).toMatchObject({ ok: false, code: "AUTH_CONFLICTING_CREDENTIALS" });
    }
    expect(f.store.findApiCredentialById).not.toHaveBeenCalled();
    expect(f.google.verifyIdToken).not.toHaveBeenCalled();
  });

  it("rejects API contexts and mismatched Google owners before logout effects", async () => {
    const f = fixture();
    const context = await googleContext(f);
    for (const invalid of [
      {
        ...context,
        principalType: "cli_token" as const,
        authMethod: "api_key" as const,
      },
      { ...context, principalId: "other" },
    ])
      expect(await f.browser.logout(invalid)).toMatchObject({ ok: false });
    expect(f.store.revokeGoogleSession).not.toHaveBeenCalled();
    expect(f.proxy.clearProxySession).not.toHaveBeenCalled();
  });
});

describe("Phase 3 composed auth, session, and credential barrel integration", () => {
  it("exports authentication, session, credential-management, and existing application services from src/application/index.ts", () => {
    expect(Object.keys(applicationBarrel)).toEqual(
      expect.arrayContaining([
        "createRequestAuthenticator",
        "denyAuthentication",
        "createBrowserSessionService",
        "createApiCredential",
        "listApiCredentials",
        "revokeApiCredential",
        "rotateApiCredential",
        "CredentialPolicyError",
        "CredentialNotFoundError",
        "CredentialDeliveryError",
        "createOutboxDeliveryService",
        "createDurableDispatchService",
        "createDurableHarvestService",
        "extractOpenTaskErrors",
        "buildDiagnosisPrompt",
        "extractFixLines",
        "evaluateReviewVerdict",
        "evaluateScopedTestOutcome",
      ]),
    );
  });

  it("TR-006 AUTH-06 composes SQLite auth store, crypto, Google verifier, and proxy logout without granting project roles", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "gwrk-phase3-compose-"),
    );
    const dbPath = path.join(tempDir, "gwrk.db");
    const now = NOW;
    const clock = { nowMs: () => now, nowIso: () => iso(now) };
    const audience = "pilot-client.apps.googleusercontent.com";
    let allowlist = ["operator@example.com"];

    const pair = await generateKeyPair("RS256", { extractable: true });
    const publicJwk = {
      ...(await exportJWK(pair.publicKey)),
      kid: "compose-key",
      alg: "RS256",
      use: "sig",
    };
    const idToken = await new SignJWT({
      iss: "accounts.google.com",
      aud: audience,
      sub: "google-user-99",
      email: "operator@example.com",
      email_verified: true,
      iat: NOW / 1000 - 10,
      exp: NOW / 1000 + 7200,
    })
      .setProtectedHeader({ alg: "RS256", kid: "compose-key" })
      .sign(pair.privateKey);

    const db = openDatabase({ dbPath });
    try {
      const store = createSqliteAuthStoreAdapter({ db });
      const registry = createSqliteProjectRegistryAdapter({ db });
      const crypto = createCredentialCryptoAdapter();
      const repoDir = path.join(tempDir, "alpha-repo");
      fs.mkdirSync(repoDir, { recursive: true });
      const gitEnv = {
        ...repositoryGitEnv(repoDir),
        GIT_CONFIG_GLOBAL: os.devNull,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Gwrk Test",
        GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
        GIT_COMMITTER_NAME: "Gwrk Test",
        GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
        GIT_TERMINAL_PROMPT: "0",
      };
      execFileSync("git", ["init", "--template=", "--initial-branch=main"], {
        cwd: repoDir,
        env: gitEnv,
        stdio: "ignore",
      });
      execFileSync(
        "git",
        ["remote", "add", "origin", "git@github.com:org/alpha.git"],
        { cwd: repoDir, env: gitEnv, stdio: "ignore" },
      );
      const projectId = computeProjectId({
        projectRoot: repoDir,
        remoteOriginUrl: "git@github.com:org/alpha.git",
        gitCommonDir: path.join(repoDir, ".git"),
      });
      const project: EnrolledProject = {
        projectId,
        slug: "alpha",
        name: "Alpha",
        repoSlug: "org/alpha",
        trunkBranch: "main",
        localRoot: repoDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["hosted"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: iso(NOW),
        updatedAt: iso(NOW),
      };
      registry.enrollProject(project);

      let deliveredSecret = "";
      const created = await applicationBarrel.createApiCredential(
        {
          authStore: store,
          grantAdmin: store,
          crypto,
          clock,
          projectRegistry: registry,
          deliverSecret: async (raw) => {
            deliveredSecret = raw;
          },
        },
        {
          credentialId: "cred-alpha",
          label: "pilot-cli",
          issuer: "local-admin",
          audienceOrigin: ORIGIN,
          expiresAt: iso(NOW + 86_400_000),
          grants: [{ projectId, role: "viewer" }],
        },
      );

      const google = createGoogleIdentityVerifier({
        clientId: audience,
        readAllowlist: async () => allowlist,
        fetch: async () => Response.json({ keys: [publicJwk] }),
      });
      const proxyFetch = vi.fn(async () => {
        // Origin revocation must already be persisted in SQLite before proxy logout runs.
        const row = db
          .prepare(
            "SELECT revoked_at FROM google_sessions WHERE principal_id = ?",
          )
          .get("https://accounts.google.com:google-user-99") as
          | { revoked_at: string | null }
          | undefined;
        expect(row?.revoked_at).toBe(iso(now));
        const headers = new Headers();
        headers.append(
          "set-cookie",
          "__Host-gwrk_session_0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
        );
        headers.append(
          "set-cookie",
          "__Host-gwrk_session_1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
        );
        headers.set("location", "https://attacker.invalid/redirect");
        return new Response(null, { status: 302, headers });
      });
      const proxy = createProxySessionLogout({ fetch: proxyFetch, clock });
      const authenticate = applicationBarrel.createRequestAuthenticator({
        store,
        crypto,
        google,
        clock,
        expectedOrigin: ORIGIN,
        sessionCookieName: "__Host-gwrk_session",
      });
      const browser = applicationBarrel.createBrowserSessionService({
        store,
        proxy,
        clock,
      });

      // 1. Valid API credential authenticates without adding any new role bindings.
      const bindingsBefore = db
        .prepare("SELECT COUNT(*) AS n FROM project_role_bindings")
        .get() as { n: number };
      expect(bindingsBefore.n).toBe(1);
      const apiAuth = await authenticate({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${deliveredSecret}`,
      });
      expect(apiAuth).toEqual({
        ok: true,
        context: {
          principalType: "cli_token",
          principalId: created.credential.credentialId,
          credentialId: created.credential.credentialId,
          authMethod: "api_key",
          expiresAt: iso(NOW + 86_400_000),
        },
      });
      // Revoking API credential denies subsequent authentication.
      applicationBarrel.revokeApiCredential(
        { authStore: store, clock },
        { credentialId: created.credential.credentialId, reason: "test" },
      );
      expect(
        await authenticate({
          routeAuthPolicy: "google_or_api_key",
          authorizationHeader: `Bearer ${deliveredSecret}`,
        }),
      ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });

      // 2. Valid Google ID token authenticates, stores digest only, and grants zero project roles.
      const googleAuth = await authenticate({
        routeAuthPolicy: "google_or_api_key",
        forwardedGoogleIdToken: idToken,
      });
      expect(googleAuth.ok).toBe(true);
      if (!googleAuth.ok || !googleAuth.context) {
        throw new Error("expected verified google auth context");
      }
      expect(googleAuth.context.principalType).toBe("google_sub");
      expect(googleAuth.context.principalId).toBe(
        "https://accounts.google.com:google-user-99",
      );
      expect(googleAuth.context.expiresAt).toBe(iso(NOW + 3_600_000));

      const bindingsAfter = db
        .prepare("SELECT COUNT(*) AS n FROM project_role_bindings")
        .get() as { n: number };
      expect(bindingsAfter.n).toBe(1);
      const storedSession = db
        .prepare("SELECT * FROM google_sessions")
        .all() as Record<string, unknown>[];
      expect(storedSession).toHaveLength(1);
      expect(JSON.stringify(storedSession)).not.toContain(idToken);

      // 3. Live allowlist removal denies the next authenticated request without restart.
      allowlist = [];
      expect(
        await authenticate({
          routeAuthPolicy: "google_or_api_key",
          forwardedGoogleIdToken: idToken,
        }),
      ).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });
      allowlist = ["operator@example.com"];

      // 4. Origin-first logout revokes digest in SQLite before calling fixed internal proxy logout,
      //    preserves separate chunk clearing headers without following redirects, and denies replay.
      const logoutResult = await browser.logout(googleAuth.context, {
        cookieHeader:
          "__Host-gwrk_session_0=part0; __Host-gwrk_session_1=part1",
      });
      expect(logoutResult).toEqual({
        ok: true,
        proxyCleared: true,
        setCookieHeaders: [
          "__Host-gwrk_session_0=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
          "__Host-gwrk_session_1=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax",
        ],
      });
      expect(proxyFetch).toHaveBeenCalledWith(
        PROXY_LOGOUT_URL,
        expect.objectContaining({
          method: "GET",
          redirect: "manual",
        }),
      );
      expect(
        await authenticate({
          routeAuthPolicy: "google_or_api_key",
          forwardedGoogleIdToken: idToken,
        }),
      ).toMatchObject({ ok: false, code: "AUTH_SESSION_REVOKED" });
    } finally {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
