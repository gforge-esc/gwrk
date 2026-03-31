import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WorkflowRuntime } from './workflow-runtime.js';
import { WorkflowManifest } from './manifest.js';

/**
 * RED TESTS: Phase 4 - WorkflowRuntime (Layer 2.5 - F014-R)
 * 
 * Requirements addressed: 
 * FR-L25-001, FR-L25-006, FR-L25-007, US-011, US-015
 */

describe('WorkflowRuntime (FR-L25-001, FR-L25-006, FR-L25-007)', () => {
  let runtime: WorkflowRuntime;

  beforeEach(() => {
    // WorkflowRuntime doesn't exist yet, so this will fail to compile (ideal RED state)
    runtime = new WorkflowRuntime();
    vi.clearAllMocks();
  });

  describe('resolveWorkflow (FR-L25-006, US-015)', () => {
    it('US-015: SHOULD prioritize project-local overrides over global built-ins', async () => {
      // Mock resolution logic
      const manifest = await runtime.resolveWorkflow('gwrk-specify', '/tmp/project');
      
      // Should find the one in .gwrk/plugins/workflows/gwrk-specify
      expect(manifest.name).toBe('gwrk-specify');
      // We'd expect some indicator of source path or similar if available in manifest
    });

    it('FR-L25-006: SHOULD fallback to global built-ins if local override is missing', async () => {
      const manifest = await runtime.resolveWorkflow('gwrk-plan', '/tmp/empty-project');
      expect(manifest.name).toBe('gwrk-plan');
    });

    it('FR-L25-001: SHOULD throw WorkflowNotFoundError if workflow cannot be resolved', async () => {
      await expect(runtime.resolveWorkflow('nonexistent-workflow'))
        .rejects.toThrow('Workflow \'nonexistent-workflow\' not found');
    });
  });

  describe('executeWorkflow (FR-L25-001, FR-L25-007, US-011)', () => {
    it('US-011: SHOULD execute a built-in workflow and return valid intents', async () => {
      const result = await runtime.executeWorkflow('gwrk-specify', 'Implement a new feature');
      
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.intents)).toBe(true);
      expect(result.intents.length).toBeGreaterThan(0);
    });

    it('FR-L25-001: SHOULD validate agent output against the workflow\'s outputSchema', async () => {
      // Mock agent returning invalid JSON
      // This test would likely require mocking the agent backend or a lower-level service
      // For now, we assert the behavior of catching schema violations
      
      // Expected: Workflow output failed schema constraint: Expected JSON object.
      await expect(runtime.executeWorkflow('gwrk-specify', 'invalid-output'))
        .rejects.toThrow(/Workflow output failed schema constraint/);
    });

    it('FR-L25-007: SHOULD support multi-action intents from a single turn', async () => {
      const result = await runtime.executeWorkflow('gwrk-plan', 'Create a plan with multiple files');
      
      // Should have multiple intents if the agent returned them
      expect(result.intents.length).toBeGreaterThan(1);
    });

    it('FR-L25-001: SHOULD catch attempted direct FS edits by agents and exit 1', async () => {
      // If the agent tries to use a raw shell command to write files instead of the intent engine
      // The runtime should detect this (likely via prompt engineering or output parsing)
      
      // Expected: Workflow execution violation: Use WRITE_FILE JSON intent only.
      await expect(runtime.executeWorkflow('gwrk-implement', 'attempt-direct-fs-edit'))
        .rejects.toThrow(/Workflow execution violation: Use WRITE_FILE JSON intent only/);
    });
  });
});
