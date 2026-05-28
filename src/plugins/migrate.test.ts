import { describe, it, expect, vi } from 'vitest';
/**
 * Module does not exist yet (RED)
 * TR-P11-003: migrate.ts Deprecation Warning
 */
// @ts-ignore - checkForLegacyAgents will be implemented in Phase 11
import { checkForLegacyAgents } from './migrate.js';

describe('FR-P11-003: migrate.ts Deprecation Warning', () => {
  it('TR-P11-003: should warn when .agents/ directory exists in target project', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    
    // This test ensures that the system detects legacy .agents/ directory
    // and advises the user to migrate.
    // It is expected to fail (RED) until checkForLegacyAgents is implemented and exported.
    await checkForLegacyAgents();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Deprecation: .agents/ directory detected')
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Run 'gwrk init' to migrate")
    );
    
    consoleSpy.mockRestore();
  });
});
