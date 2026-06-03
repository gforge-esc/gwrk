import { describe, it, expect } from 'vitest';
// @ts-ignore - Function and schema might need updates (RED)
import { resolveEffortConfig, GwrkConfigSchema } from './config.js';

describe('FR-017: Three-layer Config Resolution', () => {
  it('should resolve using internal defaults when no config is provided', () => {
    const config = resolveEffortConfig({}, {});
    expect(config.rates['TS']).toBe(50);
  });

  it('should allow profile-level overrides', () => {
    const userConfig = {
      effort: {
        profile: 'high-velocity',
        profiles: {
          'high-velocity': { TS: 30 }
        }
      }
    };
    const config = resolveEffortConfig(userConfig, {});
    expect(config.rates['TS']).toBe(30);
  });

  it('should allow explicit overrides to trump profiles', () => {
    const userConfig = {
      effort: {
        profile: 'standard',
        rates: { TS: 25 }
      }
    };
    const config = resolveEffortConfig(userConfig, { rates: { TS: 10 } });
    expect(config.rates['TS']).toBe(10);
  });

  it('TC-003: should validate effort section in GwrkConfigSchema', () => {
    const validEffort = {
      effort: {
        profile: 'default',
        rates: { TS: 50 }
      }
    };
    // DM-001: Effort profile schema verification
    expect(() => GwrkConfigSchema.parse(validEffort)).not.toThrow();
  });

  it('should throw error for invalid effort rate types', () => {
    const invalidEffort = {
      effort: {
        rates: { TS: 'fast' } // Should be number
      }
    };
    expect(() => GwrkConfigSchema.parse(invalidEffort)).toThrow();
  });
});
