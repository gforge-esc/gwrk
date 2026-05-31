import { describe, it, expect } from 'vitest';
import { listPluginsCommand } from './plugin.js';

describe('FR-010: Plugin Listing', () => {
  it('TR-P9-004: groups enforcement skills under their own tier', async () => {
    // Mock output capture or return value
    const output = await listPluginsCommand({ type: 'skills' });
    expect(output).toContain('Enforcement Skills');
    expect(output).toContain('typescript-standards');
  });
});
