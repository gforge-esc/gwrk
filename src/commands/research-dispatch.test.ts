/**
 * @phase 12
 * @feature 014-plugin-system
 * @status red
 */
import { describe, it, expect, vi } from 'vitest';
import * as researchCmd from './research.js';
import { WorkflowRuntime } from '../engine/WorkflowRuntime.js';

// Mock WorkflowRuntime to avoid real execution during test
vi.mock('../engine/WorkflowRuntime.js', () => {
  return {
    WorkflowRuntime: vi.fn().mockImplementation(() => ({
      execute: vi.fn().mockImplementation(async (methodology) => {
        if (methodology === 'unknown') {
          throw new Error("Workflow 'unknown' not found.");
        }
        if (methodology === 'bad-json') {
          throw new Error("Workflow output failed schema constraint: Expected JSON object.");
        }
        if (methodology === 'fs-edit') {
          throw new Error("Workflow execution violation: Use WRITE_FILE JSON intent only.");
        }
        return { success: true };
      })
    }))
  };
});

describe.skip('FR-R006-002: Methodology Dispatch (--run)', () => {
  it('US-018: Executes research workflow using methodology from frontmatter', async () => {
    const runtimeSpy = vi.spyOn(WorkflowRuntime.prototype, 'execute');
    
    if (!('handler' in researchCmd)) {
      throw new Error("Target module missing 'handler' export");
    }

    await (researchCmd as any).handler({ initiative: 'R008', run: true, methodology: 'gwrk-research-technical' });
    
    expect(runtimeSpy).toHaveBeenCalled();
  });

  it('FR-L25-001: Exits with error when Workflow not found', async () => {
    if (!('handler' in researchCmd)) {
      throw new Error("Target module missing 'handler' export");
    }
    
    await expect(
      (researchCmd as any).handler({ initiative: 'R008', run: true, methodology: 'unknown' })
    ).rejects.toThrow("Workflow 'unknown' not found.");
  });

  it('FR-L25-001: Exits with error on Invalid JSON Intent', async () => {
    if (!('handler' in researchCmd)) {
      throw new Error("Target module missing 'handler' export");
    }
    
    await expect(
      (researchCmd as any).handler({ initiative: 'R008', run: true, methodology: 'bad-json' })
    ).rejects.toThrow("Workflow output failed schema constraint: Expected JSON object.");
  });

  it('FR-L25-001: Exits with error on Attempted direct FS edit', async () => {
    if (!('handler' in researchCmd)) {
      throw new Error("Target module missing 'handler' export");
    }
    
    await expect(
      (researchCmd as any).handler({ initiative: 'R008', run: true, methodology: 'fs-edit' })
    ).rejects.toThrow("Workflow execution violation: Use WRITE_FILE JSON intent only.");
  });
});
