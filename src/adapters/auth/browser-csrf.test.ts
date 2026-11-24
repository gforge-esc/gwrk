/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { fastifyCookie } from "@fastify/cookie";
import { Tokens } from "@fastify/csrf";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_HOSTED_SECURITY_POLICY } from "../../domain/auth-policy.js";
import { createBrowserCsrfAdapter } from "./browser-csrf.js";

const NOW = Date.parse("2026-11-23T18:00:00.500Z");
const DIGEST = "a".repeat(64);
const OTHER = "b".repeat(64);
const KEY = "synthetic-protected-startup-HMAC-canary";
const NAME = "__Host-gwrk_csrf";
function fixture() {
  const clock = {
    value: NOW,
    nowMs() {
      return this.value;
    },
  };
  const adapter = createBrowserCsrfAdapter({ hmacKey: KEY, clock });
  return { adapter, clock };
}
function secret(header: string) {
  return fastifyCookie.parse(header.split(";", 1)[0])[NAME];
}
function expiry(header: string) {
  return Date.parse(
    header
      .split(";")
      .find((part) => part.trim().toLowerCase().startsWith("expires="))
      ?.trim()
      .slice(8) ?? "",
  );
}
afterEach(() => vi.restoreAllMocks());

describe("session-bound browser CSRF adapter", () => {
  it("uses the real maintained library for issuance and verification", async () => {
    const f = fixture();
    const result = await f.adapter.issueToken({
      sessionDigest: DIGEST,
      expiresAt: new Date(NOW + 15_250).toISOString(),
    });
    const cookieValue = secret(result.cookieHeader);
    expect(cookieValue).toBeTruthy();
    expect(result.token).not.toBe(cookieValue);
    const engine = new Tokens({ userInfo: true, hmacKey: KEY });
    expect(engine.verify(cookieValue, result.token, DIGEST)).toBe(true);
    expect(
      await f.adapter.verifyToken({
        sessionDigest: DIGEST,
        headerToken: result.token,
        cookieValue,
      }),
    ).toBe(true);
    expect(result.cookieHeader).toContain(`${NAME}=`);
    expect(result.cookieHeader).toMatch(/; Path=\//);
    expect(result.cookieHeader).toMatch(/; HttpOnly/);
    expect(result.cookieHeader).toMatch(/; Secure/);
    expect(result.cookieHeader).toMatch(/; SameSite=Lax/);
    expect(result.cookieHeader).not.toMatch(/domain|max-age/i);
    expect(expiry(result.cookieHeader)).toBeLessThanOrEqual(NOW + 15_250);
    expect(expiry(result.cookieHeader)).toBeGreaterThan(NOW);
    expect(JSON.stringify(result)).not.toContain(KEY);
  });
  it.each([1000, 59_000, 3600_000])(
    "never extends a verified deadline %i milliseconds away",
    async (remaining) => {
      const f = fixture();
      const deadline = NOW + remaining;
      const result = await f.adapter.issueToken({
        sessionDigest: DIGEST,
        expiresAt: new Date(deadline).toISOString(),
      });
      expect(expiry(result.cookieHeader)).toBe(
        Math.floor(deadline / 1000) * 1000,
      );
      expect(result.cookieHeader).not.toMatch(/max-age/i);
    },
  );
  it("denies wrong-session replay even with the original cookie and header", async () => {
    const f = fixture();
    const result = await f.adapter.issueToken({
      sessionDigest: DIGEST,
      expiresAt: new Date(NOW + 60_000).toISOString(),
    });
    expect(
      await f.adapter.verifyToken({
        sessionDigest: OTHER,
        headerToken: result.token,
        cookieValue: secret(result.cookieHeader),
      }),
    ).toBe(false);
  });
  it("denies changed header tokens, cookie secrets and startup HMAC keys", async () => {
    const f = fixture();
    const result = await f.adapter.issueToken({
      sessionDigest: DIGEST,
      expiresAt: new Date(NOW + 60_000).toISOString(),
    });
    const cookieValue = secret(result.cookieHeader);
    expect(
      await f.adapter.verifyToken({
        sessionDigest: DIGEST,
        headerToken: `${result.token}x`,
        cookieValue,
      }),
    ).toBe(false);
    expect(
      await f.adapter.verifyToken({
        sessionDigest: DIGEST,
        headerToken: result.token,
        cookieValue: `${cookieValue}x`,
      }),
    ).toBe(false);
    const other = createBrowserCsrfAdapter({
      hmacKey: "another-synthetic-protected-key",
      clock: f.clock,
    });
    expect(
      await other.verifyToken({
        sessionDigest: DIGEST,
        headerToken: result.token,
        cookieValue,
      }),
    ).toBe(false);
  });
  it.each([
    undefined,
    "",
    "bad-date",
    new Date(NOW).toISOString(),
    new Date(NOW - 1).toISOString(),
  ])(
    "rejects missing, invalid or expired deadline %j before secret generation",
    async (expiresAt) => {
      const f = fixture();
      const generate = vi.spyOn(Tokens.prototype, "secret");
      await expect(
        f.adapter.issueToken({
          sessionDigest: DIGEST,
          expiresAt: expiresAt as string,
        }),
      ).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
    },
  );
  it("rechecks expiry after awaited public-library secret generation", async () => {
    const f = fixture();
    let release: ((value: string) => void) | undefined;
    vi.spyOn(Tokens.prototype, "secret").mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const pending = f.adapter.issueToken({
      sessionDigest: DIGEST,
      expiresAt: new Date(NOW + 1000).toISOString(),
    });
    expect(release).toBeTypeOf("function");
    f.clock.value = NOW + 1000;
    release?.("synthetic-secret");
    await expect(pending).rejects.toThrow();
  });
  it("returns a static error if secret generation fails without leaking the underlying error", async () => {
    const f = fixture();
    vi.spyOn(Tokens.prototype, "secret").mockRejectedValue(new Error(KEY));
    try {
      await f.adapter.issueToken({
        sessionDigest: DIGEST,
        expiresAt: new Date(NOW + 1000).toISOString(),
      });
      expect.unreachable("issuance must fail");
    } catch (error) {
      expect(String(error)).not.toContain(KEY);
    }
  });
  it.each([undefined, "", Buffer.alloc(0)])(
    "requires a startup HMAC key %j",
    (hmacKey) => {
      expect(() =>
        createBrowserCsrfAdapter({
          hmacKey: hmacKey as string,
          clock: { nowMs: () => NOW },
        }),
      ).toThrow();
    },
  );
  it.each(["sessionDigest", "headerToken", "cookieValue"] as const)(
    "denies malformed or oversized verification %s using the shared header bound",
    async (field) => {
      const f = fixture();
      const result = await f.adapter.issueToken({
        sessionDigest: DIGEST,
        expiresAt: new Date(NOW + 60_000).toISOString(),
      });
      for (const value of [
        undefined,
        "",
        "\r\n",
        "x".repeat(DEFAULT_HOSTED_SECURITY_POLICY.httpHeaderMaxBytes + 1),
      ]) {
        expect(
          await f.adapter.verifyToken({
            sessionDigest: DIGEST,
            headerToken: result.token,
            cookieValue: secret(result.cookieHeader),
            [field]: value,
          } as Parameters<typeof f.adapter.verifyToken>[0]),
        ).toBe(false);
      }
    },
  );
  it("uses the configured stricter header bound", async () => {
    const f = fixture();
    const adapter = createBrowserCsrfAdapter({
      hmacKey: KEY,
      clock: f.clock,
      policy: { ...DEFAULT_HOSTED_SECURITY_POLICY, httpHeaderMaxBytes: 1024 },
    });
    expect(
      await adapter.verifyToken({
        sessionDigest: DIGEST,
        headerToken: "x".repeat(1025),
        cookieValue: "secret",
      }),
    ).toBe(false);
    await expect(
      adapter.issueToken({
        sessionDigest: "x".repeat(1025),
        expiresAt: new Date(NOW + 60_000).toISOString(),
      }),
    ).rejects.toThrow();
  });
  it("rejects missing or malformed session digest on issuance", async () => {
    const f = fixture();
    for (const sessionDigest of ["", "\r\n", "x".repeat(16_385)])
      await expect(
        f.adapter.issueToken({
          sessionDigest,
          expiresAt: new Date(NOW + 60_000).toISOString(),
        }),
      ).rejects.toThrow();
  });
  it("rejects nonfinite clock values before and after generation", async () => {
    const f = fixture();
    f.clock.value = Number.NaN;
    await expect(
      f.adapter.issueToken({
        sessionDigest: DIGEST,
        expiresAt: new Date(NOW + 1000).toISOString(),
      }),
    ).rejects.toThrow();
    f.clock.value = NOW;
    vi.spyOn(Tokens.prototype, "secret").mockImplementation(async () => {
      f.clock.value = Number.NaN;
      return "synthetic";
    });
    await expect(
      f.adapter.issueToken({
        sessionDigest: DIGEST,
        expiresAt: new Date(NOW + 1000).toISOString(),
      }),
    ).rejects.toThrow();
  });
  it("clears the same host-only secure HttpOnly cookie", () => {
    const header = fixture().adapter.clearCookieHeader();
    expect(header).toMatch(/^__Host-gwrk_csrf=;/);
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; HttpOnly/);
    expect(header).toMatch(/; Secure/);
    expect(header).toMatch(/; SameSite=Lax/);
    expect(header).not.toMatch(/domain/i);
    expect(expiry(header)).toBeLessThan(NOW);
    expect(header).not.toContain(KEY);
  });
  it("imports and constructs without transport, entropy or clock reads", async () => {
    const fetcher = vi.fn();
    const clock = { nowMs: vi.fn(() => NOW) };
    const generate = vi.spyOn(Tokens.prototype, "secret");
    vi.stubGlobal("fetch", fetcher);
    try {
      const module = await import("./browser-csrf.js");
      module.createBrowserCsrfAdapter({ hmacKey: KEY, clock });
      expect(fetcher).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(clock.nowMs).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
