/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
  HostedSecurityPolicySchema,
  type SelectRequestCredentialMechanismInput,
  computeBrowserSessionCap,
  evaluateApiCredentialLifecycle,
  evaluateGoogleSessionLifecycle,
  parseOpaqueApiCredential,
  selectRequestCredentialMechanism,
} from "../../domain/auth-policy.js";
import type {
  AuthStorePort,
  CredentialCryptoPort,
  GoogleIdentityVerifierPort,
  VerifiedAuthContext,
} from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";

export type AuthenticationDenialCode =
  | "AUTH_REQUIRED"
  | "AUTH_CONFLICTING_CREDENTIALS"
  | "AUTH_CREDENTIAL_INVALID"
  | "AUTH_CREDENTIAL_REJECTED"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_ACCOUNT_DENIED"
  | "AUTH_VERIFIER_UNAVAILABLE"
  | "AUTH_SESSION_REVOKED"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_SESSION_METADATA_CONFLICT"
  | "AUTH_DEPENDENCY_UNAVAILABLE";

export type AuthenticationDenial = {
  readonly ok: false;
  readonly code: AuthenticationDenialCode;
  readonly message: string;
};
export type AuthenticationResult =
  | { readonly ok: true; readonly context: VerifiedAuthContext }
  | {
      readonly ok: true;
      readonly context: null;
      readonly mechanism: "none" | "webhook";
    }
  | AuthenticationDenial;

// Application messages never include upstream error text or credential material.
export function denyAuthentication(
  code: AuthenticationDenialCode,
): AuthenticationDenial {
  return { ok: false, code, message: "Authentication denied" };
}

export interface RequestAuthenticationDependencies {
  readonly store: AuthStorePort;
  readonly crypto: CredentialCryptoPort;
  readonly google: GoogleIdentityVerifierPort;
  readonly clock: ClockPort;
  readonly expectedOrigin: string;
  readonly policy?: HostedSecurityPolicy;
}

export function createRequestAuthenticator(
  deps: RequestAuthenticationDependencies,
) {
  const policy = HostedSecurityPolicySchema.parse(
    deps.policy ?? DEFAULT_HOSTED_SECURITY_POLICY,
  );
  return async (
    input: SelectRequestCredentialMechanismInput,
  ): Promise<AuthenticationResult> => {
    try {
      const selection = selectRequestCredentialMechanism(input);
      if (!selection.ok) return denyAuthentication(selection.code);
      if (selection.mechanism === "none" || selection.mechanism === "webhook")
        return { ok: true, context: null, mechanism: selection.mechanism };
      if (selection.mechanism === "api_key") {
        const bearer = /^Bearer ([^\s]+)$/i.exec(
          input.authorizationHeader ?? "",
        );
        if (!bearer) return denyAuthentication("AUTH_CREDENTIAL_INVALID");
        const parsed = parseOpaqueApiCredential(bearer[1], policy);
        if (!parsed.ok) return denyAuthentication(parsed.code);
        const record = deps.store.findApiCredentialById(parsed.credentialId);
        if (!record || record.credentialId !== parsed.credentialId)
          return denyAuthentication("AUTH_CREDENTIAL_REJECTED");
        const candidate = deps.crypto.hashCredential(bearer[1]);
        if (!deps.crypto.verifySha256Equal(record.verifierSha256, candidate))
          return denyAuthentication("AUTH_CREDENTIAL_REJECTED");
        const lifecycle = evaluateApiCredentialLifecycle({
          ...record,
          expectedOrigin: deps.expectedOrigin,
          nowMs: deps.clock.nowMs(),
        });
        if (!lifecycle.ok) return denyAuthentication(lifecycle.code);
        const { ok: _ok, ...context } = lifecycle;
        return { ok: true, context };
      }
      const verified = await deps.google.verifyIdToken({
        token: input.forwardedGoogleIdToken ?? "",
        nowMs: deps.clock.nowMs(),
      });
      if (!verified.ok) return denyAuthentication(verified.code);
      const claims = verified.claims;
      const nowMs = deps.clock.nowMs();
      const cap = computeBrowserSessionCap({
        observedAtMs: nowMs,
        tokenExpiresAtMs: claims.expiresAtMs,
        policy,
      });
      if (
        !evaluateGoogleSessionLifecycle({
          nowMs,
          tokenExpiresAtMs: claims.expiresAtMs,
          sessionCapAtMs: cap,
          revokedAtMs: null,
        }).ok
      )
        return denyAuthentication("AUTH_SESSION_EXPIRED");
      const observation = deps.store.observeGoogleSession({
        tokenDigestSha256: claims.tokenDigestSha256,
        principalId: claims.principalId,
        issuedAt: new Date(claims.issuedAtMs).toISOString(),
        expiresAt: new Date(claims.expiresAtMs).toISOString(),
        sessionCapAt: new Date(cap).toISOString(),
      });
      if (!observation.ok)
        return denyAuthentication(
          observation.code === "SESSION_REVOKED"
            ? "AUTH_SESSION_REVOKED"
            : "AUTH_SESSION_METADATA_CONFLICT",
        );
      const session = observation.session;
      // The atomic store observation owns the original cap and revocation marker.
      const lifecycle = evaluateGoogleSessionLifecycle({
        nowMs: deps.clock.nowMs(),
        tokenExpiresAtMs: Date.parse(session.expiresAt),
        sessionCapAtMs: Date.parse(session.sessionCapAt),
        revokedAtMs:
          session.revokedAt === null ? null : Date.parse(session.revokedAt),
      });
      if (!lifecycle.ok) return denyAuthentication(lifecycle.code);
      return {
        ok: true,
        context: {
          principalType: "google_sub",
          principalId: session.principalId,
          credentialId: session.tokenDigestSha256,
          sessionDigest: session.tokenDigestSha256,
          expiresAt: new Date(
            Math.min(
              Date.parse(session.expiresAt),
              Date.parse(session.sessionCapAt),
            ),
          ).toISOString(),
          authMethod: "google_id_token",
        },
      };
    } catch {
      return denyAuthentication("AUTH_DEPENDENCY_UNAVAILABLE");
    }
  };
}
