/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import {
  ALLOWED_GOOGLE_ALGORITHMS,
  ALLOWED_GOOGLE_ISSUERS,
  CANONICAL_GOOGLE_ISSUER,
  DEFAULT_HOSTED_SECURITY_POLICY,
  FORBIDDEN_PUBLIC_IDENTITY_HEADERS,
  FORBIDDEN_PUBLIC_IDENTITY_HEADER_PREFIX,
  HostedSecurityPolicySchema,
  classifyHostedRoute,
  computeBrowserSessionCap,
  evaluateApiCredentialLifecycle,
  evaluateBrowserMutationPolicy,
  evaluateGoogleSessionLifecycle,
  evaluateGoogleTokenClaims,
  evaluateOutboundCredentialTarget,
  formatGooglePrincipalId,
  isForbiddenPublicIdentityHeader,
  normalizeGoogleIssuer,
  parseOpaqueApiCredential,
  redactAuthHeaders,
  redactAuthText,
  redactAuthUrl,
  selectRequestCredentialMechanism,
  validateAccountAllowlist,
  validateApiCredentialExpiry,
  validateGoogleTokenHeader,
  validateHostedSecurityPolicy,
} from "./auth-policy.js";

const ORIGIN = "https://gwrk.gforge.ai";
const CLIENT_ID = "pilot-client-id.apps.googleusercontent.com";
const NOW_MS = Date.parse("2026-11-23T18:00:00.000Z");
const NOW_SEC = Math.floor(NOW_MS / 1000);
const VALID_SECRET_32B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmno_0"; // 43 base64url chars = 32 bytes
const VALID_CREDENTIAL = `gwrk_v1.cred_pilot_01.${VALID_SECRET_32B}`;

describe("FR-015 hosted security policy defaults and bounds", () => {
  it("TR-020 freezes exact numeric defaults from contracts/security-policy.md", () => {
    expect(
      HostedSecurityPolicySchema.parse(DEFAULT_HOSTED_SECURITY_POLICY),
    ).toEqual({
      browserSessionCapSeconds: 3600,
      futureIatToleranceSeconds: 60,
      apiCredentialMaxLifetimeSeconds: 30 * 24 * 60 * 60,
      jwksRequestTimeoutSeconds: 5,
      jwksCacheAgeSeconds: 600,
      jwksCacheKeyCount: 100,
      jwksResponseMaxBytes: 65_536,
      unknownKeyRefreshCooldownSeconds: 30,
      proxyLogoutTimeoutSeconds: 5,
      remoteCliTimeoutSeconds: 10,
      credentialBearingRedirects: 0,
      httpHeaderMaxBytes: 16_384,
      httpBodyMaxBytes: 1_048_576,
      opaqueApiCredentialMaxBytes: 256,
      googleIdTokenMaxBytes: 8192,
      loginRequestsPerIpPerMinute: 60,
      unauthenticatedApiAttemptsPerIpPerMinute: 60,
      apiRequestsPerCredentialPerMinute: 120,
      rateLimitBucketCount: 1000,
      idleBucketRetentionSeconds: 120,
    });
  });

  it("TR-020 accepts stricter in-range overrides and rejects out-of-range limits", () => {
    const stricter = validateHostedSecurityPolicy({
      ...DEFAULT_HOSTED_SECURITY_POLICY,
      browserSessionCapSeconds: 600,
      futureIatToleranceSeconds: 0,
      apiCredentialMaxLifetimeSeconds: 7 * 24 * 60 * 60,
      opaqueApiCredentialMaxBytes: 128,
      unknownKeyRefreshCooldownSeconds: 60,
    });
    expect(stricter.ok).toBe(true);

    const invalidCases: Array<Partial<typeof DEFAULT_HOSTED_SECURITY_POLICY>> =
      [
        { browserSessionCapSeconds: 59 },
        { browserSessionCapSeconds: 3601 },
        { futureIatToleranceSeconds: -1 },
        { futureIatToleranceSeconds: 61 },
        { apiCredentialMaxLifetimeSeconds: 0 },
        { apiCredentialMaxLifetimeSeconds: 30 * 24 * 60 * 60 + 1 },
        { jwksRequestTimeoutSeconds: 6 },
        { jwksCacheAgeSeconds: 601 },
        { jwksCacheKeyCount: 101 },
        { jwksResponseMaxBytes: 65_537 },
        { unknownKeyRefreshCooldownSeconds: 61 },
        { proxyLogoutTimeoutSeconds: 6 },
        { remoteCliTimeoutSeconds: 11 },
        { credentialBearingRedirects: 1 as never },
        { httpHeaderMaxBytes: 16_385 },
        { httpBodyMaxBytes: 1_048_577 },
        { opaqueApiCredentialMaxBytes: 127 },
        { opaqueApiCredentialMaxBytes: 257 },
        { googleIdTokenMaxBytes: 8193 },
        { loginRequestsPerIpPerMinute: 61 },
        { unauthenticatedApiAttemptsPerIpPerMinute: 61 },
        { apiRequestsPerCredentialPerMinute: 121 },
        { rateLimitBucketCount: 1001 },
        { idleBucketRetentionSeconds: 121 },
      ];

    for (const override of invalidCases) {
      const result = validateHostedSecurityPolicy({
        ...DEFAULT_HOSTED_SECURITY_POLICY,
        ...override,
      });
      expect(
        result.ok,
        `expected rejection for ${JSON.stringify(override)}`,
      ).toBe(false);
    }
  });
});

describe("FR-002 Google ID token issuer normalization, header checks, and claim policy", () => {
  it("TR-001 US-001 normalizes both documented Google issuer variants to google_sub", () => {
    expect(CANONICAL_GOOGLE_ISSUER).toBe("https://accounts.google.com");
    expect(ALLOWED_GOOGLE_ISSUERS).toEqual([
      "accounts.google.com",
      "https://accounts.google.com",
    ]);
    expect(ALLOWED_GOOGLE_ALGORITHMS).toEqual(["RS256"]);

    for (const issuer of ALLOWED_GOOGLE_ISSUERS) {
      expect(normalizeGoogleIssuer(issuer)).toEqual({
        ok: true,
        canonicalIssuer: "https://accounts.google.com",
      });
      const result = evaluateGoogleTokenClaims({
        issuer,
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "Operator@Example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC - 30,
        expiresAtSeconds: NOW_SEC + 1800,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      });
      expect(result).toEqual({
        ok: true,
        canonicalIssuer: "https://accounts.google.com",
        subject: "109876543210",
        principalId: "https://accounts.google.com:109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtMs: (NOW_SEC - 30) * 1000,
        expiresAtMs: (NOW_SEC + 1800) * 1000,
      });
    }

    expect(formatGooglePrincipalId("sub-42")).toEqual({
      ok: true,
      principalId: "https://accounts.google.com:sub-42",
    });
    expect(formatGooglePrincipalId("   ")).toMatchObject({
      ok: false,
      code: "AUTH_TOKEN_INVALID",
    });
  });

  it("TR-001 AUTH-01 rejects non-RS256 algorithms, token-supplied key URLs, oversized tokens, and wrong issuer or audience", () => {
    for (const alg of ["HS256", "none", "ES256", "RS384", "PS256", undefined]) {
      expect(
        validateGoogleTokenHeader({ alg, rawTokenBytes: 1024 }),
      ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    }

    expect(
      validateGoogleTokenHeader({
        alg: "RS256",
        jku: "https://evil.example/jwks.json",
        rawTokenBytes: 1024,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    expect(
      validateGoogleTokenHeader({
        alg: "RS256",
        x5u: "https://evil.example/cert.pem",
        rawTokenBytes: 1024,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    expect(
      validateGoogleTokenHeader({
        alg: "RS256",
        jwk: { kty: "RSA" },
        rawTokenBytes: 1024,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    expect(
      validateGoogleTokenHeader({
        alg: "RS256",
        rawTokenBytes: DEFAULT_HOSTED_SECURITY_POLICY.googleIdTokenMaxBytes + 1,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
    expect(
      validateGoogleTokenHeader({ alg: "RS256", rawTokenBytes: 1024 }),
    ).toEqual({ ok: true, alg: "RS256" });

    for (const badIssuer of [
      "http://accounts.google.com",
      "https://accounts.google.com/",
      "https://evil.example",
      "",
    ]) {
      expect(normalizeGoogleIssuer(badIssuer)).toMatchObject({
        ok: false,
        code: "AUTH_TOKEN_INVALID",
      });
    }

    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: "wrong-client-id.apps.googleusercontent.com",
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC - 10,
        expiresAtSeconds: NOW_SEC + 600,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_INVALID" });
  });

  it("TR-001 AUTH-02 enforces strict expiry and bounded 60-second future iat skew", () => {
    // Exact expiry boundary fails closed (zero expiry grace)
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC - 600,
        expiresAtSeconds: NOW_SEC,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_EXPIRED" });

    // Future iat at +61s fails closed
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC + 61,
        expiresAtSeconds: NOW_SEC + 1800,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_TOKEN_EXPIRED" });

    // Future iat at +60s is within allowed skew
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC + 60,
        expiresAtSeconds: NOW_SEC + 1800,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: true });
  });

  it("TR-001 AUTH-03 denies unverified email, unlisted accounts, empty allowlists, and wildcard rules", () => {
    expect(validateAccountAllowlist([])).toMatchObject({
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
    });
    for (const wildcard of ["*", "*@gforge.ai", "@gforge.ai", "ops@*"]) {
      expect(validateAccountAllowlist([wildcard])).toMatchObject({
        ok: false,
        code: "AUTH_ACCOUNT_DENIED",
      });
    }

    // Unverified email
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: false,
        issuedAtSeconds: NOW_SEC - 10,
        expiresAtSeconds: NOW_SEC + 600,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });

    // Empty allowlist
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "operator@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC - 10,
        expiresAtSeconds: NOW_SEC + 600,
        nowMs: NOW_MS,
        allowlist: [],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });

    // Unlisted account
    expect(
      evaluateGoogleTokenClaims({
        issuer: "https://accounts.google.com",
        audience: CLIENT_ID,
        expectedAudience: CLIENT_ID,
        subject: "109876543210",
        email: "intruder@example.com",
        emailVerified: true,
        issuedAtSeconds: NOW_SEC - 10,
        expiresAtSeconds: NOW_SEC + 600,
        nowMs: NOW_MS,
        allowlist: ["operator@example.com"],
      }),
    ).toMatchObject({ ok: false, code: "AUTH_ACCOUNT_DENIED" });
  });
});

describe("FR-003 browser session cap and revocation lifecycle", () => {
  it("US-002 caps browser sessions at 1 hour and token expiry without extending an existing cap", () => {
    const oneHourMs = 3600 * 1000;
    // Token expires in 2 hours -> capped at 1 hour
    expect(
      computeBrowserSessionCap({
        observedAtMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS + 2 * oneHourMs,
      }),
    ).toBe(NOW_MS + oneHourMs);

    // Token expires in 15 minutes -> capped at token expiry
    expect(
      computeBrowserSessionCap({
        observedAtMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS + 15 * 60 * 1000,
      }),
    ).toBe(NOW_MS + 15 * 60 * 1000);

    // Re-observing later NEVER extends the original session cap
    const originalCap = NOW_MS + 1800 * 1000;
    expect(
      computeBrowserSessionCap({
        observedAtMs: NOW_MS + 1200 * 1000,
        tokenExpiresAtMs: NOW_MS + 2 * oneHourMs,
        existingSessionCapAtMs: originalCap,
      }),
    ).toBe(originalCap);
  });

  it("US-002 AUTH-06 denies revoked digests and expired sessions strictly", () => {
    expect(
      evaluateGoogleSessionLifecycle({
        nowMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS + 1800_000,
        sessionCapAtMs: NOW_MS + 1800_000,
        revokedAtMs: NOW_MS - 1,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_SESSION_REVOKED" });

    expect(
      evaluateGoogleSessionLifecycle({
        nowMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS + 1800_000,
        sessionCapAtMs: NOW_MS,
        revokedAtMs: null,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_SESSION_EXPIRED" });

    expect(
      evaluateGoogleSessionLifecycle({
        nowMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS,
        sessionCapAtMs: NOW_MS + 1800_000,
        revokedAtMs: null,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_SESSION_EXPIRED" });

    expect(
      evaluateGoogleSessionLifecycle({
        nowMs: NOW_MS,
        tokenExpiresAtMs: NOW_MS + 1800_000,
        sessionCapAtMs: NOW_MS + 1800_000,
        revokedAtMs: null,
      }),
    ).toEqual({ ok: true });
  });
});

describe("FR-004 opaque API credential grammar and lifecycle", () => {
  it("TR-007 AUTH-07 parses valid gwrk_v1 credentials and rejects malformed, wrong-version, and oversized keys before lookup", () => {
    expect(parseOpaqueApiCredential(VALID_CREDENTIAL)).toEqual({
      ok: true,
      version: "v1",
      credentialId: "cred_pilot_01",
      secret: VALID_SECRET_32B,
    });

    const invalidKeys = [
      "",
      "   ",
      "not-a-key",
      `gwrk_v2.cred_pilot_01.${VALID_SECRET_32B}`,
      `gwrk_v0.cred_pilot_01.${VALID_SECRET_32B}`,
      `gwrk_v1..${VALID_SECRET_32B}`,
      "gwrk_v1.cred_pilot_01.short",
      `gwrk_v1.cred_pilot_01.${VALID_SECRET_32B}.extra`,
      `gwrk_v1.bad/id.${VALID_SECRET_32B}`,
      `gwrk_v1.cred_pilot_01.${"a".repeat(300)}`, // exceeds 256-byte limit
      `gwrk_v1.cred_pilot_01.${VALID_SECRET_32B.slice(0, 42)}+`, // invalid base64url char
    ];

    for (const candidate of invalidKeys) {
      expect(
        parseOpaqueApiCredential(candidate),
        `expected AUTH_CREDENTIAL_INVALID for ${candidate.slice(0, 32)}`,
      ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_INVALID" });
    }
  });

  it("TR-007 US-003 enforces finite issuance expiry within the 30-day policy maximum", () => {
    const validExpiry = new Date(
      NOW_MS + 7 * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(
      validateApiCredentialExpiry({ nowMs: NOW_MS, expiresAt: validExpiry }),
    ).toMatchObject({ ok: true, expiresAt: validExpiry });

    const maxExpiry = new Date(
      NOW_MS +
        DEFAULT_HOSTED_SECURITY_POLICY.apiCredentialMaxLifetimeSeconds * 1000,
    ).toISOString();
    expect(
      validateApiCredentialExpiry({ nowMs: NOW_MS, expiresAt: maxExpiry }),
    ).toMatchObject({ ok: true });

    const invalidExpiries = [
      "",
      "never",
      "not-a-date",
      new Date(NOW_MS).toISOString(),
      new Date(NOW_MS - 1000).toISOString(),
      new Date(
        NOW_MS +
          (DEFAULT_HOSTED_SECURITY_POLICY.apiCredentialMaxLifetimeSeconds + 1) *
            1000,
      ).toISOString(),
    ];

    for (const expiresAt of invalidExpiries) {
      expect(
        validateApiCredentialExpiry({ nowMs: NOW_MS, expiresAt }),
        `expected rejection for expiresAt=${expiresAt}`,
      ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_INVALID" });
    }
  });

  it("TR-007 AUTH-07 rejects wrong-origin, expired, revoked, and overlap-expired credentials and maps valid keys to cli_token", () => {
    const futureIso = new Date(NOW_MS + 3600_000).toISOString();
    const pastIso = new Date(NOW_MS - 1000).toISOString();
    const nowIso = new Date(NOW_MS).toISOString();

    expect(
      evaluateApiCredentialLifecycle({
        credentialId: "cred_pilot_01",
        audienceOrigin: ORIGIN,
        expectedOrigin: ORIGIN,
        expiresAt: futureIso,
        revokedAt: null,
        overlapUntil: null,
        nowMs: NOW_MS,
      }),
    ).toEqual({
      ok: true,
      principalType: "cli_token",
      principalId: "cred_pilot_01",
      credentialId: "cred_pilot_01",
      expiresAt: futureIso,
      authMethod: "api_key",
    });

    // Wrong origin
    expect(
      evaluateApiCredentialLifecycle({
        credentialId: "cred_pilot_01",
        audienceOrigin: "https://staging.gforge.ai",
        expectedOrigin: ORIGIN,
        expiresAt: futureIso,
        revokedAt: null,
        overlapUntil: null,
        nowMs: NOW_MS,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });

    // Strict expiry
    expect(
      evaluateApiCredentialLifecycle({
        credentialId: "cred_pilot_01",
        audienceOrigin: ORIGIN,
        expectedOrigin: ORIGIN,
        expiresAt: nowIso,
        revokedAt: null,
        overlapUntil: null,
        nowMs: NOW_MS,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });

    // Revoked
    expect(
      evaluateApiCredentialLifecycle({
        credentialId: "cred_pilot_01",
        audienceOrigin: ORIGIN,
        expectedOrigin: ORIGIN,
        expiresAt: futureIso,
        revokedAt: pastIso,
        overlapUntil: null,
        nowMs: NOW_MS,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });

    // Overlap expired
    expect(
      evaluateApiCredentialLifecycle({
        credentialId: "cred_pilot_01",
        audienceOrigin: ORIGIN,
        expectedOrigin: ORIGIN,
        expiresAt: futureIso,
        revokedAt: null,
        overlapUntil: nowIso,
        nowMs: NOW_MS,
      }),
    ).toMatchObject({ ok: false, code: "AUTH_CREDENTIAL_REJECTED" });
  });
});

describe("FR-010 default-deny route policy table and HEAD parity", () => {
  it("TR-011 US-006 classifies all 14 contract routes with exact access and redirect policies", () => {
    expect(classifyHostedRoute({ method: "GET", path: "/" })).toMatchObject({
      allowed: true,
      authPolicy: "public_browser_entry",
      requiredAccess: "none",
      publicRoutable: true,
      allowInteractiveRedirect: true,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/oauth2/start" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "public_oauth_start",
      requiredAccess: "none",
      publicRoutable: true,
      allowInteractiveRedirect: true,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({
        method: "GET",
        path: "/oauth2/callback?code=abc&state=xyz",
      }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "public_oauth_callback",
      requiredAccess: "none",
      publicRoutable: true,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "POST", path: "/api/auth/logout" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_session_only",
      requiredAccess: "own_session",
      publicRoutable: true,
      requiresCsrfForBrowser: true,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/api/auth/session" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_session_only",
      requiredAccess: "own_session",
      publicRoutable: true,
      requiresCsrfForBrowser: false,
      allowInteractiveRedirect: false,
      noStore: true,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/api/status?project=alpha" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "POST", path: "/api/dispatch" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "operate",
      requiresCsrfForBrowser: true,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/api/dispatch/queue" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({
        method: "GET",
        path: "/api/dispatch/051-hosted-aws-pilot/phase-01",
      }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "POST", path: "/api/notify" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "operate",
      requiresCsrfForBrowser: true,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/api/health?project=alpha" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "GET", path: "/health" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "private_liveness_only",
      requiredAccess: "none",
      publicRoutable: false,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
    expect(
      classifyHostedRoute({ method: "POST", path: "/webhook/github" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "provider_webhook",
      requiredAccess: "enrolled_repository",
      publicRoutable: true,
      requiresCsrfForBrowser: false,
      allowInteractiveRedirect: false,
      corsAllowed: false,
    });
  });

  it("TR-011 US-006 enforces default-deny for unclassified routes, /oauth2/sign_out, and disallowed HTTP methods while preserving HEAD parity", () => {
    // Public /oauth2/sign_out is never publicly allowed
    expect(
      classifyHostedRoute({ method: "GET", path: "/oauth2/sign_out" }),
    ).toMatchObject({ allowed: false, code: "ROUTE_NOT_PUBLIC" });
    expect(
      classifyHostedRoute({ method: "POST", path: "/oauth2/sign_out" }),
    ).toMatchObject({ allowed: false, code: "ROUTE_NOT_PUBLIC" });

    // Unclassified routes fail closed with 404
    for (const path of [
      "/api/admin",
      "/api/keys",
      "/debug",
      "/metrics",
      "/etc/passwd",
    ]) {
      expect(classifyHostedRoute({ method: "GET", path })).toMatchObject({
        allowed: false,
        statusCode: 404,
        code: "ROUTE_NOT_FOUND",
      });
    }

    // Disallowed methods on known routes fail closed with 405
    for (const req of [
      { method: "DELETE", path: "/api/status" },
      { method: "PUT", path: "/api/dispatch" },
      { method: "GET", path: "/api/auth/logout" },
      { method: "POST", path: "/api/health" },
      { method: "GET", path: "/webhook/github" },
      { method: "HEAD", path: "/api/dispatch" },
      { method: "OPTIONS", path: "/api/status" },
    ]) {
      expect(classifyHostedRoute(req)).toMatchObject({
        allowed: false,
        statusCode: 405,
        code: "METHOD_NOT_ALLOWED",
      });
    }

    // HEAD follows corresponding GET read policy
    expect(
      classifyHostedRoute({ method: "HEAD", path: "/api/status" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
    });
    expect(
      classifyHostedRoute({ method: "HEAD", path: "/api/health" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "google_or_api_key",
      requiredAccess: "read",
    });
    expect(
      classifyHostedRoute({ method: "HEAD", path: "/health" }),
    ).toMatchObject({
      allowed: true,
      authPolicy: "private_liveness_only",
      publicRoutable: false,
    });
  });
});

describe("FR-007 and FR-009 credential selection, forged identity headers, and browser mutation protection", () => {
  it("TR-011 AUTH-04 identifies forbidden public identity and auth-mode headers", () => {
    expect(FORBIDDEN_PUBLIC_IDENTITY_HEADERS).toEqual(
      expect.arrayContaining([
        "x-forwarded-user",
        "x-forwarded-email",
        "x-forwarded-groups",
        "x-forwarded-preferred-username",
        "x-forwarded-access-token",
      ]),
    );
    expect(FORBIDDEN_PUBLIC_IDENTITY_HEADER_PREFIX).toBe("x-auth-request-");

    for (const header of [
      "X-Forwarded-User",
      "x-forwarded-email",
      "X-Forwarded-Groups",
      "X-Forwarded-Preferred-Username",
      "X-Forwarded-Access-Token",
      "X-Auth-Request-User",
      "X-Auth-Request-Email",
      "x-auth-request-access-token",
    ]) {
      expect(isForbiddenPublicIdentityHeader(header)).toBe(true);
    }
    expect(isForbiddenPublicIdentityHeader("content-type")).toBe(false);
    expect(isForbiddenPublicIdentityHeader("x-gwrk-csrf-token")).toBe(false);
  });

  it("TR-011 US-005 selects API keys before browser cookies, rejects conflicting credentials, and ignores unrelated cookies", () => {
    // Provider webhooks never substitute API keys or browser sessions
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "provider_webhook",
        authorizationHeader: `Bearer ${VALID_CREDENTIAL}`,
      }),
    ).toEqual({ ok: true, mechanism: "webhook" });

    // Caller Authorization with unrelated cookies selects api_key
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${VALID_CREDENTIAL}`,
        cookieHeader: "theme=dark; locale=en-US",
      }),
    ).toEqual({ ok: true, mechanism: "api_key" });

    // Caller Authorization combined with gwrk browser session cookie is a conflict (no fallback)
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${VALID_CREDENTIAL}`,
        cookieHeader: "_oauth2_proxy=session-cookie-value; theme=dark",
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 401,
      code: "AUTH_CONFLICTING_CREDENTIALS",
    });

    // Both API key and forwarded Google ID token supplied together -> conflict
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_or_api_key",
        authorizationHeader: `Bearer ${VALID_CREDENTIAL}`,
        forwardedGoogleIdToken: "eyJhbGciOiJSUzI1NiJ9.payload.sig",
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 401,
      code: "AUTH_CONFLICTING_CREDENTIALS",
    });

    // Browser-only routes reject API keys
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_session_only",
        authorizationHeader: `Bearer ${VALID_CREDENTIAL}`,
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 401,
      code: "AUTH_CONFLICTING_CREDENTIALS",
    });

    // Forwarded Google ID token without caller API key selects google_id_token
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_or_api_key",
        forwardedGoogleIdToken: "eyJhbGciOiJSUzI1NiJ9.payload.sig",
        cookieHeader: "_oauth2_proxy=session-cookie-value",
      }),
    ).toEqual({ ok: true, mechanism: "google_id_token" });

    // Proxy cookie alone without verified forwarded ID token fails closed
    expect(
      selectRequestCredentialMechanism({
        routeAuthPolicy: "google_or_api_key",
        cookieHeader: "_oauth2_proxy=session-cookie-value",
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 401,
      code: "AUTH_REQUIRED",
    });
  });

  it("TR-011 AUTH-11 enforces same-origin Origin and header-only CSRF for browser writes while keeping API keys independent", () => {
    // Valid browser write with matching Origin and dedicated CSRF header
    expect(
      evaluateBrowserMutationPolicy({
        method: "POST",
        authMethod: "google_id_token",
        expectedOrigin: ORIGIN,
        originHeader: ORIGIN,
        csrfHeaderToken: "csrf-token-value",
      }),
    ).toEqual({ ok: true, requiresCsrfVerification: true });

    // Missing or cross-site Origin rejected with 403 AUTH_ORIGIN_MISMATCH
    for (const badOrigin of [
      undefined,
      "",
      "null",
      "https://evil.example",
      "http://gwrk.gforge.ai",
      "https://gwrk.gforge.ai:8443",
    ]) {
      expect(
        evaluateBrowserMutationPolicy({
          method: "POST",
          authMethod: "google_id_token",
          expectedOrigin: ORIGIN,
          originHeader: badOrigin,
          csrfHeaderToken: "csrf-token-value",
        }),
      ).toMatchObject({
        ok: false,
        statusCode: 403,
        code: "AUTH_ORIGIN_MISMATCH",
      });
    }

    // Query-parameter CSRF or missing header CSRF rejected with 403 AUTH_CSRF_INVALID
    expect(
      evaluateBrowserMutationPolicy({
        method: "POST",
        authMethod: "google_id_token",
        expectedOrigin: ORIGIN,
        originHeader: ORIGIN,
        queryCsrfToken: "csrf-token-value",
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 403,
      code: "AUTH_CSRF_INVALID",
    });
    expect(
      evaluateBrowserMutationPolicy({
        method: "DELETE",
        authMethod: "google_id_token",
        expectedOrigin: ORIGIN,
        originHeader: ORIGIN,
      }),
    ).toMatchObject({
      ok: false,
      statusCode: 403,
      code: "AUTH_CSRF_INVALID",
    });

    // Safe methods and API-key mutations do not require browser Origin/CSRF checks
    expect(
      evaluateBrowserMutationPolicy({
        method: "GET",
        authMethod: "google_id_token",
        expectedOrigin: ORIGIN,
      }),
    ).toEqual({ ok: true, requiresCsrfVerification: false });
    expect(
      evaluateBrowserMutationPolicy({
        method: "POST",
        authMethod: "api_key",
        expectedOrigin: ORIGIN,
      }),
    ).toEqual({ ok: true, requiresCsrfVerification: false });
  });
});

describe("FR-013 log, header, and URL redaction", () => {
  it("TR-015 AUTH-15 strips Authorization, Cookie, Set-Cookie, CSRF, OAuth query params, and canary raw secrets", () => {
    const canaryKey = `gwrk_v1.cred_canary_01.${VALID_SECRET_32B}`;
    const canaryCookie =
      "_oauth2_proxy=CANARY_COOKIE_SECRET_9911; __Host-gwrk_csrf=CANARY_CSRF_8822";
    const canarySetCookie = [
      "_oauth2_proxy=; Max-Age=0; HttpOnly; Secure",
      "__Host-gwrk_csrf=CANARY_SET_COOKIE_7733; HttpOnly; Secure",
    ];
    const canaryCode = "CANARY_OAUTH_CODE_6644";
    const canaryState = "CANARY_OAUTH_STATE_5533";

    const redactedHeaders = redactAuthHeaders({
      Authorization: `Bearer ${canaryKey}`,
      Cookie: canaryCookie,
      "Set-Cookie": canarySetCookie,
      "X-Gwrk-Csrf-Token": "CANARY_CSRF_HEADER_4422",
      "X-Auth-Request-Access-Token": "CANARY_ACCESS_TOKEN_3311",
      "X-Forwarded-Access-Token": "CANARY_FWD_ACCESS_2200",
      "Content-Type": "application/json",
      "X-Request-Id": "req-1234",
    });

    const serializedHeaders = JSON.stringify(redactedHeaders);
    expect(serializedHeaders).not.toContain(canaryKey);
    expect(serializedHeaders).not.toContain("CANARY_COOKIE_SECRET_9911");
    expect(serializedHeaders).not.toContain("CANARY_CSRF_8822");
    expect(serializedHeaders).not.toContain("CANARY_SET_COOKIE_7733");
    expect(serializedHeaders).not.toContain("CANARY_CSRF_HEADER_4422");
    expect(serializedHeaders).not.toContain("CANARY_ACCESS_TOKEN_3311");
    expect(serializedHeaders).not.toContain("CANARY_FWD_ACCESS_2200");
    expect(redactedHeaders["Content-Type"]).toBe("application/json");
    expect(redactedHeaders["X-Request-Id"]).toBe("req-1234");

    const redactedUrl = redactAuthUrl(
      `/oauth2/callback?code=${canaryCode}&state=${canaryState}&nonce=CANARY_NONCE&project=alpha`,
    );
    expect(redactedUrl).not.toContain(canaryCode);
    expect(redactedUrl).not.toContain(canaryState);
    expect(redactedUrl).not.toContain("CANARY_NONCE");
    expect(redactedUrl).toContain("/oauth2/callback");
    expect(redactedUrl).toContain("project=alpha");

    const redactedText = redactAuthText(
      `Upstream failed for Bearer ${canaryKey} and token eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_part`,
    );
    expect(redactedText).not.toContain(canaryKey);
    expect(redactedText).not.toContain(VALID_SECRET_32B);
    expect(redactedText).not.toContain("signature_part");
  });
});

describe("FR-014 origin-bound outbound CLI credential policy", () => {
  it("US-009 AUTH-16 allows matching HTTPS origins only and rejects non-HTTPS, mismatched hosts, ports, and userinfo", () => {
    expect(
      evaluateOutboundCredentialTarget({
        targetUrl: "https://gwrk.gforge.ai/api/status?project=alpha",
        boundOrigin: ORIGIN,
      }),
    ).toEqual({
      ok: true,
      targetOrigin: ORIGIN,
      attachCredential: true,
    });

    expect(
      evaluateOutboundCredentialTarget({
        targetUrl: "http://gwrk.gforge.ai/api/status",
        boundOrigin: ORIGIN,
      }),
    ).toMatchObject({ ok: false, code: "HTTPS_REQUIRED" });

    for (const mismatched of [
      "https://other.example/api/status",
      "https://gwrk.gforge.ai:8443/api/status",
      "https://gwrk.gforge.ai.evil.com/api/status",
      "https://user:pass@gwrk.gforge.ai/api/status",
    ]) {
      expect(
        evaluateOutboundCredentialTarget({
          targetUrl: mismatched,
          boundOrigin: ORIGIN,
        }),
        `expected ORIGIN_MISMATCH for ${mismatched}`,
      ).toMatchObject({ ok: false, code: "ORIGIN_MISMATCH" });
    }

    expect(
      evaluateOutboundCredentialTarget({
        targetUrl: "not-a-valid-url",
        boundOrigin: ORIGIN,
      }),
    ).toMatchObject({ ok: false, code: "PROFILE_INVALID" });
  });
});
