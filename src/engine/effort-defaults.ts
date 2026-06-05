/**
 * Default LOC per Story Point rates for different language profiles.
 * (FR-017)
 */
export const DEFAULT_LOC_RATES: Record<string, number> = {
  TS: 50,
  Rust: 35,
  Python: 65,
  DE: 25, // Definitional Effort (Spec/Plan/Research)
};

/**
 * Resolves the LOC rate for a given language profile.
 * Falls back to TS default if profile is unknown.
 */
export function getLocRate(profile?: string): number {
  if (!profile) return DEFAULT_LOC_RATES.TS!;
  return DEFAULT_LOC_RATES[profile] || DEFAULT_LOC_RATES.TS!;
}
