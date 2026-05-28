import { describe, it, expect, vi } from 'vitest';
// @ts-ignore - Testing future export and behavior
import { checkForLegacyAgents } from './migrate.js';

describe('FR-P11-003: migrate.ts', () => {
  it('TR-P11-003: should warn when .agents/ directory exists in target project', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    // In Phase 11, checkForLegacyAgents should emit a deprecation warning
    // advising the user to run 'gwrk init' if .agents/ is detected.
    // Since implementation hasn't happened yet, this assertion will fail if the warning is missing.
    await checkForLegacyAgents();
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Deprecation: .agents/ directory detected'));
    consoleSpy.mockRestore();
  });
});
