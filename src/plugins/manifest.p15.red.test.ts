import { describe, it, expect } from 'vitest';
import { SkillManifestSchema } from './manifest.js';

// Module does not exist yet (RED)

describe('FR-014 / US-016: SkillManifestSchema Phase 15 RED', () => {
  it('FR-014: accepts language and framework fields', () => {
    const manifest = {
      name: 'react-ts-standards',
      type: 'skill',
      tier: 'enforcement',
      version: '1.0.0',
      description: 'React TS standards',
      language: 'TypeScript',
      framework: 'React'
    };
    
    // This will fail (RED) because EnforcementSkillManifestSchema is missing 'framework' field
    const result = SkillManifestSchema.parse(manifest);
    expect((result as any).language).toBe('TypeScript');
    expect((result as any).framework).toBe('React');
  });
});
