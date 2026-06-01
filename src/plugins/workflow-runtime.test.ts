import { describe, it, expect, vi } from 'vitest';
import { WorkflowRuntime } from './workflow-runtime.js';

describe('FR-029: WorkflowRuntime tolerant JSON extraction', () => {
  it('US-026: should return synthetic success if extraction fails but artifacts are committed', async () => {
    const runtime = new WorkflowRuntime();
    vi.spyOn(runtime as any, 'extractJsonFromOutput').mockImplementation(() => {
      throw new Error('Expected JSON object in agent output');
    });
    vi.spyOn(runtime as any, 'hasCommittedArtifacts').mockResolvedValue(true);
    
    const result = await runtime.executeWorkflow({
      agent: 'generalist',
      prompt: 'Do something',
      quiet: true,
      tolerant: true
    });
    
    expect(result.success).toBe(true);
    expect((result as any).synthetic).toBe(true);
  });

  it('US-026: should throw error if extraction fails and no artifacts are committed', async () => {
    const runtime = new WorkflowRuntime();
    vi.spyOn(runtime as any, 'extractJsonFromOutput').mockImplementation(() => {
      throw new Error('Expected JSON object in agent output');
    });
    vi.spyOn(runtime as any, 'hasCommittedArtifacts').mockResolvedValue(false);
    
    await expect(runtime.executeWorkflow({
      agent: 'generalist',
      prompt: 'Do something',
      quiet: true,
      tolerant: true
    })).rejects.toThrow('Expected JSON object');
  });
});
