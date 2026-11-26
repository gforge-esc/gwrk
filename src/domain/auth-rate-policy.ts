/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

export const RATE_WINDOW_MS = 60 * 1000;

export interface RateCounter {
  readonly generation: string;
  readonly windowStartedAtMs: number;
  readonly count: number;
  readonly lastActivityAtMs: number;
}

export function chargeRateCounter(input: {
  counter: RateCounter | undefined;
  limit: number;
  nowMs: number;
  generation: string;
}): { allowed: boolean; counter: RateCounter } {
  const { limit, nowMs, generation } = input;
  const previous = input.counter;
  const current =
    !previous || nowMs >= previous.windowStartedAtMs + RATE_WINDOW_MS
      ? {
          generation,
          windowStartedAtMs: nowMs,
          count: 0,
          lastActivityAtMs: nowMs,
        }
      : previous;
  const allowed = current.count < limit;
  return {
    allowed,
    counter: {
      ...current,
      count: allowed ? current.count + 1 : current.count,
      lastActivityAtMs: nowMs,
    },
  };
}

export function refundRateCounter(input: {
  counter: RateCounter;
  generation: string;
  nowMs: number;
}): RateCounter {
  const { counter, generation, nowMs } = input;
  if (
    counter.generation !== generation ||
    nowMs >= counter.windowStartedAtMs + RATE_WINDOW_MS
  )
    return counter;
  return { ...counter, count: Math.max(0, counter.count - 1) };
}

export function reservationExpired(input: {
  createdAtMs: number;
  nowMs: number;
  retentionMs: number;
}): boolean {
  return input.nowMs >= input.createdAtMs + input.retentionMs;
}
