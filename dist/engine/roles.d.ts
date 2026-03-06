import type { GwrkConfig } from "../utils/config.js";
import type { RoleConfig } from "./types.js";
/**
 * Resolves role multipliers, combining defaults with any overrides in GwrkConfig.
 */
export declare function resolveRoleMultipliers(config: GwrkConfig): RoleConfig[];
