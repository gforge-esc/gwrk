import { describe, it, expect } from 'vitest';
// @ts-ignore - GwrkConfigSchema might not have the new fields yet
import { GwrkConfigSchema } from './config';

describe('Config Schema Extension (FR-032, TC-011)', () => {
  it('TR-033: maintains backward compatibility with legacy config (TC-011)', () => {
    const legacyConfig = {
      featurePrefix: 'TR',
      agents: { gemini: 'model-v1' }
    };
    const result = GwrkConfigSchema.safeParse(legacyConfig);
    expect(result.success).toBe(true);
  });

  it('FR-032: validates new project profile fields', () => {
    const newConfig = {
      project: {
        type: 'pnpm-monorepo',
        stack: {
          language: 'typescript',
          packageManager: 'pnpm',
          testFramework: 'vitest'
        },
        layout: 'standard-monorepo'
      }
    };
    const result = GwrkConfigSchema.safeParse(newConfig);
    expect(result.success).toBe(true);
    // @ts-ignore
    expect(result.data.project?.type).toBe('pnpm-monorepo');
  });

  it('FR-032: rejects invalid project.stack values', () => {
    const invalidConfig = {
      project: {
        stack: {
          language: 123 // Should be string
        }
      }
    };
    const result = GwrkConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});
