/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthenticationDenialCode } from "../../application/auth/authenticate-request.js";
import type { createBrowserSessionService } from "../../application/auth/browser-session.js";
import type { BrowserCsrfPort } from "../../ports/auth-port.js";
import { readVerifiedAuthContext } from "../auth-guard.js";

export interface AuthRoutesOptions {
  readonly sessions: ReturnType<typeof createBrowserSessionService>;
  readonly csrf: BrowserCsrfPort;
}

const LOGIN_ENTRY =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>gwrk</title></head><body><a href="/oauth2/start">Sign in with Google</a></body></html>';

function deny(
  request: FastifyRequest,
  reply: FastifyReply,
  code: AuthenticationDenialCode,
) {
  const status =
    code === "AUTH_ACCOUNT_DENIED"
      ? 403
      : code === "AUTH_DEPENDENCY_UNAVAILABLE" ||
          code === "AUTH_VERIFIER_UNAVAILABLE"
        ? 503
        : 401;
  return reply
    .code(status)
    .send({ ok: false, code, error: "Request denied", requestId: request.id });
}

function googleContext(request: FastifyRequest) {
  const context = readVerifiedAuthContext(request);
  return context?.principalType === "google_sub" &&
    context.authMethod === "google_id_token"
    ? context
    : undefined;
}

export function registerAuthRoutes(
  server: FastifyInstance,
  options: AuthRoutesOptions,
): void {
  server.get("/", async (_request, reply) =>
    reply.type("text/html; charset=utf-8").send(LOGIN_ENTRY),
  );

  server.get("/api/auth/session", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const context = googleContext(request);
    if (!context) return deny(request, reply, "AUTH_REQUIRED");
    try {
      const current = options.sessions.readSession(context);
      if (!current.ok) return deny(request, reply, current.code);
      const { expiresAt, sessionDigest } = current.context;
      if (!sessionDigest) return deny(request, reply, "AUTH_REQUIRED");
      if (request.method === "HEAD") return { ok: true, expiresAt };
      const issued = await options.csrf.issueToken({
        sessionDigest,
        expiresAt,
      });
      reply.header("set-cookie", issued.cookieHeader);
      return { ok: true, expiresAt, csrfToken: issued.token };
    } catch {
      return deny(request, reply, "AUTH_DEPENDENCY_UNAVAILABLE");
    }
  });

  server.post("/api/auth/logout", async (request, reply) => {
    reply.header("cache-control", "no-store");
    const context = googleContext(request);
    if (!context) return deny(request, reply, "AUTH_REQUIRED");
    try {
      const result = await options.sessions.logout(context, {
        cookieHeader:
          typeof request.headers.cookie === "string"
            ? request.headers.cookie
            : undefined,
      });
      if (!result.ok) return deny(request, reply, result.code);
      reply.header("set-cookie", [
        ...result.setCookieHeaders,
        options.csrf.clearCookieHeader(),
      ]);
      return { ok: true, proxyCleared: result.proxyCleared };
    } catch {
      return deny(request, reply, "AUTH_DEPENDENCY_UNAVAILABLE");
    }
  });
}
