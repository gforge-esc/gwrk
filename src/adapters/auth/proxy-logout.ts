/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
  HostedSecurityPolicySchema,
} from "../../domain/auth-policy.js";
import type { ProxySessionLogoutPort } from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";

export const PROXY_LOGOUT_URL = "http://127.0.0.1:4180/oauth2/sign_out";
const SESSION_NAME = /^__Host-gwrk_session(?:_\d+)?$/;
const COOKIE_DATE =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

type LogoutFetch = (
  url: string,
  options: {
    method: "GET";
    redirect: "manual";
    headers: { Cookie: string };
    signal: AbortSignal;
  },
) => Promise<Response>;

export interface ProxySessionLogoutOptions {
  readonly fetch?: LogoutFetch;
  readonly policy?: HostedSecurityPolicy;
  readonly clock?: Pick<ClockPort, "nowMs">;
}

function requestSessionNames(cookieHeader: string): Set<string> {
  const names = new Set<string>();
  for (const part of cookieHeader.split(";")) {
    const equals = part.indexOf("=");
    if (equals < 1) continue;
    const name = part.slice(0, equals).trim();
    if (SESSION_NAME.test(name)) names.add(name);
  }
  return names;
}

function clearingCookieName(header: string, nowMs: number): string | null {
  if (/[\r\n]/.test(header)) return null;
  const [pair, ...attributes] = header.split(";");
  const equals = pair.indexOf("=");
  const name = pair.slice(0, equals).trim();
  if (
    equals < 1 ||
    !SESSION_NAME.test(name) ||
    pair.slice(equals + 1).trim() !== ""
  )
    return null;
  const fields = new Map<string, string | null>();
  for (const raw of attributes) {
    const index = raw.indexOf("=");
    const field = (index < 0 ? raw : raw.slice(0, index)).trim().toLowerCase();
    if (!field || fields.has(field)) return null;
    fields.set(field, index < 0 ? null : raw.slice(index + 1).trim());
  }
  if (
    fields.has("domain") ||
    fields.get("path") !== "/" ||
    !fields.has("secure") ||
    fields.get("secure") !== null ||
    !fields.has("httponly") ||
    fields.get("httponly") !== null
  )
    return null;
  const maxAge = fields.get("max-age");
  const expires = fields.get("expires");
  if (maxAge === undefined && expires === undefined) return null;
  if (
    maxAge !== undefined &&
    (maxAge === null ||
      !/^-?\d+$/.test(maxAge) ||
      !Number.isFinite(Number(maxAge)) ||
      Number(maxAge) > 0)
  )
    return null;
  if (
    expires !== undefined &&
    (expires === null ||
      !COOKIE_DATE.test(expires) ||
      !Number.isFinite(Date.parse(expires)) ||
      Date.parse(expires) >= nowMs)
  )
    return null;
  return name;
}

export function createProxySessionLogout(
  options: ProxySessionLogoutOptions = {},
): ProxySessionLogoutPort {
  const policy = HostedSecurityPolicySchema.parse(
    options.policy ?? DEFAULT_HOSTED_SECURITY_POLICY,
  );
  const fetcher = options.fetch ?? fetch;
  const clock = options.clock;
  const now = clock ? () => clock.nowMs() : Date.now;
  const failure = () => ({
    ok: false as const,
    code: "PROXY_LOGOUT_FAILED" as const,
    message: "Proxy logout failed",
  });

  return {
    async clearProxySession({ cookieHeader }) {
      if (
        typeof cookieHeader !== "string" ||
        !cookieHeader ||
        /[\r\n]/.test(cookieHeader) ||
        Buffer.byteLength(cookieHeader) > policy.httpHeaderMaxBytes
      )
        return failure();
      const expected = requestSessionNames(cookieHeader);
      if (expected.size === 0) return failure();
      const controller = new AbortController();
      let response: Response | undefined;
      let timedOut = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const deadline = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
            reject(new Error("Proxy logout deadline exceeded"));
          }, policy.proxyLogoutTimeoutSeconds * 1000);
        });
        const pending = fetcher(PROXY_LOGOUT_URL, {
          method: "GET",
          redirect: "manual",
          headers: { Cookie: cookieHeader },
          signal: controller.signal,
        });
        // Reclaim a body even when an injected transport resolves after cancellation.
        void pending.then(
          (late) => {
            if (timedOut) void late.body?.cancel().catch(() => {});
          },
          () => {},
        );
        response = await Promise.race([pending, deadline]);
        if (
          !(
            (response.status >= 200 && response.status < 300) ||
            response.status === 302 ||
            response.status === 303
          )
        )
          return failure();
        const headers = response.headers.getSetCookie();
        if (
          !headers.length ||
          headers.reduce((size, value) => size + Buffer.byteLength(value), 0) >
            policy.httpHeaderMaxBytes
        )
          return failure();
        const cleared = new Set<string>();
        const nowMs = now();
        if (!Number.isFinite(nowMs)) return failure();
        for (const header of headers) {
          const name = clearingCookieName(header, nowMs);
          if (!name || !expected.has(name) || cleared.has(name))
            return failure();
          cleared.add(name);
        }
        if (cleared.size !== expected.size) return failure();
        return { ok: true, setCookieHeaders: headers };
      } catch {
        return failure();
      } finally {
        clearTimeout(timeout);
        void response?.body?.cancel().catch(() => {});
      }
    },
  };
}
