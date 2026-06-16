/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Compiled-in profile-keyed LOC rates (FR-017).
 * Defines how many Lines of Code equal 1 Story Point for a given profile.
 */
export const DEFAULT_LOC_RATES: Record<string, number> = {
  TS: 50,
  Rust: 35,
  Python: 65,
  DE: 25, // Definitional Effort (specs, plans)
};

/**
 * Safely retrieves the LOC rate for a profile with a fallback to TS (FR-017).
 */
export function getLocRate(profile: string): number {
  return DEFAULT_LOC_RATES[profile] ?? DEFAULT_LOC_RATES.TS ?? 50;
}
