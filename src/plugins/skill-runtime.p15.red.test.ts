import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEnforcementSkills } from './skill-runtime.js';
import * as fsp from 'node:fs/promises';
import { PluginLoader } from './loader.js';

// Module does not exist yet (RED)

vi.mock('node:fs/promises');
vi.mock('./loader.js');

describe('FR-014 / US-016: resolveEnforcementSkills Phase 15 RED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FR-014: filters builtin enforcement skills by framework', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'react-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'react-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', language: 'TypeScript', framework: 'React' } as any,
      path: '/gwrk/src/plugins/builtins/skills/react-standards', // Builtin path
      status: 'active'
    });

    // Mismatch framework: Vue vs React
    const skills = await resolveEnforcementSkills('/fake/root', 'all', {
      type: 'nodejs',
      stack: { language: 'TypeScript', framework: 'Vue' },
    } as any);

    // Should fail (RED) because framework filtering is not yet implemented
    expect(skills).not.toContain('react-standards');
  });

  it('R007: project-local enforcement skills always load even if language mismatches', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'local-ts-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'local-ts-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', language: 'TypeScript' } as any,
      path: '/project/.gwrk/plugins/skills/local-ts-standards', // Project-local path
      status: 'active'
    });
    vi.mocked(fsp.readFile).mockResolvedValue('# Local TS Standards');

    const skills = await resolveEnforcementSkills('/project', 'all', {
      type: 'python',
      stack: { language: 'Python' },
    } as any);

    // Should fail (RED) because current code filters everything with a language mismatch
    expect(skills).toContain('Local TS Standards');
  });

  it('R007: global (non-builtin) enforcement skills always load (for now)', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'custom-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'custom-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', language: 'Go' } as any,
      path: '/Users/user/.gwrk/plugins/skills/custom-standards', // Global path
      status: 'active'
    });
    vi.mocked(fsp.readFile).mockResolvedValue('# Custom Go Standards');

    const skills = await resolveEnforcementSkills('/fake/root', 'all', {
      type: 'python',
      stack: { language: 'Python' },
    } as any);

    // R007: Only filter builtins.
    // Should fail (RED) because current code filters everything with a language mismatch
    expect(skills).toContain('Custom Go Standards');
  });
});
