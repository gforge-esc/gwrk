import { describe, it, expect } from 'vitest';
import { PluginLoader } from './loader.js';

describe('FR-L25-003 / TC-011: Zero-Dependency Builtin Workflows', () => {
  it('TR-P10-002: resolves all 15 gwrk-* workflows from builtins', async () => {
    const loader = new PluginLoader();
    const workflows = await loader.listPlugins('workflow');
    
    const required = [
      'gwrk-analyze', 'gwrk-build-plan', 'gwrk-cascade-sync', 
      'gwrk-checklist', 'gwrk-constitution', 'gwrk-define-tests', 
      'gwrk-effort', 'gwrk-implement', 'gwrk-plan-to-tasks', 
      'gwrk-research', 'gwrk-review-code', 'gwrk-review-uat',
      'gwrk-specify', 'gwrk-plan', 'gwrk-tasks'
    ];

    required.forEach(name => {
      const found = workflows.find(w => w.name === name);
      expect(found).toBeDefined();
      expect(found?.path).toContain('builtins/workflows');
    });
  });
});
