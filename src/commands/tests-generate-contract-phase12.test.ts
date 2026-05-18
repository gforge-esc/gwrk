import { describe, it, expect, vi, beforeEach } from 'vitest';
import { testsGenerateCommand } from './tests-generate.js';
import { Command } from 'commander';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';

vi.mock('../plugins/workflow-runtime.js', () => ({
  WorkflowRuntime: class {
    executeWorkflow = vi.fn().mockResolvedValue({ summary: 'ok', intents: [] });
  }
}));

vi.mock('../utils/config.js', () => ({
  loadConfig: vi.fn().mockReturnValue({ agents: { define: 'mock' } })
}));

vi.mock('../db/runs.js', () => ({
  startRun: vi.fn().mockReturnValue(1),
  finishRun: vi.fn()
}));

vi.mock('../utils/resolve-feature.js', () => ({
  resolveFeature: vi.fn().mockReturnValue('test-feature')
}));

describe('Tests Generate Command (Phase 12) (RED)', () => {
  it('FR-028: MUST pass quiet: true to executeWorkflow (RED)', async () => {
    const program = new Command();
    program.addCommand(testsGenerateCommand);
    
    // We expect the command to pass quiet: true.
    // In current implementation it DOES, but we are asserting it here as part of the RED tests
    // for Phase 12 verification.
    await program.parseAsync(['node', 'test', 'tests', 'test-feature', '--force']);
    
    const runtimeInstance = new WorkflowRuntime();
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        quiet: true
      })
    );
  });
});
