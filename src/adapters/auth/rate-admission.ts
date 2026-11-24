/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import type {
  FastifyRateLimitStore,
  FastifyRateLimitStoreCtor,
} from "@fastify/rate-limit";
import {
  DEFAULT_HOSTED_SECURITY_POLICY,
  type HostedSecurityPolicy,
  validateHostedSecurityPolicy,
} from "../../domain/auth-policy.js";
import {
  RATE_WINDOW_MS,
  type RateCounter,
  chargeRateCounter,
  refundRateCounter,
  reservationExpired,
} from "../../domain/auth-rate-policy.js";
import type { VerifiedAuthContext } from "../../ports/auth-port.js";
import type { ClockPort } from "../../ports/operations-port.js";
import type {
  Decision,
  RateAdmissionPort,
  Reservation,
  Reserved,
} from "../../ports/rate-admission-port.js";

type Denied = Extract<Decision, { allowed: false }>;
interface Bucket {
  counter: RateCounter;
  readonly pending: Set<Reservation>;
}
interface LiveReservation {
  readonly id: string;
  readonly generation: string;
  readonly bucketKey: string;
  readonly createdAtMs: number;
}
export interface RateAdmissionAdapter extends RateAdmissionPort {
  /** Login-only facade. API charges belong exclusively to reservation completion. */
  readonly pluginStore: FastifyRateLimitStoreCtor;
}

function normalizeIp(value: string): string {
  if (typeof value !== "string" || value.length > 45 || !isIP(value))
    throw new Error("Invalid rate subject");
  if (isIP(value) === 4) return value;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (!mapped) return normalized;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}
function verifiedKey(
  value: Pick<VerifiedAuthContext, "authMethod" | "credentialId">,
): string {
  const pattern =
    value.authMethod === "api_key"
      ? /^[A-Za-z0-9_-]{1,64}$/
      : value.authMethod === "google_id_token"
        ? /^[0-9a-f]{64}$/
        : null;
  if (
    !pattern ||
    typeof value.credentialId !== "string" ||
    !pattern.test(value.credentialId)
  )
    throw new Error("Invalid rate subject");
  return `verified:${value.authMethod}:${value.credentialId}`;
}

export function createRateAdmission(options: {
  readonly policy?: HostedSecurityPolicy;
  readonly clock: Pick<ClockPort, "nowMs">;
}): RateAdmissionAdapter {
  const validated = validateHostedSecurityPolicy(
    options.policy ?? DEFAULT_HOSTED_SECURITY_POLICY,
  );
  if (!validated.ok) throw new Error("Invalid hosted security policy");
  const policy = Object.freeze(validated.value);
  const retentionMs = policy.idleBucketRetentionSeconds * 1000;
  const buckets = new Map<string, Bucket>();
  const reservations = new Map<Reservation, LiveReservation>();
  const maxReservations =
    policy.rateLimitBucketCount *
    policy.unauthenticatedApiAttemptsPerIpPerMinute;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let nextDeadline = Number.POSITIVE_INFINITY;
  let lastNow = 0;
  const denied = (reason: Denied["reason"], retryAfterMs?: number): Denied => ({
    allowed: false,
    reason,
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
  function readTime(): number {
    const now = options.clock.nowMs();
    if (!Number.isFinite(now) || now < 0 || now < lastNow)
      throw new Error("Invalid rate clock");
    lastNow = now;
    return now;
  }
  function bucketDeadline(bucket: Bucket): number {
    const idle = bucket.counter.lastActivityAtMs + retentionMs;
    return bucket.counter.count > 0
      ? Math.max(idle, bucket.counter.windowStartedAtMs + RATE_WINDOW_MS)
      : idle;
  }
  function schedule(deadline: number, now: number): void {
    if (closed || (timer && nextDeadline <= deadline)) return;
    if (timer) clearTimeout(timer);
    timer = undefined;
    nextDeadline = deadline;
    if (!Number.isFinite(deadline)) return;
    timer = setTimeout(
      () => {
        timer = undefined;
        try {
          sweep(readTime());
        } catch {
          close();
        }
      },
      Math.max(1, deadline - now),
    );
    timer.unref?.();
  }
  function removeReservation(
    handle: Reservation,
    entry: LiveReservation,
  ): void {
    reservations.delete(handle);
    buckets.get(entry.bucketKey)?.pending.delete(handle);
  }
  function sweep(now: number): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    nextDeadline = Number.POSITIVE_INFINITY;
    for (const [handle, entry] of reservations) {
      if (
        reservationExpired({
          createdAtMs: entry.createdAtMs,
          nowMs: now,
          retentionMs,
        })
      )
        removeReservation(handle, entry);
    }
    let next = Number.POSITIVE_INFINITY;
    for (const [key, bucket] of buckets) {
      const deadline = bucketDeadline(bucket);
      if (!bucket.pending.size && now >= deadline) buckets.delete(key);
      else if (deadline > now) next = Math.min(next, deadline);
    }
    for (const entry of reservations.values())
      next = Math.min(next, entry.createdAtMs + retentionMs);
    schedule(next, now);
  }
  function prepare(): number {
    const now = readTime();
    if (now >= nextDeadline) sweep(now);
    return now;
  }
  function consume(
    key: string,
    limit: number,
    now: number,
  ): { decision: Decision; bucket?: Bucket } {
    let bucket = buckets.get(key);
    if (!bucket && buckets.size >= policy.rateLimitBucketCount)
      return { decision: denied("capacity") };
    const result = chargeRateCounter({
      counter: bucket?.counter,
      limit,
      nowMs: now,
      generation: randomUUID(),
    });
    if (!bucket) {
      bucket = { counter: result.counter, pending: new Set() };
      buckets.set(key, bucket);
    } else bucket.counter = result.counter;
    schedule(bucketDeadline(bucket), now);
    return {
      decision: result.allowed
        ? { allowed: true }
        : denied(
            "quota",
            bucket.counter.windowStartedAtMs + RATE_WINDOW_MS - now,
          ),
      bucket,
    };
  }
  function consumeLogin(input: { trustedIp: string }): Decision {
    if (closed) return denied("closed");
    try {
      return consume(
        `login:${normalizeIp(input.trustedIp)}`,
        policy.loginRequestsPerIpPerMinute,
        prepare(),
      ).decision;
    } catch {
      return denied("store_error");
    }
  }
  function reserveApi(input: { trustedIp: string }): Reserved {
    if (closed) return denied("closed");
    try {
      const key = `unverified:${normalizeIp(input.trustedIp)}`;
      const now = prepare();
      const existing = buckets.get(key);
      if (
        (existing?.pending.size ?? 0) >=
        policy.unauthenticatedApiAttemptsPerIpPerMinute
      )
        return denied("quota");
      if (reservations.size >= maxReservations) return denied("capacity");
      const result = consume(
        key,
        policy.unauthenticatedApiAttemptsPerIpPerMinute,
        now,
      );
      if (!result.decision.allowed || !result.bucket)
        return result.decision as Denied;
      const handle = Object.freeze({}) as Reservation;
      const entry = Object.freeze({
        id: randomUUID(),
        generation: result.bucket.counter.generation,
        bucketKey: key,
        createdAtMs: now,
      });
      reservations.set(handle, entry);
      result.bucket.pending.add(handle);
      schedule(now + retentionMs, now);
      return { allowed: true, reservation: handle };
    } catch {
      return denied("store_error");
    }
  }
  function take(handle: Reservation, now: number): LiveReservation | undefined {
    const entry = reservations.get(handle);
    if (!entry) return;
    removeReservation(handle, entry);
    if (
      reservationExpired({
        createdAtMs: entry.createdAtMs,
        nowMs: now,
        retentionMs,
      })
    )
      return;
    return entry;
  }
  function completeVerified(input: {
    reservation: Reservation;
    credential: Pick<VerifiedAuthContext, "authMethod" | "credentialId">;
  }): Decision {
    if (closed) return denied("closed");
    try {
      const now = prepare();
      const entry = take(input.reservation, now);
      if (!entry) return denied("reservation_invalid");
      const key = verifiedKey(input.credential);
      const bucket = buckets.get(entry.bucketKey);
      if (!bucket) return denied("reservation_invalid");
      bucket.counter = refundRateCounter({
        counter: bucket.counter,
        generation: entry.generation,
        nowMs: now,
      });
      return consume(key, policy.apiRequestsPerCredentialPerMinute, now)
        .decision;
    } catch {
      return denied("store_error");
    }
  }
  function completeUnverified(input: { reservation: Reservation }): {
    settled: boolean;
  } {
    if (closed) return { settled: false };
    try {
      return { settled: !!take(input.reservation, prepare()) };
    } catch {
      return { settled: false };
    }
  }
  function expire(): void {
    if (closed) return;
    try {
      sweep(readTime());
    } catch {
      close();
    }
  }
  function close(): void {
    if (timer) clearTimeout(timer);
    timer = undefined;
    nextDeadline = Number.POSITIVE_INFINITY;
    reservations.clear();
    buckets.clear();
    closed = true;
  }
  class SharedLoginStore implements FastifyRateLimitStore {
    incr(
      key: string,
      callback: (
        error: Error | null,
        result?: { current: number; ttl: number },
      ) => void,
      timeWindow: number,
      max: number,
    ): void {
      let snapshot: { current: number; ttl: number };
      try {
        if (
          timeWindow !== RATE_WINDOW_MS ||
          max !== policy.loginRequestsPerIpPerMinute ||
          !key.startsWith("login:")
        )
          throw new Error("Rate limiter policy mismatch");
        const result = consumeLogin({ trustedIp: key.slice("login:".length) });
        if (
          !result.allowed &&
          result.reason !== "quota" &&
          result.reason !== "capacity"
        )
          throw new Error("Rate limiter unavailable");
        const now = readTime();
        const normalized = `login:${normalizeIp(key.slice("login:".length))}`;
        const counter = buckets.get(normalized)?.counter;
        if (result.allowed && !counter)
          throw new Error("Rate limiter unavailable");
        snapshot = {
          current: result.allowed && counter ? counter.count : max + 1,
          ttl: counter
            ? Math.max(0, counter.windowStartedAtMs + RATE_WINDOW_MS - now)
            : retentionMs,
        };
      } catch {
        callback(new Error("Rate limiter unavailable"));
        return;
      }
      callback(null, snapshot);
    }
    child(): FastifyRateLimitStore {
      return new SharedLoginStore();
    }
  }
  return {
    consumeLogin,
    reserveApi,
    completeVerified,
    completeUnverified,
    expire,
    close,
    pluginStore: SharedLoginStore,
  };
}
