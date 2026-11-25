/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  ApiCredentialMetadata,
  AuthAuditEvent,
  AuthMethod,
  AuthPrincipalType,
  CanonicalGoogleIssuer,
  StoredApiCredential,
  StoredGoogleSession,
} from "../domain/auth-policy.js";
import type {
  ProjectRole,
  ProjectRoleBinding,
} from "../domain/project-registry.js";

export type {
  ApiCredentialMetadata,
  AuthAuditEvent,
  AuthMethod,
  AuthPrincipalType,
  CanonicalGoogleIssuer,
  StoredApiCredential,
  StoredGoogleSession,
} from "../domain/auth-policy.js";

export interface VerifiedAuthContext {
  readonly principalType: AuthPrincipalType;
  readonly principalId: string;
  readonly credentialId: string;
  readonly expiresAt: string;
  readonly authMethod: AuthMethod;
  readonly sessionDigest?: string;
}

export interface GoogleIdentityVerifierPort {
  verifyIdToken(input: {
    token: string;
    nowMs: number;
  }): Promise<
    | {
        ok: true;
        claims: {
          canonicalIssuer: CanonicalGoogleIssuer;
          subject: string;
          principalId: string;
          email: string;
          emailVerified: true;
          issuedAtMs: number;
          expiresAtMs: number;
          tokenDigestSha256: string;
        };
      }
    | {
        ok: false;
        code:
          | "AUTH_TOKEN_INVALID"
          | "AUTH_TOKEN_EXPIRED"
          | "AUTH_ACCOUNT_DENIED"
          | "AUTH_VERIFIER_UNAVAILABLE";
        message: string;
      }
  >;
}

export interface CredentialCryptoPort {
  generateApiCredential(credentialId: string): {
    rawCredential: string;
    verifierSha256: string;
  };
  hashCredential(rawCredential: string): string;
  hashTokenDigest(rawToken: string): string;
  verifySha256Equal(expectedHex: string, candidateHex: string): boolean;
}

export interface AuthStorePort {
  findApiCredentialById(credentialId: string): StoredApiCredential | null;
  listApiCredentials(): readonly ApiCredentialMetadata[];
  revokeApiCredential(input: {
    credentialId: string;
    revokedAt: string;
    reason: string;
  }): boolean;
  observeGoogleSession(input: {
    tokenDigestSha256: string;
    principalId: string;
    issuedAt: string;
    expiresAt: string;
    sessionCapAt: string;
  }):
    | { ok: true; session: StoredGoogleSession; created: boolean }
    | { ok: false; code: "SESSION_REVOKED" | "SESSION_METADATA_CONFLICT" };
  getGoogleSession(tokenDigestSha256: string): StoredGoogleSession | null;
  revokeGoogleSession(input: {
    tokenDigestSha256: string;
    revokedAt: string;
    reason: string;
  }): boolean;
  appendAuditEvent(event: AuthAuditEvent): void;
  close(): void;
}

export interface CredentialGrantAdminPort {
  createCredentialWithGrants(input: {
    credentialId: string;
    verifierSha256: string;
    label: string;
    issuer: string;
    audienceOrigin: string;
    createdAt: string;
    expiresAt: string;
    grants: readonly { projectId: string; role: ProjectRole }[];
  }): {
    credential: ApiCredentialMetadata;
    grants: readonly ProjectRoleBinding[];
  };
  rotateCredential(input: {
    targetCredentialId: string;
    newCredentialId: string;
    newVerifierSha256: string;
    issuer: string;
    audienceOrigin: string;
    createdAt: string;
    expiresAt: string;
    overlapUntil?: string;
    reason: string;
  }): {
    created: ApiCredentialMetadata;
    revokedCredentialId: string | null;
    overlapUntil: string | null;
    copiedGrants: readonly ProjectRoleBinding[];
  };
}

export interface BrowserCsrfPort {
  issueToken(input: { sessionDigest: string; expiresAt: string }): Promise<{
    token: string;
    cookieHeader: string;
  }>;
  verifyToken(input: {
    sessionDigest: string;
    headerToken: string | undefined;
    cookieValue: string | undefined;
  }): Promise<boolean>;
  clearCookieHeader(): string;
}

export interface ProxySessionLogoutPort {
  clearProxySession(input: {
    cookieHeader?: string;
  }): Promise<
    | { ok: true; setCookieHeaders: readonly string[] }
    | { ok: false; code: "PROXY_LOGOUT_FAILED"; message: string }
  >;
}

export interface HttpClientCredentialPort {
  resolveBearerForUrl(input: {
    targetUrl: string;
  }): Promise<
    | { ok: true; bearerToken: string | null; boundOrigin: string | null }
    | {
        ok: false;
        code: "ORIGIN_MISMATCH" | "HTTPS_REQUIRED" | "PROFILE_INVALID";
        message: string;
      }
  >;
}
