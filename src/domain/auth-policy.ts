/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { z } from "zod";

export const CANONICAL_GOOGLE_ISSUER = "https://accounts.google.com" as const;
export type CanonicalGoogleIssuer = typeof CANONICAL_GOOGLE_ISSUER;

export const ALLOWED_GOOGLE_ISSUERS = [
  "accounts.google.com",
  CANONICAL_GOOGLE_ISSUER,
] as const;

export const ALLOWED_GOOGLE_ALGORITHMS = ["RS256"] as const;
export type AllowedGoogleAlgorithm = (typeof ALLOWED_GOOGLE_ALGORITHMS)[number];

export const FORBIDDEN_PUBLIC_IDENTITY_HEADERS = [
  "x-forwarded-user",
  "x-forwarded-email",
  "x-forwarded-groups",
  "x-forwarded-preferred-username",
  "x-forwarded-access-token",
] as const;

export const FORBIDDEN_PUBLIC_IDENTITY_HEADER_PREFIX =
  "x-auth-request-" as const;

export type AuthPrincipalType = "google_sub" | "cli_token";
export type AuthMethod = "google_id_token" | "api_key";

export interface ApiCredentialMetadata {
  readonly credentialId: string;
  readonly label: string;
  readonly issuer: string;
  readonly audienceOrigin: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
  readonly rotatedFromId: string | null;
  readonly overlapUntil: string | null;
}

export interface StoredApiCredential extends ApiCredentialMetadata {
  readonly verifierSha256: string;
}

export interface StoredGoogleSession {
  readonly tokenDigestSha256: string;
  readonly principalId: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly sessionCapAt: string;
  readonly revokedAt: string | null;
  readonly revokedReason: string | null;
}

export interface AuthAuditEvent {
  readonly id?: number;
  readonly occurredAt: string;
  readonly eventType: string;
  readonly outcome: "allowed" | "denied" | "error";
  readonly principalType: AuthPrincipalType | null;
  readonly principalId: string | null;
  readonly credentialId: string | null;
  readonly requestId: string | null;
  readonly detailCode: string | null;
  readonly metadata?: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

const SECONDS_PER_DAY = 24 * 60 * 60;
const MAX_API_CREDENTIAL_LIFETIME_SECONDS = 30 * SECONDS_PER_DAY;

export const HostedSecurityPolicySchema = z
  .object({
    browserSessionCapSeconds: z.number().int().min(60).max(3600),
    futureIatToleranceSeconds: z.number().int().min(0).max(60),
    apiCredentialMaxLifetimeSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_API_CREDENTIAL_LIFETIME_SECONDS),
    jwksRequestTimeoutSeconds: z.number().int().min(1).max(5),
    jwksCacheAgeSeconds: z.number().int().min(1).max(600),
    jwksCacheKeyCount: z.number().int().min(1).max(100),
    jwksResponseMaxBytes: z.number().int().min(1024).max(65_536),
    unknownKeyRefreshCooldownSeconds: z.number().int().min(1).max(60),
    proxyLogoutTimeoutSeconds: z.number().int().min(1).max(5),
    remoteCliTimeoutSeconds: z.number().int().min(1).max(10),
    credentialBearingRedirects: z.literal(0),
    httpHeaderMaxBytes: z.number().int().min(1024).max(16_384),
    httpBodyMaxBytes: z.number().int().min(1024).max(1_048_576),
    opaqueApiCredentialMaxBytes: z.number().int().min(128).max(256),
    googleIdTokenMaxBytes: z.number().int().min(1024).max(8192),
    loginRequestsPerIpPerMinute: z.number().int().min(1).max(60),
    unauthenticatedApiAttemptsPerIpPerMinute: z.number().int().min(1).max(60),
    apiRequestsPerCredentialPerMinute: z.number().int().min(1).max(120),
    rateLimitBucketCount: z.number().int().min(1).max(1000),
    idleBucketRetentionSeconds: z.number().int().min(1).max(120),
  })
  .strict();

export type HostedSecurityPolicy = z.infer<typeof HostedSecurityPolicySchema>;

export const DEFAULT_HOSTED_SECURITY_POLICY: HostedSecurityPolicy =
  Object.freeze({
    browserSessionCapSeconds: 3600,
    futureIatToleranceSeconds: 60,
    apiCredentialMaxLifetimeSeconds: MAX_API_CREDENTIAL_LIFETIME_SECONDS,
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

export function validateHostedSecurityPolicy(
  input: unknown,
): { ok: true; value: HostedSecurityPolicy } | { ok: false; error: string } {
  const parsed = HostedSecurityPolicySchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }
  const issue = parsed.error.issues[0];
  const field = issue.path.join(".") || "HostedSecurityPolicy";
  return { ok: false, error: `${field}: ${issue.message}` };
}

export function normalizeGoogleIssuer(
  issuer: string | undefined | null,
):
  | { ok: true; canonicalIssuer: CanonicalGoogleIssuer }
  | { ok: false; code: "AUTH_TOKEN_INVALID"; message: string } {
  if (
    issuer === ALLOWED_GOOGLE_ISSUERS[0] ||
    issuer === ALLOWED_GOOGLE_ISSUERS[1]
  ) {
    return { ok: true, canonicalIssuer: CANONICAL_GOOGLE_ISSUER };
  }
  return {
    ok: false,
    code: "AUTH_TOKEN_INVALID",
    message: "Google ID token issuer is not allowed",
  };
}

export function formatGooglePrincipalId(
  subject: string | undefined | null,
):
  | { ok: true; principalId: string }
  | { ok: false; code: "AUTH_TOKEN_INVALID"; message: string } {
  if (typeof subject !== "string") {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token subject is missing",
    };
  }
  const trimmed = subject.trim();
  if (trimmed.length === 0 || /\s/.test(trimmed)) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token subject must be a non-empty token",
    };
  }
  return {
    ok: true,
    principalId: `${CANONICAL_GOOGLE_ISSUER}:${trimmed}`,
  };
}

export interface ValidateGoogleTokenHeaderInput {
  readonly alg?: string;
  readonly jku?: unknown;
  readonly x5u?: unknown;
  readonly jwk?: unknown;
  readonly x5c?: unknown;
  readonly rawTokenBytes: number;
  readonly policy?: HostedSecurityPolicy;
}

export function validateGoogleTokenHeader(
  input: ValidateGoogleTokenHeaderInput,
):
  | { ok: true; alg: AllowedGoogleAlgorithm }
  | { ok: false; code: "AUTH_TOKEN_INVALID"; message: string } {
  const maxBytes =
    input.policy?.googleIdTokenMaxBytes ??
    DEFAULT_HOSTED_SECURITY_POLICY.googleIdTokenMaxBytes;
  if (
    !Number.isFinite(input.rawTokenBytes) ||
    input.rawTokenBytes <= 0 ||
    input.rawTokenBytes > maxBytes
  ) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token size exceeds policy bounds",
    };
  }
  if (
    input.jku !== undefined ||
    input.x5u !== undefined ||
    input.jwk !== undefined ||
    input.x5c !== undefined
  ) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Token-supplied key headers are forbidden",
    };
  }
  if (input.alg !== "RS256") {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token algorithm must be RS256",
    };
  }
  return { ok: true, alg: "RS256" };
}

const EXPLICIT_EMAIL_PATTERN = /^[^\s@*]+@[^\s@*]+\.[^\s@*]+$/;

export function validateAccountAllowlist(
  allowlist: readonly string[],
):
  | { ok: true; accounts: readonly string[] }
  | { ok: false; code: "AUTH_ACCOUNT_DENIED"; message: string } {
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return {
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      message: "Google account allowlist is empty",
    };
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of allowlist) {
    if (typeof entry !== "string") {
      return {
        ok: false,
        code: "AUTH_ACCOUNT_DENIED",
        message: "Google account allowlist contains an invalid entry",
      };
    }
    const email = entry.trim().toLowerCase();
    if (
      email.length === 0 ||
      email.includes("*") ||
      !EXPLICIT_EMAIL_PATTERN.test(email)
    ) {
      return {
        ok: false,
        code: "AUTH_ACCOUNT_DENIED",
        message:
          "Google account allowlist permits explicit email addresses only",
      };
    }
    if (!seen.has(email)) {
      seen.add(email);
      normalized.push(email);
    }
  }
  return { ok: true, accounts: normalized };
}

export interface EvaluateGoogleTokenClaimsInput {
  readonly issuer: string | undefined;
  readonly audience: string | readonly string[] | undefined;
  readonly expectedAudience: string;
  readonly subject: string | undefined;
  readonly email: string | undefined;
  readonly emailVerified: boolean | undefined;
  readonly issuedAtSeconds: number | undefined;
  readonly expiresAtSeconds: number | undefined;
  readonly nowMs: number;
  readonly allowlist: readonly string[];
  readonly policy?: HostedSecurityPolicy;
}

export type EvaluateGoogleTokenClaimsResult =
  | {
      readonly ok: true;
      readonly canonicalIssuer: CanonicalGoogleIssuer;
      readonly subject: string;
      readonly principalId: string;
      readonly email: string;
      readonly emailVerified: true;
      readonly issuedAtMs: number;
      readonly expiresAtMs: number;
    }
  | {
      readonly ok: false;
      readonly code:
        | "AUTH_TOKEN_INVALID"
        | "AUTH_TOKEN_EXPIRED"
        | "AUTH_ACCOUNT_DENIED";
      readonly message: string;
    };

export function evaluateGoogleTokenClaims(
  input: EvaluateGoogleTokenClaimsInput,
): EvaluateGoogleTokenClaimsResult {
  const issuerResult = normalizeGoogleIssuer(input.issuer);
  if (!issuerResult.ok) {
    return issuerResult;
  }

  const audienceMatches =
    typeof input.expectedAudience === "string" &&
    input.expectedAudience.length > 0 &&
    (typeof input.audience === "string"
      ? input.audience === input.expectedAudience
      : Array.isArray(input.audience) &&
        input.audience.includes(input.expectedAudience));
  if (!audienceMatches) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token audience does not match configured client",
    };
  }

  const principalResult = formatGooglePrincipalId(input.subject);
  if (!principalResult.ok) {
    return principalResult;
  }

  if (
    typeof input.issuedAtSeconds !== "number" ||
    !Number.isFinite(input.issuedAtSeconds) ||
    typeof input.expiresAtSeconds !== "number" ||
    !Number.isFinite(input.expiresAtSeconds) ||
    !Number.isFinite(input.nowMs)
  ) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token timestamps are invalid",
    };
  }

  const issuedAtMs = input.issuedAtSeconds * 1000;
  const expiresAtMs = input.expiresAtSeconds * 1000;
  if (expiresAtMs <= issuedAtMs) {
    return {
      ok: false,
      code: "AUTH_TOKEN_INVALID",
      message: "Google ID token expiry must follow issued-at",
    };
  }

  if (expiresAtMs <= input.nowMs) {
    return {
      ok: false,
      code: "AUTH_TOKEN_EXPIRED",
      message: "Google ID token has expired",
    };
  }

  const futureToleranceMs =
    (input.policy?.futureIatToleranceSeconds ??
      DEFAULT_HOSTED_SECURITY_POLICY.futureIatToleranceSeconds) * 1000;
  if (issuedAtMs > input.nowMs + futureToleranceMs) {
    return {
      ok: false,
      code: "AUTH_TOKEN_EXPIRED",
      message: "Google ID token issued-at exceeds future clock skew policy",
    };
  }

  if (input.emailVerified !== true) {
    return {
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      message: "Google account email must be verified",
    };
  }

  if (typeof input.email !== "string" || input.email.trim().length === 0) {
    return {
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      message: "Google account email is missing",
    };
  }

  const allowlistResult = validateAccountAllowlist(input.allowlist);
  if (!allowlistResult.ok) {
    return allowlistResult;
  }

  const normalizedEmail = input.email.trim().toLowerCase();
  if (!allowlistResult.accounts.includes(normalizedEmail)) {
    return {
      ok: false,
      code: "AUTH_ACCOUNT_DENIED",
      message: "Google account is not in the allowlist",
    };
  }

  return {
    ok: true,
    canonicalIssuer: issuerResult.canonicalIssuer,
    subject: (input.subject as string).trim(),
    principalId: principalResult.principalId,
    email: normalizedEmail,
    emailVerified: true,
    issuedAtMs,
    expiresAtMs,
  };
}

export interface ComputeBrowserSessionCapInput {
  readonly observedAtMs: number;
  readonly tokenExpiresAtMs: number;
  readonly existingSessionCapAtMs?: number | null;
  readonly policy?: HostedSecurityPolicy;
}

export function computeBrowserSessionCap(
  input: ComputeBrowserSessionCapInput,
): number {
  const capSeconds =
    input.policy?.browserSessionCapSeconds ??
    DEFAULT_HOSTED_SECURITY_POLICY.browserSessionCapSeconds;
  const candidate = Math.min(
    input.observedAtMs + capSeconds * 1000,
    input.tokenExpiresAtMs,
  );
  if (
    typeof input.existingSessionCapAtMs === "number" &&
    Number.isFinite(input.existingSessionCapAtMs)
  ) {
    return Math.min(input.existingSessionCapAtMs, candidate);
  }
  return candidate;
}

export interface EvaluateGoogleSessionLifecycleInput {
  readonly nowMs: number;
  readonly tokenExpiresAtMs: number;
  readonly sessionCapAtMs: number;
  readonly revokedAtMs: number | null;
}

export function evaluateGoogleSessionLifecycle(
  input: EvaluateGoogleSessionLifecycleInput,
):
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: "AUTH_SESSION_REVOKED" | "AUTH_SESSION_EXPIRED";
      readonly message: string;
    } {
  if (input.revokedAtMs !== null) {
    return {
      ok: false,
      code: "AUTH_SESSION_REVOKED",
      message: "Browser session has been revoked",
    };
  }
  if (
    !Number.isFinite(input.nowMs) ||
    !Number.isFinite(input.tokenExpiresAtMs) ||
    !Number.isFinite(input.sessionCapAtMs) ||
    input.nowMs >= input.tokenExpiresAtMs ||
    input.nowMs >= input.sessionCapAtMs
  ) {
    return {
      ok: false,
      code: "AUTH_SESSION_EXPIRED",
      message: "Browser session has expired",
    };
  }
  return { ok: true };
}

const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CREDENTIAL_SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const ISO_DATETIME_SCHEMA = z.string().datetime({ offset: true });
const UTF8_ENCODER = new TextEncoder();

export function parseOpaqueApiCredential(
  rawCredential: string,
  policy?: HostedSecurityPolicy,
):
  | {
      readonly ok: true;
      readonly version: "v1";
      readonly credentialId: string;
      readonly secret: string;
    }
  | {
      readonly ok: false;
      readonly code: "AUTH_CREDENTIAL_INVALID";
      readonly message: string;
    } {
  const maxBytes =
    policy?.opaqueApiCredentialMaxBytes ??
    DEFAULT_HOSTED_SECURITY_POLICY.opaqueApiCredentialMaxBytes;
  if (
    typeof rawCredential !== "string" ||
    rawCredential.length === 0 ||
    rawCredential !== rawCredential.trim() ||
    UTF8_ENCODER.encode(rawCredential).byteLength > maxBytes
  ) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential is empty, padded, or exceeds size bounds",
    };
  }

  const parts = rawCredential.split(".");
  if (parts.length !== 3) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential format must be gwrk_v1.<id>.<secret>",
    };
  }

  const [prefix, credentialId, secret] = parts;
  if (prefix !== "gwrk_v1") {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "Unsupported API credential version",
    };
  }
  if (!CREDENTIAL_ID_PATTERN.test(credentialId)) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential identifier is malformed",
    };
  }
  if (!CREDENTIAL_SECRET_PATTERN.test(secret)) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential secret must be 32-byte base64url",
    };
  }

  return {
    ok: true,
    version: "v1",
    credentialId,
    secret,
  };
}

export interface ValidateApiCredentialExpiryInput {
  readonly nowMs: number;
  readonly expiresAt: string;
  readonly policy?: HostedSecurityPolicy;
}

export function validateApiCredentialExpiry(
  input: ValidateApiCredentialExpiryInput,
):
  | {
      readonly ok: true;
      readonly expiresAt: string;
      readonly expiresAtMs: number;
    }
  | {
      readonly ok: false;
      readonly code: "AUTH_CREDENTIAL_INVALID";
      readonly message: string;
    } {
  if (
    !Number.isFinite(input.nowMs) ||
    !ISO_DATETIME_SCHEMA.safeParse(input.expiresAt).success
  ) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential expiry must be a valid ISO-8601 timestamp",
    };
  }

  const expiresAtMs = Date.parse(input.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= input.nowMs) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential expiry must be in the future",
    };
  }

  const maxLifetimeMs =
    (input.policy?.apiCredentialMaxLifetimeSeconds ??
      DEFAULT_HOSTED_SECURITY_POLICY.apiCredentialMaxLifetimeSeconds) * 1000;
  if (expiresAtMs - input.nowMs > maxLifetimeMs) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_INVALID",
      message: "API credential expiry exceeds maximum lifetime policy",
    };
  }

  return { ok: true, expiresAt: input.expiresAt, expiresAtMs };
}

export interface EvaluateApiCredentialLifecycleInput {
  readonly credentialId: string;
  readonly audienceOrigin: string;
  readonly expectedOrigin: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly overlapUntil: string | null;
  readonly nowMs: number;
}

export function evaluateApiCredentialLifecycle(
  input: EvaluateApiCredentialLifecycleInput,
):
  | {
      readonly ok: true;
      readonly principalType: "cli_token";
      readonly principalId: string;
      readonly credentialId: string;
      readonly expiresAt: string;
      readonly authMethod: "api_key";
    }
  | {
      readonly ok: false;
      readonly code: "AUTH_CREDENTIAL_REJECTED";
      readonly message: string;
    } {
  if (!input.expectedOrigin || input.audienceOrigin !== input.expectedOrigin) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_REJECTED",
      message: "API credential audience origin does not match server origin",
    };
  }

  if (input.revokedAt !== null) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_REJECTED",
      message: "API credential has been revoked",
    };
  }

  const expiresAtMs = Date.parse(input.expiresAt);
  if (
    !Number.isFinite(input.nowMs) ||
    !Number.isFinite(expiresAtMs) ||
    input.nowMs >= expiresAtMs
  ) {
    return {
      ok: false,
      code: "AUTH_CREDENTIAL_REJECTED",
      message: "API credential has expired",
    };
  }

  let effectiveExpiresAt = input.expiresAt;
  if (input.overlapUntil !== null) {
    const overlapUntilMs = Date.parse(input.overlapUntil);
    if (!Number.isFinite(overlapUntilMs) || input.nowMs >= overlapUntilMs) {
      return {
        ok: false,
        code: "AUTH_CREDENTIAL_REJECTED",
        message: "API credential rotation overlap has expired",
      };
    }
    if (overlapUntilMs < expiresAtMs) {
      effectiveExpiresAt = input.overlapUntil;
    }
  }

  return {
    ok: true,
    principalType: "cli_token",
    principalId: input.credentialId,
    credentialId: input.credentialId,
    expiresAt: effectiveExpiresAt,
    authMethod: "api_key",
  };
}

export type HostedRouteAuthPolicy =
  | "public_browser_entry"
  | "public_oauth_start"
  | "public_oauth_callback"
  | "google_session_only"
  | "google_or_api_key"
  | "private_liveness_only"
  | "provider_webhook";

export type HostedRouteAccess =
  | "none"
  | "own_session"
  | "read"
  | "operate"
  | "enrolled_repository";

export interface AllowedHostedRouteClassification {
  readonly allowed: true;
  readonly routeId: string;
  readonly authPolicy: HostedRouteAuthPolicy;
  readonly requiredAccess: HostedRouteAccess;
  readonly publicRoutable: boolean;
  readonly requiresCsrfForBrowser: boolean;
  readonly allowInteractiveRedirect: boolean;
  readonly noStore: boolean;
  readonly corsAllowed: false;
}

export interface DeniedHostedRouteClassification {
  readonly allowed: false;
  readonly statusCode: 404 | 405;
  readonly code: "ROUTE_NOT_PUBLIC" | "ROUTE_NOT_FOUND" | "METHOD_NOT_ALLOWED";
  readonly message: string;
}

export type HostedRouteClassification =
  | AllowedHostedRouteClassification
  | DeniedHostedRouteClassification;

interface RouteSpec {
  readonly routeId: string;
  readonly match: (pathname: string) => boolean;
  readonly methods: readonly string[];
  readonly authPolicy: HostedRouteAuthPolicy;
  readonly requiredAccess: HostedRouteAccess;
  readonly publicRoutable: boolean;
  readonly requiresCsrfForBrowser: boolean;
  readonly allowInteractiveRedirect: boolean;
  readonly noStore: boolean;
}

const DISPATCH_PHASE_PATH = /^\/api\/dispatch\/([^/]+)\/([^/]+)$/;

const HOSTED_ROUTE_TABLE: readonly RouteSpec[] = [
  {
    routeId: "browser_entry",
    match: (pathname) => pathname === "/",
    methods: ["GET", "HEAD"],
    authPolicy: "public_browser_entry",
    requiredAccess: "none",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: true,
    noStore: false,
  },
  {
    routeId: "oauth_start",
    match: (pathname) => pathname === "/oauth2/start",
    methods: ["GET", "HEAD"],
    authPolicy: "public_oauth_start",
    requiredAccess: "none",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: true,
    noStore: false,
  },
  {
    routeId: "oauth_callback",
    match: (pathname) => pathname === "/oauth2/callback",
    methods: ["GET", "HEAD"],
    authPolicy: "public_oauth_callback",
    requiredAccess: "none",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: true,
  },
  {
    routeId: "auth_logout",
    match: (pathname) => pathname === "/api/auth/logout",
    methods: ["POST"],
    authPolicy: "google_session_only",
    requiredAccess: "own_session",
    publicRoutable: true,
    requiresCsrfForBrowser: true,
    allowInteractiveRedirect: false,
    noStore: true,
  },
  {
    routeId: "auth_session",
    match: (pathname) => pathname === "/api/auth/session",
    methods: ["GET", "HEAD"],
    authPolicy: "google_session_only",
    requiredAccess: "own_session",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: true,
  },
  {
    routeId: "api_status",
    match: (pathname) => pathname === "/api/status",
    methods: ["GET", "HEAD"],
    authPolicy: "google_or_api_key",
    requiredAccess: "read",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "api_dispatch",
    match: (pathname) => pathname === "/api/dispatch",
    methods: ["POST"],
    authPolicy: "google_or_api_key",
    requiredAccess: "operate",
    publicRoutable: true,
    requiresCsrfForBrowser: true,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "api_dispatch_queue",
    match: (pathname) => pathname === "/api/dispatch/queue",
    methods: ["GET", "HEAD"],
    authPolicy: "google_or_api_key",
    requiredAccess: "read",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "api_dispatch_phase",
    match: (pathname) => {
      const match = DISPATCH_PHASE_PATH.exec(pathname);
      if (!match) return false;
      const [, feature, phase] = match;
      return (
        feature !== "." && feature !== ".." && phase !== "." && phase !== ".."
      );
    },
    methods: ["GET", "HEAD"],
    authPolicy: "google_or_api_key",
    requiredAccess: "read",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "api_notify",
    match: (pathname) => pathname === "/api/notify",
    methods: ["POST"],
    authPolicy: "google_or_api_key",
    requiredAccess: "operate",
    publicRoutable: true,
    requiresCsrfForBrowser: true,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "api_health",
    match: (pathname) => pathname === "/api/health",
    methods: ["GET", "HEAD"],
    authPolicy: "google_or_api_key",
    requiredAccess: "read",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "private_health",
    match: (pathname) => pathname === "/health",
    methods: ["GET", "HEAD"],
    authPolicy: "private_liveness_only",
    requiredAccess: "none",
    publicRoutable: false,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
  {
    routeId: "webhook_github",
    match: (pathname) => pathname === "/webhook/github",
    methods: ["POST"],
    authPolicy: "provider_webhook",
    requiredAccess: "enrolled_repository",
    publicRoutable: true,
    requiresCsrfForBrowser: false,
    allowInteractiveRedirect: false,
    noStore: false,
  },
];

export function classifyHostedRoute(input: {
  readonly method: string;
  readonly path: string;
}): HostedRouteClassification {
  const method = input.method.trim().toUpperCase();
  const pathname = input.path.split(/[?#]/, 1)[0] ?? "";

  if (pathname === "/oauth2/sign_out") {
    return {
      allowed: false,
      statusCode: 404,
      code: "ROUTE_NOT_PUBLIC",
      message: "Proxy sign-out is internal only and not publicly routable",
    };
  }

  const spec = HOSTED_ROUTE_TABLE.find((entry) => entry.match(pathname));
  if (!spec) {
    return {
      allowed: false,
      statusCode: 404,
      code: "ROUTE_NOT_FOUND",
      message: "Route is not declared in hosted policy",
    };
  }

  if (!spec.methods.includes(method)) {
    return {
      allowed: false,
      statusCode: 405,
      code: "METHOD_NOT_ALLOWED",
      message: "HTTP method is not allowed for this route",
    };
  }

  return {
    allowed: true,
    routeId: spec.routeId,
    authPolicy: spec.authPolicy,
    requiredAccess: spec.requiredAccess,
    publicRoutable: spec.publicRoutable,
    requiresCsrfForBrowser: spec.requiresCsrfForBrowser,
    allowInteractiveRedirect: spec.allowInteractiveRedirect,
    noStore: spec.noStore,
    corsAllowed: false,
  };
}

const FORBIDDEN_IDENTITY_HEADER_SET = new Set<string>(
  FORBIDDEN_PUBLIC_IDENTITY_HEADERS,
);

export function isForbiddenPublicIdentityHeader(headerName: string): boolean {
  const normalized = headerName.trim().toLowerCase();
  return (
    FORBIDDEN_IDENTITY_HEADER_SET.has(normalized) ||
    normalized.startsWith(FORBIDDEN_PUBLIC_IDENTITY_HEADER_PREFIX)
  );
}

function hasBrowserSessionCookie(
  cookieHeader: string | undefined,
  sessionCookieName: string,
): boolean {
  if (!cookieHeader) return false;
  for (const part of cookieHeader.split(";")) {
    const eqIndex = part.indexOf("=");
    if (eqIndex <= 0) continue;
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (
      value.length > 0 &&
      (name === sessionCookieName || name.startsWith(`${sessionCookieName}_`))
    ) {
      return true;
    }
  }
  return false;
}

export interface SelectRequestCredentialMechanismInput {
  readonly routeAuthPolicy: HostedRouteAuthPolicy;
  readonly authorizationHeader?: string;
  readonly forwardedGoogleIdToken?: string;
  readonly cookieHeader?: string;
  readonly sessionCookieName?: string;
}

export type SelectRequestCredentialMechanismResult =
  | {
      readonly ok: true;
      readonly mechanism: "none" | "webhook" | "api_key" | "google_id_token";
    }
  | {
      readonly ok: false;
      readonly statusCode: 401;
      readonly code: "AUTH_REQUIRED" | "AUTH_CONFLICTING_CREDENTIALS";
      readonly message: string;
    };

export function selectRequestCredentialMechanism(
  input: SelectRequestCredentialMechanismInput,
): SelectRequestCredentialMechanismResult {
  if (input.routeAuthPolicy === "provider_webhook") {
    return { ok: true, mechanism: "webhook" };
  }
  if (
    input.routeAuthPolicy === "public_browser_entry" ||
    input.routeAuthPolicy === "public_oauth_start" ||
    input.routeAuthPolicy === "public_oauth_callback" ||
    input.routeAuthPolicy === "private_liveness_only"
  ) {
    return { ok: true, mechanism: "none" };
  }

  const hasAuthorization =
    typeof input.authorizationHeader === "string" &&
    input.authorizationHeader.trim().length > 0;
  const hasForwardedGoogleToken =
    typeof input.forwardedGoogleIdToken === "string" &&
    input.forwardedGoogleIdToken.trim().length > 0;
  const hasSessionCookie = hasBrowserSessionCookie(
    input.cookieHeader,
    input.sessionCookieName ?? "_oauth2_proxy",
  );

  if (input.routeAuthPolicy === "google_session_only") {
    if (hasAuthorization) {
      return {
        ok: false,
        statusCode: 401,
        code: "AUTH_CONFLICTING_CREDENTIALS",
        message: "API credentials are not permitted on browser-only routes",
      };
    }
    if (hasForwardedGoogleToken) {
      return { ok: true, mechanism: "google_id_token" };
    }
    return {
      ok: false,
      statusCode: 401,
      code: "AUTH_REQUIRED",
      message: "Verified Google session is required",
    };
  }

  if (hasAuthorization) {
    if (hasSessionCookie || hasForwardedGoogleToken) {
      return {
        ok: false,
        statusCode: 401,
        code: "AUTH_CONFLICTING_CREDENTIALS",
        message: "Conflicting API key and browser session credentials supplied",
      };
    }
    return { ok: true, mechanism: "api_key" };
  }

  if (hasForwardedGoogleToken) {
    return { ok: true, mechanism: "google_id_token" };
  }

  return {
    ok: false,
    statusCode: 401,
    code: "AUTH_REQUIRED",
    message: "Authentication credentials are required",
  };
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface EvaluateBrowserMutationPolicyInput {
  readonly method: string;
  readonly authMethod: AuthMethod;
  readonly expectedOrigin: string;
  readonly originHeader?: string;
  readonly csrfHeaderToken?: string;
  readonly queryCsrfToken?: string;
}

export function evaluateBrowserMutationPolicy(
  input: EvaluateBrowserMutationPolicyInput,
):
  | { readonly ok: true; readonly requiresCsrfVerification: boolean }
  | {
      readonly ok: false;
      readonly statusCode: 403;
      readonly code: "AUTH_ORIGIN_MISMATCH" | "AUTH_CSRF_INVALID";
      readonly message: string;
    } {
  const method = input.method.trim().toUpperCase();
  if (!MUTATION_METHODS.has(method) || input.authMethod !== "google_id_token") {
    return { ok: true, requiresCsrfVerification: false };
  }

  if (
    typeof input.originHeader !== "string" ||
    input.originHeader.length === 0 ||
    input.originHeader !== input.expectedOrigin
  ) {
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_ORIGIN_MISMATCH",
      message: "Browser mutation Origin header does not match server origin",
    };
  }

  if (
    typeof input.queryCsrfToken === "string" &&
    input.queryCsrfToken.trim().length > 0
  ) {
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_CSRF_INVALID",
      message: "CSRF token must be supplied in the dedicated header only",
    };
  }

  if (
    typeof input.csrfHeaderToken !== "string" ||
    input.csrfHeaderToken.trim().length === 0
  ) {
    return {
      ok: false,
      statusCode: 403,
      code: "AUTH_CSRF_INVALID",
      message: "Missing browser CSRF token header",
    };
  }

  return { ok: true, requiresCsrfVerification: true };
}

export interface EvaluateOutboundCredentialTargetInput {
  readonly targetUrl: string;
  readonly boundOrigin: string;
}

export function evaluateOutboundCredentialTarget(
  input: EvaluateOutboundCredentialTargetInput,
):
  | {
      readonly ok: true;
      readonly targetOrigin: string;
      readonly attachCredential: true;
    }
  | {
      readonly ok: false;
      readonly code: "ORIGIN_MISMATCH" | "HTTPS_REQUIRED" | "PROFILE_INVALID";
      readonly message: string;
    } {
  let boundParsed: URL;
  try {
    boundParsed = new URL(input.boundOrigin);
  } catch {
    return {
      ok: false,
      code: "PROFILE_INVALID",
      message: "Bound credential origin is not a valid URL",
    };
  }
  if (
    boundParsed.protocol !== "https:" ||
    boundParsed.username !== "" ||
    boundParsed.password !== "" ||
    boundParsed.origin !== input.boundOrigin
  ) {
    return {
      ok: false,
      code: "PROFILE_INVALID",
      message:
        "Bound credential origin must be an HTTPS origin without userinfo",
    };
  }

  let targetParsed: URL;
  try {
    targetParsed = new URL(input.targetUrl);
  } catch {
    return {
      ok: false,
      code: "PROFILE_INVALID",
      message: "Target URL is not valid",
    };
  }

  if (targetParsed.protocol !== "https:") {
    return {
      ok: false,
      code: "HTTPS_REQUIRED",
      message: "Remote hosted API credentials require HTTPS",
    };
  }

  if (
    targetParsed.username !== "" ||
    targetParsed.password !== "" ||
    targetParsed.origin !== boundParsed.origin
  ) {
    return {
      ok: false,
      code: "ORIGIN_MISMATCH",
      message: "Target URL origin does not match bound credential origin",
    };
  }

  return {
    ok: true,
    targetOrigin: targetParsed.origin,
    attachCredential: true,
  };
}

const REDACTED = "[REDACTED]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-gwrk-csrf-token",
  "x-csrf-token",
  "x-forwarded-access-token",
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  "code",
  "state",
  "nonce",
  "id_token",
  "access_token",
  "refresh_token",
  "token",
  "csrf",
  "csrf_token",
  "_csrf",
  "api_key",
  "secret",
]);

export function redactAuthText(text: string): string {
  return text
    .replace(/\bgwrk_v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(Bearer)\s+[^\s,;]+/gi, `$1 ${REDACTED}`)
    .replace(
      /(\b(?:_oauth2_proxy(?:_\d+)?|__Host-gwrk_csrf)\s*=\s*)[^;\s]+/gi,
      `$1${REDACTED}`,
    )
    .replace(
      /([?&](?:code|state|nonce|id_token|access_token|refresh_token|csrf_token|_csrf)=)[^&#\s]+/gi,
      `$1${REDACTED}`,
    );
}

export function redactAuthHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Record<string, string | string[] | undefined> {
  const result: Record<string, string | string[] | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.trim().toLowerCase();
    if (
      SENSITIVE_HEADER_NAMES.has(lower) ||
      isForbiddenPublicIdentityHeader(lower)
    ) {
      result[key] = REDACTED;
      continue;
    }
    if (typeof value === "string") {
      result[key] = redactAuthText(value);
    } else if (Array.isArray(value)) {
      result[key] = value.map((entry) => redactAuthText(entry));
    } else {
      result[key] = undefined;
    }
  }
  return result;
}

export function redactAuthUrl(rawUrl: string): string {
  const hashIndex = rawUrl.indexOf("#");
  const withoutFragment =
    hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : rawUrl.slice(hashIndex + 1);

  const queryIndex = withoutFragment.indexOf("?");
  const rawPath =
    queryIndex === -1 ? withoutFragment : withoutFragment.slice(0, queryIndex);
  const rawQuery =
    queryIndex === -1 ? "" : withoutFragment.slice(queryIndex + 1);

  // Redact userinfo in absolute URLs such as https://user:pass@host/path.
  const sanitizedPath = redactAuthText(
    rawPath.replace(/^(https?:\/\/)([^/@\s]+)@/i, `$1${REDACTED}@`),
  );

  if (queryIndex === -1) {
    return hashIndex === -1
      ? sanitizedPath
      : `${sanitizedPath}#${redactAuthText(fragment)}`;
  }

  const sanitizedParams = rawQuery
    .split("&")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      const eqIndex = segment.indexOf("=");
      if (eqIndex === -1) {
        const lowerKey = segment.trim().toLowerCase();
        return SENSITIVE_QUERY_PARAMS.has(lowerKey)
          ? `${segment}=${REDACTED}`
          : redactAuthText(segment);
      }
      const key = segment.slice(0, eqIndex);
      const val = segment.slice(eqIndex + 1);
      if (SENSITIVE_QUERY_PARAMS.has(key.trim().toLowerCase())) {
        return `${key}=${REDACTED}`;
      }
      return `${key}=${redactAuthText(val)}`;
    })
    .join("&");

  const withQuery = `${sanitizedPath}?${sanitizedParams}`;
  return hashIndex === -1
    ? withQuery
    : `${withQuery}#${redactAuthText(fragment)}`;
}
