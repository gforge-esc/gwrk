/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type { RoleConfig } from "./types.js";

export const DEFAULT_LOC_RATES: Record<string, number> = {
  TS: 50,
  Rust: 35,
  Python: 65,
  DE: 25,
};

export function getLocRate(profile: string): number {
  return DEFAULT_LOC_RATES[profile] ?? DEFAULT_LOC_RATES.TS ?? 50;
}

export const DEFAULT_ROLES: RoleConfig[] = [
  { role: "RE", roleName: "Rust / Engine Engineer", hoursPerSP: 6 },
  { role: "TS", roleName: "TS / Fullstack Developer", hoursPerSP: 4 },
  { role: "PM", roleName: "Product Manager", hoursPerSP: 2 },
  { role: "PE", roleName: "Principal Engineer", hoursPerSP: 1.5 },
  { role: "DE", roleName: "Data / Generator Engineer", hoursPerSP: 5 },
];

export function resolveRoleMultipliers(config: unknown): RoleConfig[] {
  const effort = (
    config as {
      effort?: { roles?: Record<string, Partial<RoleConfig>> };
    }
  )?.effort;
  const overrides = effort?.roles || {};

  return DEFAULT_ROLES.map((defaultRole) => {
    const override = overrides[defaultRole.role];
    if (override && typeof override.hoursPerSP === "number") {
      return {
        ...defaultRole,
        hoursPerSP: override.hoursPerSP,
      };
    }
    return defaultRole;
  }).sort((a, b) => a.role.localeCompare(b.role));
}
