import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEnforcementSkills } from './skill-runtime.js';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import { PluginLoader } from './loader.js';

vi.mock('node:fs');
vi.mock('node:fs/promises');
vi.mock('./loader.js');
vi.mock('../engine/router.js');
vi.mock('../utils/agent.js');

describe('FR-014: resolveEnforcementSkills', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TR-P9-001: returns builtin enforcement skill content', async () => {
    // Setup: mock PluginLoader to return an enforcement skill
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'gwrk-conventions', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'gwrk-conventions', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc' },
      path: '/fake/path/gwrk-conventions',
      status: 'active'
    });

    const builtinContent = '# GWRK Conventions\n- No .agents/ directory';
    vi.mocked(fsp.readFile).mockResolvedValue(builtinContent);

    const skills = await resolveEnforcementSkills('/fake/root');
    expect(skills).toContain('GWRK Conventions');
  });

  it('TR-P9-002 / ADR-007: project-local skill overrides builtin', async () => {
    // Setup: mock PluginLoader to return an enforcement skill
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    
    // resolvePlugin should return the local one if available (PluginLoader handles this, so we just mock its return)
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc' },
      path: '/project/local/path/typescript-standards',
      status: 'active'
    });

    const localContent = '# Local Standards\n- Use Biome';
    vi.mocked(fsp.readFile).mockResolvedValue(localContent);

    const skills = await resolveEnforcementSkills('/fake/root');
    expect(skills).toContain('Local Standards');
  });

  it('R007: skips enforcement skill when language does not match profile', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', language: 'TypeScript' },
      path: '/fake/builtins/skills/typescript-standards',
      status: 'active'
    });
    vi.mocked(fsp.readFile).mockResolvedValue('# TypeScript Standards');

    const skills = await resolveEnforcementSkills('/fake/root', 'all', {
      type: 'python',
      stack: { language: 'Python' },
    });

    expect(skills).not.toContain('TypeScript Standards');
    expect(skills).toBe('');
  });

  it('R007: loads enforcement skill when language matches profile', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'typescript-standards', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', language: 'TypeScript' },
      path: '/fake/builtins/skills/typescript-standards',
      status: 'active'
    });
    vi.mocked(fsp.readFile).mockResolvedValue('# TypeScript Standards');

    const skills = await resolveEnforcementSkills('/fake/root', 'all', {
      type: 'nodejs',
      stack: { language: 'TypeScript' },
    });

    expect(skills).toContain('TypeScript Standards');
  });

  it('R007: loads enforcement skill with no language field for all profiles', async () => {
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([
      { name: 'gwrk-conventions', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc', status: 'active' }
    ]);
    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: { name: 'gwrk-conventions', type: 'skill', tier: 'enforcement', version: '1.0.0', description: 'desc' },
      path: '/fake/path/gwrk-conventions',
      status: 'active'
    });
    vi.mocked(fsp.readFile).mockResolvedValue('# GWRK Conventions');

    const skills = await resolveEnforcementSkills('/fake/root', 'all', {
      type: 'python',
      stack: { language: 'Python' },
    });

    expect(skills).toContain('GWRK Conventions');
  });

  it('TR-P10-003: contains no legacy .agents/ path references', async () => {
    const realFs = await vi.importActual<typeof import('node:fs')>('node:fs');
    const source = realFs.readFileSync('src/plugins/skill-runtime.ts', 'utf8');
    expect(source).not.toContain('.agents/skills/');
    expect(source.match(/\.agents\//g)).toBeNull();
  });

  it('FR-006: executeSkill passes preferredAgent and preferredModel to router and agent', async () => {
    const { executeSkill } = await import('./skill-runtime.js');
    const { selectBackend } = await import('../engine/router.js');
    const { dispatchToAgent } = await import('../utils/agent.js');

    vi.mocked(PluginLoader.prototype.resolvePlugin).mockResolvedValue({
      manifest: {
        name: 'test-skill',
        type: 'skill',
        tier: 'atomic',
        version: '1.0.0',
        description: 'desc',
        prompt: 'test prompt',
        runtime: {
          preferredAgent: 'claude',
          preferredModel: 'claude-3-opus'
        }
      },
      path: '/fake/path/test-skill',
      status: 'active'
    });

    vi.mocked(selectBackend).mockResolvedValue({ name: 'claude' } as any);
    vi.mocked(dispatchToAgent).mockResolvedValue({
      stdout: 'done',
      stderr: '',
      exitCode: 0,
      durationS: 1
    } as any);

    await executeSkill('test-skill');

    expect(selectBackend).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAgent: 'claude' }),
      expect.any(String),
      expect.any(Object)
    );

    expect(dispatchToAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'claude', model: 'claude-3-opus' })
    );
  });
});
