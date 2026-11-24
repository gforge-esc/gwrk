/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { createRequestAuthenticator } from "../application/auth/authenticate-request.js";
import {
  classifyHostedRoute,
  evaluateBrowserMutationPolicy,
} from "../domain/auth-policy.js";
import type {
  BrowserCsrfPort,
  VerifiedAuthContext,
} from "../ports/auth-port.js";

export interface HostedAuthGuardOptions {
  readonly authenticate?: ReturnType<typeof createRequestAuthenticator>;
  readonly csrf?: BrowserCsrfPort;
  readonly expectedOrigin?: string;
}

declare module "fastify" {
  interface FastifyRequest {
    gwrkVerifiedAuth: VerifiedAuthContext | null;
  }
}

// The decoration is readable by routes. Only this adapter can establish provenance.
const verifiedContexts = new WeakMap<FastifyRequest, VerifiedAuthContext>();

export function readVerifiedAuthContext(
  request: FastifyRequest,
): VerifiedAuthContext | undefined {
  return verifiedContexts.get(request);
}

export function resolveVerifiedPrincipal(request: FastifyRequest):
  | {
      principalType: "cli_token" | "google_sub";
      principalId: string;
    }
  | undefined {
  const context = readVerifiedAuthContext(request);
  if (!context) return undefined;
  return {
    principalType: context.principalType,
    principalId: context.principalId,
  };
}

function deny(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
) {
  return reply.code(status).send({
    ok: false,
    code,
    error: "Request denied",
    requestId: request.id,
  });
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === "string" ? value : undefined;
}

function hasAmbiguousHeaders(request: FastifyRequest): boolean {
  const sensitive = new Set([
    "authorization",
    "x-gwrk-auth-mode",
    "origin",
    "x-gwrk-csrf-token",
  ]);
  const seen = new Set<string>();
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const name = request.raw.rawHeaders[index].toLowerCase();
    if (!sensitive.has(name)) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return [...sensitive].some((name) => Array.isArray(request.headers[name]));
}

function csrfCookie(cookieHeader: string | undefined): string | undefined {
  const matches = (cookieHeader ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "__Host-gwrk_csrf")
      return [];
    return [part.slice(separator + 1).trim()];
  });
  return matches.length === 1 ? matches[0] : undefined;
}

function hasQueryCsrf(rawUrl: string): boolean {
  const query = new URLSearchParams(rawUrl.split("?", 2)[1] ?? "");
  const names = new Set([
    "csrf",
    "csrf_token",
    "csrftoken",
    "_csrf",
    "x-gwrk-csrf-token",
  ]);
  return [...query.keys()].some((key) => names.has(key.toLowerCase()));
}

export function registerHostedAuthGuard(
  server: FastifyInstance,
  options: HostedAuthGuardOptions,
): void {
  server.decorateRequest("gwrkVerifiedAuth", null);
  server.addHook("preHandler", async (request, reply) => {
    const route = classifyHostedRoute({
      method: request.method,
      path: request.raw.url ?? request.url,
    });
    if (!route.allowed)
      return deny(request, reply, route.statusCode, route.code);
    if (route.noStore) reply.header("cache-control", "no-store");
    if (
      route.authPolicy === "public_browser_entry" ||
      route.authPolicy === "public_oauth_start" ||
      route.authPolicy === "public_oauth_callback" ||
      route.authPolicy === "private_liveness_only" ||
      route.authPolicy === "provider_webhook"
    )
      return;

    if (hasAmbiguousHeaders(request))
      return deny(request, reply, 401, "AUTH_CONFLICTING_CREDENTIALS");
    const mode = header(request, "x-gwrk-auth-mode");
    if (mode !== undefined && mode !== "api_key" && mode !== "google_id_token")
      return deny(request, reply, 401, "AUTH_CREDENTIAL_INVALID");
    if (!options.authenticate)
      return deny(request, reply, 503, "AUTH_DEPENDENCY_UNAVAILABLE");

    try {
      const authorization = header(request, "authorization");
      let forwardedGoogleIdToken: string | undefined;
      if (mode === "google_id_token") {
        if (authorization !== undefined) {
          const bearer = /^Bearer ([^\s]+)$/i.exec(authorization);
          if (!bearer) return deny(request, reply, 401, "AUTH_TOKEN_INVALID");
          forwardedGoogleIdToken = bearer[1];
        }
      }
      const result = await options.authenticate({
        routeAuthPolicy: route.authPolicy,
        authorizationHeader:
          mode === "google_id_token" ? undefined : authorization,
        forwardedGoogleIdToken,
        cookieHeader: header(request, "cookie"),
        sessionCookieName: "__Host-gwrk_session",
      });
      if (!result.ok) {
        const unavailable =
          result.code === "AUTH_VERIFIER_UNAVAILABLE" ||
          result.code === "AUTH_DEPENDENCY_UNAVAILABLE";
        return deny(request, reply, unavailable ? 503 : 401, result.code);
      }
      if (!result.context) return deny(request, reply, 401, "AUTH_REQUIRED");
      const context = result.context;
      if (context.authMethod === "google_id_token") {
        const mutation = evaluateBrowserMutationPolicy({
          method: request.method,
          authMethod: context.authMethod,
          expectedOrigin: options.expectedOrigin ?? "",
          originHeader: header(request, "origin"),
          csrfHeaderToken: header(request, "x-gwrk-csrf-token"),
          queryCsrfToken: hasQueryCsrf(request.url) ? "present" : undefined,
        });
        if (!mutation.ok)
          return deny(request, reply, mutation.statusCode, mutation.code);
        if (mutation.requiresCsrfVerification) {
          if (
            !options.expectedOrigin ||
            !options.csrf ||
            !context.sessionDigest
          )
            return deny(request, reply, 403, "AUTH_CSRF_INVALID");
          const cookieValue = csrfCookie(header(request, "cookie"));
          if (
            !cookieValue ||
            !(await options.csrf.verifyToken({
              sessionDigest: context.sessionDigest,
              headerToken: header(request, "x-gwrk-csrf-token"),
              cookieValue,
            }))
          )
            return deny(request, reply, 403, "AUTH_CSRF_INVALID");
        }
      }
      const verified = Object.freeze({ ...context });
      Object.defineProperty(request, "gwrkVerifiedAuth", {
        value: verified,
        writable: false,
        configurable: false,
      });
      verifiedContexts.set(request, verified);
    } catch {
      return deny(request, reply, 503, "AUTH_DEPENDENCY_UNAVAILABLE");
    }
  });
}
