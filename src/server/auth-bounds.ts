/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { isIP } from "node:net";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  type RateAdmissionAdapter,
  createRateAdmission,
} from "../adapters/auth/rate-admission.js";
import {
  type HostedSecurityPolicy,
  classifyHostedRoute,
} from "../domain/auth-policy.js";
import type { ClockPort } from "../ports/operations-port.js";
import type {
  Decision,
  RateAdmissionPort,
  Reservation,
  Reserved,
} from "../ports/rate-admission-port.js";
import { readVerifiedAuthContext } from "./auth-guard.js";

export interface HostedAuthBoundsOptions {
  readonly rateAdmission?: RateAdmissionPort;
  readonly policy?: HostedSecurityPolicy;
  readonly clock?: Pick<ClockPort, "nowMs">;
}

interface RequestRateState {
  readonly reservation: Reservation;
  settled: boolean;
  aborted: boolean;
}

const requestRateStates = new WeakMap<FastifyRequest, RequestRateState>();

function isTrustedLoopback(ip: string | undefined): boolean {
  if (!ip) return false;
  const normalized = ip.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

function normalizeIp(value: string): string {
  if (typeof value !== "string" || value.length > 45 || !isIP(value)) {
    throw new Error("Invalid rate subject");
  }
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

function extractTrustedClientIp(
  request: FastifyRequest,
):
  | { ok: true; ip: string }
  | { ok: false; code: "TRUSTED_FORWARDING_INVALID" } {
  const peerIp =
    request.raw.socket?.remoteAddress ?? request.socket?.remoteAddress;

  if (!isTrustedLoopback(peerIp)) {
    if (!peerIp) return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
    try {
      return { ok: true, ip: normalizeIp(peerIp) };
    } catch {
      return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
    }
  }

  // Trusted loopback peer: enforce strict single forwarding header
  let xffCount = 0;
  for (let i = 0; i < request.raw.rawHeaders.length; i += 2) {
    if (request.raw.rawHeaders[i].toLowerCase() === "x-forwarded-for") {
      xffCount++;
    }
  }
  if (xffCount > 1) {
    return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
  }

  const rawXff = request.headers["x-forwarded-for"];
  if (Array.isArray(rawXff)) {
    return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
  }
  if (rawXff === undefined || rawXff.trim() === "") {
    return { ok: true, ip: "127.0.0.1" };
  }
  if (rawXff.includes(",")) {
    return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
  }

  const trimmed = rawXff.trim();
  if (!isIP(trimmed)) {
    return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
  }
  try {
    return { ok: true, ip: normalizeIp(trimmed) };
  } catch {
    return { ok: false, code: "TRUSTED_FORWARDING_INVALID" };
  }
}

function denyRate(
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

function cleanRootHeaders(reply: FastifyReply) {
  reply.removeHeader("location");
  reply.removeHeader("set-cookie");
  reply.removeHeader("x-forwarded-for");
  reply.removeHeader("x-forwarded-uri");
  reply.removeHeader("x-forwarded-method");
}

export function registerHostedAuthBounds(
  server: FastifyInstance,
  options?: HostedAuthBoundsOptions,
): RateAdmissionPort {
  const admission: RateAdmissionPort =
    options?.rateAdmission ??
    createRateAdmission({
      policy: options?.policy,
      clock: options?.clock ?? { nowMs: () => Date.now() },
    });

  server.addHook("onClose", async () => {
    admission.close();
  });

  server.addHook("onSend", async (request, reply, payload) => {
    const pathname = (request.raw.url ?? request.url).split(/[?#]/, 1)[0] ?? "";
    if (pathname === "/") {
      cleanRootHeaders(reply);
    }
    return payload;
  });

  server.addHook("onRequest", async (request, reply) => {
    const pathname = (request.raw.url ?? request.url).split(/[?#]/, 1)[0] ?? "";
    const route = classifyHostedRoute({
      method: request.method,
      path: request.raw.url ?? request.url,
    });

    if (
      route.allowed &&
      (route.routeId === "private_health" ||
        route.routeId === "webhook_github" ||
        route.routeId === "oauth_start" ||
        route.routeId === "oauth_callback")
    ) {
      return;
    }

    const clientIp = extractTrustedClientIp(request);
    if (!clientIp.ok) {
      return denyRate(request, reply, 503, clientIp.code);
    }

    if (route.allowed && route.routeId === "browser_entry") {
      let decision: Decision;
      try {
        decision = admission.consumeLogin({ trustedIp: clientIp.ip });
      } catch {
        cleanRootHeaders(reply);
        return denyRate(request, reply, 503, "RATE_STORE_UNAVAILABLE");
      }
      if (!decision.allowed) {
        cleanRootHeaders(reply);
        const status =
          decision.reason === "closed" || decision.reason === "store_error"
            ? 503
            : 429;
        return denyRate(request, reply, status, "RATE_LIMIT_EXCEEDED");
      }
      return;
    }

    // Protected API routes: reserve capacity synchronously before verification
    if (route.allowed) {
      let reserved: Reserved;
      try {
        reserved = admission.reserveApi({ trustedIp: clientIp.ip });
      } catch {
        return denyRate(request, reply, 503, "RATE_STORE_UNAVAILABLE");
      }

      if (!reserved.allowed) {
        const status =
          reserved.reason === "closed" || reserved.reason === "store_error"
            ? 503
            : 429;
        return denyRate(request, reply, status, "RATE_LIMIT_EXCEEDED");
      }

      const state: RequestRateState = {
        reservation: reserved.reservation,
        settled: false,
        aborted: false,
      };
      requestRateStates.set(request, state);

      const onSocketClose = () => {
        if (!state.settled) {
          state.aborted = true;
          state.settled = true;
          try {
            admission.completeUnverified({ reservation: state.reservation });
          } catch {
            // ignore
          }
        }
      };
      request.raw.once("close", onSocketClose);
      request.raw.socket?.once("close", onSocketClose);
    }
  });

  server.addHook("preHandler", async (request, reply) => {
    const state = requestRateStates.get(request);
    if (!state) return;

    if (
      state.aborted ||
      request.raw.destroyed ||
      request.raw.socket?.destroyed
    ) {
      return reply.code(408).send({
        ok: false,
        code: "REQUEST_ABORTED",
        error: "Request aborted",
        requestId: request.id,
      });
    }

    const authContext = readVerifiedAuthContext(request);
    if (!authContext) {
      if (!state.settled) {
        state.settled = true;
        try {
          admission.completeUnverified({ reservation: state.reservation });
        } catch {
          // ignore
        }
      }
      return;
    }

    if (!state.settled) {
      state.settled = true;
      let decision: Decision;
      try {
        decision = admission.completeVerified({
          reservation: state.reservation,
          credential: {
            authMethod: authContext.authMethod,
            credentialId: authContext.credentialId,
          },
        });
      } catch {
        return denyRate(request, reply, 503, "RATE_STORE_UNAVAILABLE");
      }

      if (!decision.allowed) {
        const status =
          decision.reason === "closed" || decision.reason === "store_error"
            ? 503
            : 429;
        return denyRate(request, reply, status, "RATE_LIMIT_EXCEEDED");
      }
    }
  });

  server.addHook("onResponse", async (request) => {
    const state = requestRateStates.get(request);
    if (!state) return;
    requestRateStates.delete(request);
    if (!state.settled) {
      state.settled = true;
      try {
        admission.completeUnverified({ reservation: state.reservation });
      } catch {
        // ignore
      }
    }
  });

  return admission;
}
