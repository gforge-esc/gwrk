/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type {
  EffortReport,
  RoleBreakdown,
  RoleConfig,
  StoryEstimate,
} from "./types.js";

/**
 * Computes effort for a set of parsed stories given role multipliers and overhead.
 */
export function computeEffort(
  stories: StoryEstimate[],
  roleMultipliers: RoleConfig[],
  overheadFactor = 1.25,
): EffortReport {
  let totalSP = 0;
  let totalRawHours = 0;
  let totalWithOverhead = 0;

  const roleMap: Record<string, RoleBreakdown> = {};

  // Initialize role map from provided multipliers
  for (const rc of roleMultipliers) {
    roleMap[rc.role] = {
      role: rc.role,
      roleName: rc.roleName,
      hoursPerSP: rc.hoursPerSP,
      spAssigned: 0,
      rawHours: 0,
      withOverhead: 0,
      days: 0,
    };
  }

  // Calculate per-story and aggregate per-role
  for (const story of stories) {
    totalSP += story.sp;

    let storyRawHours = 0;
    let storyRolesProcessed = 0;

    for (const roleCode of story.roles) {
      const rBreakdown = roleMap[roleCode];
      if (rBreakdown) {
        const hours = story.sp * rBreakdown.hoursPerSP;
        rBreakdown.spAssigned += story.sp;
        rBreakdown.rawHours += hours;

        storyRawHours += hours;
        storyRolesProcessed++;
      }
    }

    story.rawHours = storyRawHours;
    story.withOverhead = Number((storyRawHours * overheadFactor).toFixed(2));

    totalRawHours += storyRawHours;
  }

  totalWithOverhead = Number((totalRawHours * overheadFactor).toFixed(2));

  // Finalize role breakdowns
  const rolesBreakdownArray: RoleBreakdown[] = [];
  for (const roleCode of Object.keys(roleMap)) {
    const rb = roleMap[roleCode];
    if (rb) {
      rb.withOverhead = Number((rb.rawHours * overheadFactor).toFixed(2));
      rb.days = Number((rb.withOverhead / 8).toFixed(2));
      if (rb.spAssigned > 0) {
        rolesBreakdownArray.push(rb);
      }
    }
  }

  // Sort breakdown array by SP assigned (desc), then alphabetic
  rolesBreakdownArray.sort((a, b) => {
    if (b.spAssigned !== a.spAssigned) return b.spAssigned - a.spAssigned;
    return a.role.localeCompare(b.role);
  });

  return {
    featureId: "unknown", // To be injected by caller
    generatedAt: new Date().toISOString(),
    totalSP,
    overheadFactor,
    roles: rolesBreakdownArray,
    stories,
    totalRawHours,
    totalWithOverhead,
    totalDays: totalWithOverhead / 8,
  };
}

export const runEffortCLI = async (featureId: string): Promise<void> => {
  throw new Error('Not implemented');
};
