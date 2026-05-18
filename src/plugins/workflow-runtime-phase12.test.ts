import { describe, it, expect } from 'vitest';
import { WorkflowRuntime } from './workflow-runtime.js';

describe('WorkflowRuntime (Phase 12)', () => {
  describe('FR-029: Tolerant JSON extraction', () => {
    it('SHOULD return synthetic success when agent returns prose but commits artifacts natively', async () => {
      // RED TEST: This asserts the behavior before implementation.
      // Once implemented, the runtime should detect native work even if JSON extraction fails.
      const runtime = new WorkflowRuntime();
      const result = await runtime.executeWorkflow('dummy', 'input');
      expect(result.exitCode).toBe(0);
      expect(result.intents).toEqual([]);
      // Force failure until implemented
      expect(true).toBe(false);
    });
  });
});
