import { describe, it, expect } from 'vitest';
import { SkillManifestSchema } from './manifest.js';

describe('FR-013 / US-016: SkillManifestSchema Enforcement Tier', () => {
  it('TR-P9-003: accepts tier: enforcement and scope: implementation', () => {
    const manifest = {
      name: 'typescript-standards',
      type: 'skill',
      tier: 'enforcement',
      scope: 'implementation',
      version: '1.0.0',
      description: 'Strict TypeScript enforcement'
    };
    
    const result = SkillManifestSchema.parse(manifest);
    expect(result.tier).toBe('enforcement');
    expect(result.scope).toBe('implementation');
  });

  it('rejects invalid scope for enforcement skills', () => {
    const manifest = {
      name: 'bad-skill',
      type: 'skill',
      tier: 'enforcement',
      scope: 'invalid-scope',
      version: '1.0.0'
    };
    
    expect(() => SkillManifestSchema.parse(manifest)).toThrow();
  });
});
