/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fastifyCookie } from "@fastify/cookie";
import { Tokens } from "@fastify/csrf";
import { z } from "zod";
import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
  HostedSecurityPolicySchema,
} from "../../domain/auth-policy.js";
import type { BrowserCsrfPort } from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";

const COOKIE_NAME = "__Host-gwrk_csrf";
const COOKIE_OPTIONS = {
  path: "/",
  secure: true,
  httpOnly: true,
  sameSite: "lax" as const,
};
const expiresAtSchema = z.string().datetime({ offset: true });

export interface BrowserCsrfOptions {
  readonly hmacKey: string | Buffer;
  readonly clock: Pick<ClockPort, "nowMs">;
  readonly policy?: HostedSecurityPolicy;
}

export function createBrowserCsrfAdapter(
  options: BrowserCsrfOptions,
): BrowserCsrfPort {
  if (
    !(
      typeof options.hmacKey === "string" || Buffer.isBuffer(options.hmacKey)
    ) ||
    Buffer.byteLength(options.hmacKey) === 0 ||
    typeof options.clock?.nowMs !== "function"
  ) {
    throw new Error("CSRF adapter requires a HMAC key and clock");
  }
  const policy = HostedSecurityPolicySchema.parse(
    options.policy ?? DEFAULT_HOSTED_SECURITY_POLICY,
  );
  const clock = options.clock;
  const tokens = new Tokens({
    userInfo: true,
    hmacKey: Buffer.from(options.hmacKey),
  });
  const bounded = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !/[\r\n]/.test(value) &&
    Buffer.byteLength(value) <= policy.httpHeaderMaxBytes;

  return {
    async issueToken({ sessionDigest, expiresAt }) {
      try {
        if (!bounded(sessionDigest)) throw new Error();
        const deadline = Date.parse(expiresAtSchema.parse(expiresAt));
        const validDeadline = () => {
          const now = clock.nowMs();
          return (
            Number.isFinite(now) && Number.isFinite(deadline) && deadline > now
          );
        };
        if (!validDeadline()) throw new Error();
        const secret = await tokens.secret();
        if (!validDeadline()) throw new Error();
        const token = tokens.create(secret, sessionDigest);
        const cookieHeader = fastifyCookie.serialize(COOKIE_NAME, secret, {
          ...COOKIE_OPTIONS,
          // Cookie dates have second precision. Rounding down preserves the cap.
          expires: new Date(Math.floor(deadline / 1000) * 1000),
        });
        return { token, cookieHeader };
      } catch {
        throw new Error("CSRF token issuance failed");
      }
    },
    async verifyToken({ sessionDigest, headerToken, cookieValue }) {
      if (
        !bounded(sessionDigest) ||
        !bounded(headerToken) ||
        !bounded(cookieValue)
      )
        return false;
      try {
        return tokens.verify(cookieValue, headerToken, sessionDigest);
      } catch {
        return false;
      }
    },
    clearCookieHeader() {
      return fastifyCookie.serialize(COOKIE_NAME, "", {
        ...COOKIE_OPTIONS,
        expires: new Date(0),
        maxAge: 0,
      });
    },
  };
}
