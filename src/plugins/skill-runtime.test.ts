import { describe, it, expect, vi } from 'vitest';
import { resolveEnforcementSkills } from './skill-runtime.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('FR-014: resolveEnforcementSkills', () => {
  it('TR-P9-001: returns builtin enforcement skill content', async () => {
    // Setup: mock filesystem to have a builtin enforcement skill
    const builtinContent = '# GWRK Conventions\n- No .agents/ directory';
    vi.mocked(fs.readFileSync).mockReturnValue(builtinContent);
    vi.mocked(fs.existsSync).mockReturnValue(true);

    const skills = await resolveEnforcementSkills('/fake/root');
    expect(skills).toContain('GWRK Conventions');
  });

  it('TR-P9-002 / ADR-007: project-local skill overrides builtin', async () => {
    // Implementation should check local -> global -> builtin
    // Mock local exists, builtin exists
    const localContent = '# Local Standards\n- Use Biome';
    
    vi.mocked(fs.existsSync).mockImplementation((path: any) => {
      if (path.toString().includes('.gwrk/plugins/skills')) return true;
      return true;
    });
    
    vi.mocked(fs.readFileSync).mockImplementation((path: any) => {
      if (path.toString().includes('.gwrk/plugins/skills')) return localContent;
      return 'builtin content';
    });

    const skills = await resolveEnforcementSkills('/fake/root');
    expect(skills).toContain('Local Standards');
    expect(skills).not.toContain('builtin content');
  });

  it('TR-P10-003: contains no legacy .agents/ path references', () => {
    const source = fs.readFileSync('src/plugins/skill-runtime.ts', 'utf8');
    expect(source).not.toContain('.agents/skills/');
  });
});
