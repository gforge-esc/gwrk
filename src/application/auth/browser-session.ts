/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { evaluateGoogleSessionLifecycle } from "../../domain/auth-policy.js";
import type {
  AuthStorePort,
  ProxySessionLogoutPort,
  VerifiedAuthContext,
} from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";
import {
  type AuthenticationDenial,
  denyAuthentication,
} from "./authenticate-request.js";

export interface BrowserSessionDependencies {
  readonly store: AuthStorePort;
  readonly proxy: ProxySessionLogoutPort;
  readonly clock: ClockPort;
}
export type BrowserSessionReadResult =
  | { readonly ok: true; readonly context: VerifiedAuthContext }
  | AuthenticationDenial;
export type BrowserSessionLogoutResult =
  | {
      readonly ok: true;
      readonly proxyCleared: boolean;
      readonly setCookieHeaders: readonly string[];
    }
  | AuthenticationDenial;

export function createBrowserSessionService(deps: BrowserSessionDependencies) {
  const readSession = (
    context: VerifiedAuthContext,
  ): BrowserSessionReadResult => {
    try {
      if (
        context.principalType !== "google_sub" ||
        context.authMethod !== "google_id_token" ||
        !context.sessionDigest ||
        context.credentialId !== context.sessionDigest
      )
        return denyAuthentication("AUTH_REQUIRED");
      const session = deps.store.getGoogleSession(context.sessionDigest);
      if (
        !session ||
        session.principalId !== context.principalId ||
        session.tokenDigestSha256 !== context.sessionDigest
      )
        return denyAuthentication("AUTH_REQUIRED");
      const lifecycle = evaluateGoogleSessionLifecycle({
        nowMs: deps.clock.nowMs(),
        tokenExpiresAtMs: Date.parse(session.expiresAt),
        sessionCapAtMs: Math.min(
          Date.parse(session.sessionCapAt),
          Date.parse(context.expiresAt),
        ),
        revokedAtMs:
          session.revokedAt === null ? null : Date.parse(session.revokedAt),
      });
      if (!lifecycle.ok) return denyAuthentication(lifecycle.code);
      return {
        ok: true,
        context: {
          ...context,
          expiresAt: new Date(
            Math.min(
              Date.parse(session.expiresAt),
              Date.parse(session.sessionCapAt),
              Date.parse(context.expiresAt),
            ),
          ).toISOString(),
        },
      };
    } catch {
      return denyAuthentication("AUTH_DEPENDENCY_UNAVAILABLE");
    }
  };
  const logout = async (
    context: VerifiedAuthContext,
    input: { readonly cookieHeader?: string } = {},
  ): Promise<BrowserSessionLogoutResult> => {
    const current = readSession(context);
    if (!current.ok) return current;
    const digest = current.context.sessionDigest;
    if (!digest) return denyAuthentication("AUTH_REQUIRED");
    try {
      // This synchronous port operation must commit before the first proxy await.
      if (
        !deps.store.revokeGoogleSession({
          tokenDigestSha256: digest,
          revokedAt: deps.clock.nowIso(),
          reason: "logout",
        })
      )
        return denyAuthentication("AUTH_DEPENDENCY_UNAVAILABLE");
    } catch {
      return denyAuthentication("AUTH_DEPENDENCY_UNAVAILABLE");
    }
    try {
      const result = await deps.proxy.clearProxySession({
        cookieHeader: input.cookieHeader,
      });
      if (result.ok)
        return {
          ok: true,
          proxyCleared: true,
          setCookieHeaders: result.setCookieHeaders,
        };
    } catch {
      // Origin revocation remains authoritative during proxy failure.
    }
    return { ok: true, proxyCleared: false, setCookieHeaders: [] };
  };
  return { readSession, logout };
}
