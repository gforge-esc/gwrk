/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import { DEFAULT_HOSTED_SECURITY_POLICY as policy } from "./auth-policy.js";
import {
  chargeRateCounter,
  refundRateCounter,
  reservationExpired,
} from "./auth-rate-policy.js";

describe("rate admission pure transitions", () => {
  const counter = Object.freeze({
    generation: "original",
    windowStartedAtMs: 0,
    count: policy.unauthenticatedApiAttemptsPerIpPerMinute,
    lastActivityAtMs: 0,
  });
  it("denies at the policy limit without growing or mutating the input count", () => {
    const result = chargeRateCounter({
      counter,
      limit: policy.unauthenticatedApiAttemptsPerIpPerMinute,
      nowMs: 10,
      generation: "unused",
    });
    expect(result.allowed).toBe(false);
    expect(result.counter.count).toBe(60);
    expect(counter.lastActivityAtMs).toBe(0);
  });
  it("starts a new generation at the strict minute boundary", () => {
    expect(
      chargeRateCounter({
        counter,
        limit: 60,
        nowMs: 60_000,
        generation: "new",
      }),
    ).toMatchObject({
      allowed: true,
      counter: { count: 1, generation: "new", windowStartedAtMs: 60_000 },
    });
  });
  it("refunds only a live matching original generation", () => {
    expect(
      refundRateCounter({ counter, generation: "original", nowMs: 1 }).count,
    ).toBe(59);
    expect(
      refundRateCounter({ counter, generation: "different", nowMs: 1 }),
    ).toEqual(counter);
    expect(
      refundRateCounter({ counter, generation: "original", nowMs: 60_000 }),
    ).toEqual(counter);
  });
  it("does not let an old completion erase a new window charge", () => {
    const next = chargeRateCounter({
      counter,
      limit: 60,
      nowMs: 60_000,
      generation: "new",
    }).counter;
    expect(
      refundRateCounter({
        counter: next,
        generation: "original",
        nowMs: 60_001,
      }).count,
    ).toBe(1);
  });
  it("expires a reservation at the TTL boundary without extending it on observation", () => {
    const retentionMs = policy.idleBucketRetentionSeconds * 1000;
    expect(
      reservationExpired({
        createdAtMs: 0,
        nowMs: retentionMs - 1,
        retentionMs,
      }),
    ).toBe(false);
    expect(
      reservationExpired({ createdAtMs: 0, nowMs: retentionMs, retentionMs }),
    ).toBe(true);
    expect(
      reservationExpired({
        createdAtMs: 0,
        nowMs: retentionMs + 1,
        retentionMs,
      }),
    ).toBe(true);
  });
});
