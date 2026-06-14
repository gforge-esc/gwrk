/**
 * Module does not exist yet (RED)
 */
import { describe, it, expect, vi } from 'vitest';
import { computeEffort, runEffortCLI } from './effort.js';
import { resolveRoleMultipliers } from './roles.js';
import * as fs from 'node:fs';

describe('Effort Engine', () => {
  describe('FR-002: Hour Computation', () => {
    it('TR-002: US-001 - computes 5 SP × TS(4h) = 20h raw, 25h with 1.25× overhead', () => {
      const stories: any[] = [{ storyId: 'US-001', sp: 5, roles: ['TS'] }];
      const multipliers: any[] = [{ role: 'TS', roleName: 'Test', hoursPerSP: 4 }];
      const result = computeEffort(stories, multipliers);
      
      expect(result.totalRawHours).toBe(20);
      expect(result.totalWithOverhead).toBe(25);
    });
  });

  describe('FR-012: Role Multiplier Configuration', () => {
    it('TR-013: US-008 - uses config override for TS multiplier', () => {
      const config = { effort: { roles: { TS: { hoursPerSP: 6 } } } };
      const multipliers = resolveRoleMultipliers(config as any);
      const ts = multipliers.find(m => m.role === 'TS');
      expect(ts?.hoursPerSP).toBe(6);
    });
  });

  describe('FR-004: Error States', () => {
    it('TR-004: US-002 - fail-fast on missing spec.md', async () => {
      await expect(runEffortCLI('nonexistent-feature')).rejects.toThrow();
    });
  });

  describe('FR-003: Report Generation', () => {
    it('TR-003: US-001 - report file is created in docs/assessments/', async () => {
      await runEffortCLI('001-cli-core');
      const files = fs.readdirSync('docs/assessments/');
      const report = files.find(f => f.startsWith('effort-001-cli-core-'));
      expect(report).toBeDefined();
    });
  });
});
