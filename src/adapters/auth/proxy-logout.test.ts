/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOSTED_SECURITY_POLICY } from "../../domain/auth-policy.js";
import { PROXY_LOGOUT_URL, createProxySessionLogout } from "./proxy-logout.js";

const COOKIE = "__Host-gwrk_session";
const NOW = Date.parse("2026-11-23T18:00:00Z");
const clear = (name = COOKIE) =>
  `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; HttpOnly; SameSite=Lax`;
const input = { cookieHeader: `${COOKIE}=synthetic-session; theme=dark` };
function fixture() {
  const fetcher = vi.fn(
    async (_url: string, _options: unknown) =>
      new Response("ignored", {
        status: 302,
        headers: {
          "set-cookie": clear(),
          location: "https://attacker.invalid",
        },
      }),
  );
  const adapter = createProxySessionLogout({
    fetch: fetcher,
    clock: { nowMs: () => NOW },
  });
  return { adapter, fetcher };
}
afterEach(() => vi.useRealTimers());

describe("fixed internal proxy logout", () => {
  it.each([200, 302])(
    "accepts HTTP %s with genuine clearing headers without following redirects",
    async (status) => {
      const f = fixture();
      const cancel = vi.fn();
      f.fetcher.mockImplementation(
        async () =>
          new Response(new ReadableStream({ cancel }), {
            status,
            headers: {
              "set-cookie": clear(),
              location: "https://attacker.invalid",
            },
          }),
      );
      expect(await f.adapter.clearProxySession(input)).toEqual({
        ok: true,
        setCookieHeaders: [clear()],
      });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(f.fetcher).toHaveBeenCalledWith(
        "http://127.0.0.1:4180/oauth2/sign_out",
        expect.objectContaining({
          method: "GET",
          redirect: "manual",
          headers: { Cookie: input.cookieHeader },
        }),
      );
      expect(cancel).toHaveBeenCalled();
    },
  );
  it("preserves separate numbered chunk clearing headers and Expires commas", async () => {
    const f = fixture();
    const headers = new Headers();
    headers.append("set-cookie", clear(`${COOKIE}_0`));
    headers.append("set-cookie", clear(`${COOKIE}_1`));
    f.fetcher.mockImplementation(
      async () => new Response(null, { status: 302, headers }),
    );
    expect(
      await f.adapter.clearProxySession({
        cookieHeader: `${COOKIE}_0=part0; ${COOKIE}_1=part1`,
      }),
    ).toEqual({
      ok: true,
      setCookieHeaders: [clear(`${COOKIE}_0`), clear(`${COOKIE}_1`)],
    });
  });
  it("accepts an explicit Max-Age deletion", async () => {
    const f = fixture();
    const header = `${COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly`;
    f.fetcher.mockImplementation(
      async () => new Response(null, { headers: { "set-cookie": header } }),
    );
    expect(await f.adapter.clearProxySession(input)).toEqual({
      ok: true,
      setCookieHeaders: [header],
    });
  });
  it.each([
    undefined,
    "",
    "theme=dark",
    `${COOKIE}=x\r\nAuthorization: forged`,
    `${COOKIE}=${"x".repeat(16384)}`,
  ])(
    "rejects missing or unsafe Cookie input before transport %j",
    async (cookieHeader) => {
      const f = fixture();
      expect(await f.adapter.clearProxySession({ cookieHeader })).toEqual({
        ok: false,
        code: "PROXY_LOGOUT_FAILED",
        message: "Proxy logout failed",
      });
      expect(f.fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([
    "",
    "unrelated=; Max-Age=0; Path=/; Secure; HttpOnly",
    `${COOKIE}=still-live; Max-Age=0; Path=/; Secure; HttpOnly`,
    `${COOKIE}=; Path=/; Secure; HttpOnly`,
    `${COOKIE}=; Max-Age=3600; Path=/; Secure; HttpOnly`,
    `${COOKIE}=; Expires=Mon, 01 Jan 2040 00:00:00 GMT; Path=/; Secure; HttpOnly`,
    `${COOKIE}=; Max-Age=0; Domain=gforge.ai; Path=/; Secure; HttpOnly`,
    `${COOKIE}=; Max-Age=0; Path=/oauth2; Secure; HttpOnly`,
    `${COOKIE}=; Max-Age=0; Path=/; HttpOnly`,
    `${COOKIE}=; Max-Age=0; Path=/; Secure`,
    `${COOKIE}=; Max-Age=0; Max-Age=3600; Path=/; Secure; HttpOnly`,
  ])(
    "does not claim clearing for invalid response cookie %s",
    async (header) => {
      const f = fixture();
      f.fetcher.mockImplementation(
        async () =>
          new Response(null, {
            status: 302,
            headers: header ? { "set-cookie": header } : {},
          }),
      );
      expect(await f.adapter.clearProxySession(input)).toMatchObject({
        ok: false,
        code: "PROXY_LOGOUT_FAILED",
      });
    },
  );
  it("rejects numeric Expires that JavaScript parses but cookie grammar does not", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: {
            "set-cookie": `${COOKIE}=; Expires=0; Path=/; Secure; HttpOnly`,
          },
        }),
    );
    expect(await f.adapter.clearProxySession(input)).toMatchObject({
      ok: false,
    });
  });
  it("rejects missing numbered cookie clearing instead of claiming all chunks cleared", async () => {
    const f = fixture();
    f.fetcher.mockImplementation(
      async () =>
        new Response(null, {
          status: 302,
          headers: { "set-cookie": clear(`${COOKIE}_0`) },
        }),
    );
    expect(
      await f.adapter.clearProxySession({
        cookieHeader: `${COOKIE}_0=p0; ${COOKIE}_1=p1`,
      }),
    ).toMatchObject({ ok: false });
  });
  it.each([401, 500])(
    "rejects upstream HTTP %s even with a clearing header",
    async (status) => {
      const f = fixture();
      f.fetcher.mockImplementation(
        async () =>
          new Response(null, { status, headers: { "set-cookie": clear() } }),
      );
      expect(await f.adapter.clearProxySession(input)).toMatchObject({
        ok: false,
      });
    },
  );
  it("returns no upstream error, cookie value, response body, or Location", async () => {
    const f = fixture();
    f.fetcher.mockRejectedValue(new Error("CANARY_TOKEN_COOKIE_ERROR"));
    expect(await f.adapter.clearProxySession(input)).toEqual({
      ok: false,
      code: "PROXY_LOGOUT_FAILED",
      message: "Proxy logout failed",
    });
    expect(PROXY_LOGOUT_URL).toBe("http://127.0.0.1:4180/oauth2/sign_out");
  });
  it("bounds even a fetch that ignores abort", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let signal: AbortSignal | undefined;
    f.fetcher.mockImplementation((_url, options) => {
      signal = (options as { signal: AbortSignal }).signal;
      return new Promise(() => {});
    });
    const result = f.adapter.clearProxySession(input);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({ ok: false });
    expect(signal?.aborted).toBe(true);
  });
  it("cancels a late response body after timeout", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let resolve: ((response: Response) => void) | undefined;
    f.fetcher.mockImplementation(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    const pending = f.adapter.clearProxySession(input);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await pending).toMatchObject({ ok: false });
    const cancel = vi.fn();
    resolve?.(new Response(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalled();
  });
  it("cancels unused failure bodies without waiting for their data", async () => {
    const f = fixture();
    const cancel = vi.fn();
    f.fetcher.mockImplementation(
      async () => new Response(new ReadableStream({ cancel }), { status: 500 }),
    );
    expect(await f.adapter.clearProxySession(input)).toMatchObject({
      ok: false,
    });
    expect(cancel).toHaveBeenCalled();
  });
  it("preserves the receiver of the injected clock port", async () => {
    const f = fixture();
    const clock = {
      value: NOW,
      nowMs() {
        return this.value;
      },
    };
    const adapter = createProxySessionLogout({ fetch: f.fetcher, clock });
    expect(await adapter.clearProxySession(input)).toMatchObject({ ok: true });
  });
  it("uses stricter shared timeout policy", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => {}));
    const adapter = createProxySessionLogout({
      fetch: fetcher,
      policy: {
        ...DEFAULT_HOSTED_SECURITY_POLICY,
        proxyLogoutTimeoutSeconds: 1,
      },
    });
    const pending = adapter.clearProxySession(input);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ ok: false });
  });
  it("imports and constructs without transport or other startup I/O", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      vi.resetModules();
      const module = await import("./proxy-logout.js");
      module.createProxySessionLogout();
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
