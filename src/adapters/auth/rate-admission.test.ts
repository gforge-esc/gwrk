/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
} from "../../domain/auth-policy.js";
import type {
  RateAdmissionPort,
  Reservation,
} from "../../ports/rate-admission-port.js";
import { createRateAdmission } from "./rate-admission.js";

const credential = {
  authMethod: "api_key" as const,
  credentialId: "pilot_key",
};
const adapters: RateAdmissionPort[] = [];
function make(overrides: Partial<HostedSecurityPolicy> = {}) {
  const owner = createRateAdmission({
    policy: { ...DEFAULT_HOSTED_SECURITY_POLICY, ...overrides },
    clock: { nowMs: () => Date.now() },
  });
  adapters.push(owner);
  return owner;
}
function reserve(
  owner: RateAdmissionPort,
  trustedIp = "192.0.2.1",
): Reservation {
  const result = owner.reserveApi({ trustedIp });
  expect(result.allowed).toBe(true);
  if (!result.allowed) throw new Error("Expected admission");
  return result.reservation;
}
function verified(
  owner: RateAdmissionPort,
  reservation: Reservation,
  credentialId = "pilot_key",
) {
  return owner.completeVerified({
    reservation,
    credential: { ...credential, credentialId },
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  for (const owner of adapters.splice(0)) owner.close();
  vi.useRealTimers();
});

describe("bounded origin rate admission", () => {
  it("denies attempt 61 before a concurrent failing verifier starts", async () => {
    const owner = make();
    let release!: () => void;
    const barrier = new Promise<void>((r) => {
      release = r;
    });
    const verifier = vi.fn(async () => {
      await barrier;
      return false;
    });
    const handler = vi.fn();
    const attempts = Array.from({ length: 61 }, async () => {
      const result = owner.reserveApi({ trustedIp: "192.0.2.1" });
      if (!result.allowed) return result;
      if (await verifier()) handler();
      owner.completeUnverified({ reservation: result.reservation });
      return result;
    });
    expect(verifier).toHaveBeenCalledTimes(60);
    expect(handler).not.toHaveBeenCalled();
    release();
    const results = await Promise.all(attempts);
    expect(results.filter((r) => !r.allowed)).toHaveLength(1);
    expect(owner.reserveApi({ trustedIp: "192.0.2.1" })).toMatchObject({
      allowed: false,
      reason: "quota",
    });
  });
  it("permits 120 sequential verified effects and denies effect 121 by credential", () => {
    const owner = make();
    let effects = 0;
    for (let i = 0; i < 121; i++)
      if (verified(owner, reserve(owner)).allowed) effects++;
    expect(effects).toBe(120);
  });
  it("does not promise a 120-request concurrent same-IP verified burst", () => {
    const owner = make();
    const results = Array.from({ length: 120 }, () =>
      owner.reserveApi({ trustedIp: "192.0.2.1" }),
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(60);
    for (const result of results)
      if (result.allowed)
        expect(verified(owner, result.reservation).allowed).toBe(true);
  });
  it("retains failure charges and makes failure/abort cleanup one-time", () => {
    const owner = make({ unauthenticatedApiAttemptsPerIpPerMinute: 1 });
    const handle = reserve(owner);
    expect(owner.completeUnverified({ reservation: handle })).toEqual({
      settled: true,
    });
    expect(owner.completeUnverified({ reservation: handle })).toEqual({
      settled: false,
    });
    expect(verified(owner, handle).allowed).toBe(false);
    expect(owner.reserveApi({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
  });
  it("finalizes valid over-quota attempts without leaving IP reservations or charging another credential on replay", () => {
    const owner = make({
      unauthenticatedApiAttemptsPerIpPerMinute: 1,
      apiRequestsPerCredentialPerMinute: 1,
    });
    const first = reserve(owner);
    expect(verified(owner, first).allowed).toBe(true);
    expect(verified(owner, first, "other").allowed).toBe(false);
    const second = reserve(owner);
    expect(verified(owner, second)).toMatchObject({
      allowed: false,
      reason: "quota",
    });
    expect(verified(owner, second, "other").allowed).toBe(false);
    expect(verified(owner, reserve(owner), "other").allowed).toBe(true);
  });
  it("cannot refund a new window with an old unexpired completion", () => {
    const owner = make({ unauthenticatedApiAttemptsPerIpPerMinute: 2 });
    const old = reserve(owner);
    vi.setSystemTime(60_000);
    const failure = reserve(owner);
    owner.completeUnverified({ reservation: failure });
    expect(verified(owner, old).allowed).toBe(true);
    const one = reserve(owner);
    owner.completeUnverified({ reservation: one });
    expect(owner.reserveApi({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
  });
  it("keeps 60 pending admissions across window rollover", () => {
    const owner = make();
    for (let i = 0; i < 60; i++) reserve(owner);
    vi.setSystemTime(60_000);
    expect(owner.reserveApi({ trustedIp: "192.0.2.1" })).toMatchObject({
      allowed: false,
      reason: "quota",
    });
  });
  it("expires abandoned handles and pins at 120 seconds without caller cleanup", () => {
    const owner = make({ rateLimitBucketCount: 1 });
    const old = reserve(owner);
    vi.advanceTimersByTime(120_000);
    expect(owner.reserveApi({ trustedIp: "192.0.2.2" }).allowed).toBe(true);
    expect(verified(owner, old).allowed).toBe(false);
  });
  it("fails closed on an expired handle before the timer callback and charges no new credential", () => {
    const owner = make({ apiRequestsPerCredentialPerMinute: 1 });
    const old = reserve(owner);
    vi.setSystemTime(120_000);
    expect(verified(owner, old)).toMatchObject({
      allowed: false,
      reason: "reservation_invalid",
    });
    expect(verified(owner, reserve(owner)).allowed).toBe(true);
  });
  it("does not extend a reservation deadline when newer requests touch its IP", () => {
    const owner = make();
    const old = reserve(owner);
    vi.setSystemTime(119_999);
    const recent = reserve(owner);
    owner.completeUnverified({ reservation: recent });
    vi.setSystemTime(120_000);
    expect(verified(owner, old).allowed).toBe(false);
  });
  it("rejects forged and cross-store handles without consuming or refunding quota", () => {
    const owner = make({ unauthenticatedApiAttemptsPerIpPerMinute: 1 });
    const other = make();
    const handle = reserve(owner);
    expect(verified(other, handle).allowed).toBe(false);
    expect(verified(owner, Object.freeze({}) as Reservation).allowed).toBe(
      false,
    );
    expect(owner.reserveApi({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
    expect(verified(owner, handle).allowed).toBe(true);
  });
  it("shares one 1000-bucket capacity across login, IP and verified classes without evicting counts", () => {
    const owner = make();
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(true);
    expect(verified(owner, reserve(owner)).allowed).toBe(true);
    for (let i = 0; i < 997; i++)
      expect(
        owner.consumeLogin({ trustedIp: `2001:db8::${(i + 1).toString(16)}` })
          .allowed,
      ).toBe(true);
    expect(owner.consumeLogin({ trustedIp: "198.51.100.1" })).toMatchObject({
      allowed: false,
      reason: "capacity",
    });
    for (let i = 1; i < 60; i++)
      expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(true);
    for (let i = 0; i < 100; i++)
      expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(
        false,
      );
  });
  it("reclaims idle capacity after 120 seconds and clears the single cleanup timer on close", () => {
    const owner = make({ rateLimitBucketCount: 1 });
    owner.consumeLogin({ trustedIp: "192.0.2.1" });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(119_999);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" }).allowed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" }).allowed).toBe(true);
    owner.close();
    owner.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" })).toMatchObject({
      allowed: false,
      reason: "closed",
    });
  });
  it("bounds live handles by 60 times the 1000-bucket cap and reclaims stale generations", () => {
    const owner = make();
    for (let key = 1; key <= 1000; key++)
      for (let i = 0; i < 60; i++)
        reserve(owner, `2001:db8::${key.toString(16)}`);
    expect(owner.reserveApi({ trustedIp: "198.51.100.1" })).toMatchObject({
      allowed: false,
      reason: "capacity",
    });
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(120_000);
    expect(owner.reserveApi({ trustedIp: "198.51.100.1" }).allowed).toBe(true);
  });
  it("rejects oversized or raw credential identities without allocating a verified bucket", () => {
    const owner = make({ rateLimitBucketCount: 2 });
    const handle = reserve(owner);
    expect(verified(owner, handle, "gwrk_v1.raw.secret").allowed).toBe(false);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" }).allowed).toBe(true);
    expect(owner.consumeLogin({ trustedIp: "x".repeat(46) }).allowed).toBe(
      false,
    );
    expect(verified(owner, handle, "a".repeat(65)).allowed).toBe(false);
  });
  it("normalizes equivalent full IP addresses without aggregating neighboring IPv6 clients", () => {
    const owner = make({ loginRequestsPerIpPerMinute: 1 });
    expect(
      owner.consumeLogin({ trustedIp: "2001:0DB8:0:0:0:0:0:1" }).allowed,
    ).toBe(true);
    expect(owner.consumeLogin({ trustedIp: "2001:db8::1" }).allowed).toBe(
      false,
    );
    expect(owner.consumeLogin({ trustedIp: "2001:db8::2" }).allowed).toBe(true);
    expect(owner.consumeLogin({ trustedIp: "::ffff:192.0.2.1" }).allowed).toBe(
      true,
    );
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
  });
  it("fails closed on clock errors, invalid time and invalid central policy", () => {
    const owner = createRateAdmission({
      clock: {
        nowMs: () => {
          throw new Error("SECRET_CANARY");
        },
      },
    });
    adapters.push(owner);
    const result = owner.reserveApi({ trustedIp: "192.0.2.1" });
    expect(result.allowed).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SECRET_CANARY");
    const invalid = createRateAdmission({ clock: { nowMs: () => Number.NaN } });
    adapters.push(invalid);
    expect(invalid.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(
      false,
    );
    expect(() => make({ rateLimitBucketCount: 1001 })).toThrow();
  });
  it("keeps API and Google verified namespaces separate and accepts only digest-shaped Google identity", () => {
    const owner = make({ apiRequestsPerCredentialPerMinute: 1 });
    const id = "a".repeat(64);
    expect(verified(owner, reserve(owner), id).allowed).toBe(true);
    expect(
      owner.completeVerified({
        reservation: reserve(owner),
        credential: { authMethod: "google_id_token", credentialId: id },
      }).allowed,
    ).toBe(true);
    expect(
      owner.completeVerified({
        reservation: reserve(owner),
        credential: {
          authMethod: "google_id_token",
          credentialId: "raw-token-canary",
        },
      }).allowed,
    ).toBe(false);
    expect(
      owner.completeVerified({
        reservation: reserve(owner),
        credential: { authMethod: "google_id_token", credentialId: id },
      }).allowed,
    ).toBe(false);
  });
  it("does not reset an active counter when the configured idle retention is shorter than its window", () => {
    const owner = make({
      idleBucketRetentionSeconds: 1,
      rateLimitBucketCount: 1,
      loginRequestsPerIpPerMinute: 1,
    });
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" })).toMatchObject({
      allowed: false,
      reason: "capacity",
    });
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
    vi.advanceTimersByTime(59_000);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.2" }).allowed).toBe(true);
  });
  it("returns opaque immutable handles and rejects a forged object without evaluating its fields", () => {
    const owner = make();
    const handle = reserve(owner);
    expect(Object.isFrozen(handle)).toBe(true);
    expect(JSON.stringify(handle)).toBe("{}");
    const forged = Object.defineProperty({}, "generation", {
      get() {
        throw new Error("private-canary");
      },
    }) as Reservation;
    expect(verified(owner, forged)).toMatchObject({
      allowed: false,
      reason: "reservation_invalid",
    });
    expect(verified(owner, handle).allowed).toBe(true);
  });
  it("clears live handles on close and never accepts their late completions", () => {
    const owner = make();
    const handle = reserve(owner);
    owner.close();
    expect(vi.getTimerCount()).toBe(0);
    expect(verified(owner, handle)).toMatchObject({
      allowed: false,
      reason: "closed",
    });
    expect(owner.completeUnverified({ reservation: handle })).toEqual({
      settled: false,
    });
  });
});

describe("maintained plugin shared-store facade", () => {
  it("shares parent and child counters with direct login consumption through the real manual API", async () => {
    const owner = make({
      loginRequestsPerIpPerMinute: 2,
      rateLimitBucketCount: 3,
    });
    const app = Fastify();
    try {
      await app.register(rateLimit, {
        global: false,
        store: owner.pluginStore,
      });
      const first = app.createRateLimit({
        max: 2,
        timeWindow: 60_000,
        keyGenerator: () => "login:192.0.2.1",
      });
      const second = app.createRateLimit({
        max: 2,
        timeWindow: 60_000,
        keyGenerator: () => "login:192.0.2.1",
      });
      app.get("/probe", async (request) => {
        const result = await first(request);
        return { allowed: result.isAllowed || !result.isExceeded };
      });
      app.get("/other", async (request) => {
        const result = await second(request);
        return { allowed: result.isAllowed || !result.isExceeded };
      });
      const third = app.createRateLimit({
        max: 2,
        timeWindow: 60_000,
        keyGenerator: () => "login:192.0.2.2",
      });
      app.get("/new-key", async (request) => {
        const result = await third(request);
        return { allowed: result.isAllowed || !result.isExceeded };
      });
      expect((await app.inject("/probe")).json()).toEqual({ allowed: true });
      expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(true);
      expect((await app.inject("/other")).json()).toEqual({ allowed: false });
      expect(verified(owner, reserve(owner)).allowed).toBe(true);
      expect((await app.inject("/new-key")).json()).toEqual({ allowed: false });
      expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });
  it("invokes a store callback once and propagates consumer exceptions without another charge", () => {
    const owner = make({ loginRequestsPerIpPerMinute: 2 });
    const store = new owner.pluginStore({});
    const callback = vi.fn(() => {
      throw new Error("consumer failure");
    });
    expect(() => store.incr("login:192.0.2.1", callback, 60_000, 2)).toThrow(
      "consumer failure",
    );
    expect(callback).toHaveBeenCalledTimes(1);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(true);
    expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(false);
  });
  it("rejects bare refunds and unapproved plugin limits instead of opening allowance", async () => {
    const owner = make();
    const app = Fastify();
    try {
      await app.register(rateLimit, {
        global: false,
        store: owner.pluginStore,
      });
      const refund = app.createRateLimit({
        max: 60,
        timeWindow: 60_000,
        keyGenerator: () => "login:192.0.2.1",
      });
      const wrong = app.createRateLimit({
        max: 61,
        timeWindow: 60_000,
        keyGenerator: () => "login:192.0.2.1",
      });
      app.get("/refund", async (request) => {
        await refund(request, { refund: true });
        return "unexpected";
      });
      app.get("/wrong", async (request) => {
        await wrong(request);
        return "unexpected";
      });
      const api = app.createRateLimit({
        max: 60,
        timeWindow: 60_000,
        keyGenerator: () => "verified:api_key:pilot_key",
      });
      app.get("/api-charge", async (request) => {
        await api(request);
        return "unexpected";
      });
      expect((await app.inject("/refund")).statusCode).toBe(500);
      expect((await app.inject("/wrong")).statusCode).toBe(500);
      expect((await app.inject("/api-charge")).statusCode).toBe(500);
      for (let i = 0; i < 60; i++)
        expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(
          true,
        );
      expect(owner.consumeLogin({ trustedIp: "192.0.2.1" }).allowed).toBe(
        false,
      );
    } finally {
      await app.close();
    }
  });
});
