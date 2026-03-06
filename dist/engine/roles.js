const DEFAULT_ROLES = [
    { role: "RE", roleName: "Rust / Engine Engineer", hoursPerSP: 6 },
    { role: "TS", roleName: "TS / Fullstack Developer", hoursPerSP: 4 },
    { role: "PM", roleName: "Product Manager", hoursPerSP: 2 },
    { role: "PE", roleName: "Principal Engineer", hoursPerSP: 1.5 },
    { role: "DE", roleName: "Data / Generator Engineer", hoursPerSP: 5 },
];
/**
 * Resolves role multipliers, combining defaults with any overrides in GwrkConfig.
 */
export function resolveRoleMultipliers(config) {
    // We need to merge config.effort.roles with DEFAULT_ROLES
    // Since config.effort is not strictly typed yet, we use type assertion
    const overrides = config.effort?.roles || {};
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
