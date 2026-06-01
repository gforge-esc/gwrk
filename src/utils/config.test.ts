import { describe, it, expect } from 'vitest';
import { GwrkConfigSchema } from './config';

describe('Config Schema Extensions (FR-032, TC-011)', () => {
  it('should parse legacy .gwrkrc.json without profile (TC-011)', () => {
    const legacyConfig = {
      version: '1.0',
      featureDir: 'specs'
    };
    
    const result = GwrkConfigSchema.safeParse(legacyConfig);
    expect(result.success).toBe(true);
  });

  it('should parse new .gwrkrc.json with project profile (FR-032)', () => {
    const newConfig = {
      version: '1.0',
      project: {
        type: 'pnpm-monorepo',
        stack: {
          language: 'typescript',
          packageManager: 'pnpm'
        }
      }
    };
    
    const result = GwrkConfigSchema.safeParse(newConfig);
    expect(result.success).toBe(true);
  });

  it('should fail on invalid project profile values (FR-032 Error Path)', () => {
    const invalidConfig = {
      project: {
        type: 123
      }
    };
    
    const result = GwrkConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});
