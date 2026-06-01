import { describe, it, expect } from 'vitest';
import { GwrkConfigSchema } from './config';

describe('Config Schema Extension (FR-032, TC-011)', () => {
  it('TR-033: maintains backward compatibility with legacy config (TC-011)', () => {
    const legacyConfig = {
      project: {
        name: 'test-project'
      },
      agents: {
        define: 'gemini',
        implement: 'gemini'
      }
    };
    const result = GwrkConfigSchema.safeParse(legacyConfig);
    if (!result.success) {
      console.error(result.error);
    }
    expect(result.success).toBe(true);
  });

  it('FR-032: validates new project profile fields', () => {
    const newConfig = {
      project: {
        name: 'test-project',
        type: 'pnpm-monorepo',
        stack: {
          language: 'typescript',
          buildSystem: 'pnpm',
          testFramework: 'vitest',
          packageManager: 'pnpm'
        },
        layout: {
          sourceRoot: 'src/',
          apps: 'apps/',
          packages: 'packages/'
        },
        architecture: {
          doc: 'docs/architecture.md'
        },
        conventions: {
          branchPrefix: 'feat/'
        }
      },
      agents: {
        define: 'gemini',
        implement: 'gemini'
      }
    };
    const result = GwrkConfigSchema.safeParse(newConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project?.type).toBe('pnpm-monorepo');
      expect(result.data.project?.stack?.testFramework).toBe('vitest');
      expect(result.data.project?.layout?.sourceRoot).toBe('src/');
    }
  });

  it('FR-032: rejects invalid project.stack values', () => {
    const invalidConfig = {
      project: {
        name: 'test-project',
        stack: {
          language: 123 // Should be string
        }
      }
    };
    const result = GwrkConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});
