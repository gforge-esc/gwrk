import type { EffortReport, RoleConfig, StoryEstimate } from "./types.js";
/**
 * Computes effort for a set of parsed stories given role multipliers and overhead.
 */
export declare function computeEffort(stories: StoryEstimate[], roleMultipliers: RoleConfig[], overheadFactor?: number): EffortReport;
