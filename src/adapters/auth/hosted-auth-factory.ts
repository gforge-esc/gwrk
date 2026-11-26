/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createRequestAuthenticator } from "../../application/auth/authenticate-request.js";
import { createBrowserSessionService } from "../../application/auth/browser-session.js";
import {
  HostedAuthConfigInputSchema,
  type HostedAuthConfigResolution,
  resolveHostedAuthConfig,
} from "../../domain/hosted-auth-config.js";
import type { AuthStorePort, BrowserCsrfPort } from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";
import { createBrowserCsrfAdapter } from "./browser-csrf.js";
import { createCredentialCryptoAdapter } from "./credential-crypto.js";
import {
  type GoogleIdentityVerifierOptions,
  createGoogleIdentityVerifier,
} from "./google-id-token.js";
import {
  createProtectedHostedAuthFiles,
  resolveTrustedGwrkGroupId,
} from "./protected-hosted-auth-files.js";
import {
  type ProxySessionLogoutOptions,
  createProxySessionLogout,
} from "./proxy-logout.js";

/** Programmatic test seams only. Configuration never supplies transports or file adapters. */
export interface HostedAuthFactoryEffects {
  readonly resolveGroupId?: typeof resolveTrustedGwrkGroupId;
  readonly createFiles?: typeof createProtectedHostedAuthFiles;
  readonly jwksFetch?: GoogleIdentityVerifierOptions["fetch"];
  readonly logoutFetch?: ProxySessionLogoutOptions["fetch"];
}
export interface HostedAuthFactoryDependencies {
  readonly store: AuthStorePort;
  readonly clock: ClockPort;
  readonly effects?: HostedAuthFactoryEffects;
}
export interface HostedAuthInitializationInput {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly auth?: unknown;
  readonly secretsRoot?: string;
}
export interface HostedAuthBundle {
  readonly authenticate: ReturnType<typeof createRequestAuthenticator>;
  readonly sessions: ReturnType<typeof createBrowserSessionService>;
  readonly csrf: BrowserCsrfPort;
  readonly expectedOrigin: string;
}
type EffectField =
  | "serviceGroup"
  | "googleAllowlistFile"
  | "csrfHmacKeyFile"
  | "secretsRoot"
  | "server.auth";
export type HostedAuthInitializationResult =
  | { readonly ok: true; readonly mode: "trusted_local" }
  | {
      readonly ok: true;
      readonly mode: "hosted";
      readonly hostedAuth: HostedAuthBundle;
    }
  | Extract<HostedAuthConfigResolution, { ok: false }>
  | {
      readonly ok: false;
      readonly error: {
        readonly code: "AUTH_DEPENDENCY_UNAVAILABLE";
        readonly field: EffectField;
        readonly message: string;
      };
    };

function unavailable(field: EffectField): HostedAuthInitializationResult {
  return {
    ok: false,
    error: {
      code: "AUTH_DEPENDENCY_UNAVAILABLE",
      field,
      message: "Hosted authentication initialization failed",
    },
  };
}

/** Capture dependencies without effects. Only initialize performs explicit startup work. */
export function createHostedAuthFactory(
  dependencies: HostedAuthFactoryDependencies,
): {
  initialize(
    input?: HostedAuthInitializationInput,
  ): Promise<HostedAuthInitializationResult>;
} {
  const { store, clock } = dependencies;
  const effects = Object.freeze({ ...dependencies.effects });
  return {
    async initialize(input = {}) {
      // Keep the two configuration sources separate until conflict validation completes.
      const resolved = resolveHostedAuthConfig({
        environment: input.environment,
        auth: input.auth,
      });
      if (!resolved.ok) return resolved;
      if (resolved.value.mode === "trusted_local")
        return { ok: true, mode: "trusted_local" };
      const secretsRoot = input.secretsRoot;
      if (
        typeof secretsRoot !== "string" ||
        !HostedAuthConfigInputSchema.shape.googleAllowlistFile.safeParse(
          secretsRoot,
        ).success
      )
        return unavailable("secretsRoot");
      const config = resolved.value;
      let field: EffectField = "serviceGroup";
      try {
        const trustedGroupId = await (
          effects.resolveGroupId ?? resolveTrustedGwrkGroupId
        )();
        field = "server.auth";
        const files = (effects.createFiles ?? createProtectedHostedAuthFiles)({
          secretsRoot,
          googleAllowlistFile: config.googleAllowlistFile,
          csrfHmacKeyFile: config.csrfHmacKeyFile,
          trustedGroupId,
        });
        field = "googleAllowlistFile";
        await files.readAllowlist();
        field = "csrfHmacKeyFile";
        const hmacKey = await files.readCsrfHmacKey();
        field = "server.auth";
        const crypto = createCredentialCryptoAdapter();
        const google = createGoogleIdentityVerifier({
          clientId: config.googleClientId,
          readAllowlist: files.readAllowlist,
          fetch: effects.jwksFetch,
        });
        const proxy = createProxySessionLogout({
          fetch: effects.logoutFetch,
          clock,
        });
        const sessions = createBrowserSessionService({ store, proxy, clock });
        const csrf = createBrowserCsrfAdapter({ hmacKey, clock });
        const authenticate = createRequestAuthenticator({
          store,
          crypto,
          google,
          clock,
          expectedOrigin: config.publicOrigin,
          sessionCookieName: "__Host-gwrk_session",
        });
        return {
          ok: true,
          mode: "hosted",
          hostedAuth: Object.freeze({
            authenticate,
            sessions,
            csrf,
            expectedOrigin: config.publicOrigin,
          }),
        };
      } catch {
        // Caller owns the ledger and rate limiter. Initialization never closes either.
        return unavailable(field);
      }
    },
  };
}
