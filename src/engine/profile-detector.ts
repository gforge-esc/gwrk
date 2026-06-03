export interface Toolchain {
  primary?: string;
  formatter?: string;
  test?: string;
}

/**
 * FR-015: Detects project toolchains from filesystem signals.
 * TC-015: Zero-cost (filesystem only, no network).
 */
export async function detectToolchain(root: string): Promise<Toolchain> {
  // DM-007: toolchain entity shape
  throw new Error('Not implemented');
}