import { describe, it, expect, vi, beforeEach } from 'vitest';
import { researchCommandHandler } from './research.js';
import { ResearchScaffolder } from '../engine/research-scaffold.js';
import { WorkflowRuntime } from '../plugins/workflow-runtime.js';
import * as fsPromises from 'node:fs/promises';

vi.mock('node:fs/promises');

// Mock ResearchScaffolder
vi.mock('../engine/research-scaffold.js', () => {
  return {
    ResearchScaffolder: vi.fn().mockImplementation(() => {
      return {
        scaffold: vi.fn().mockResolvedValue({
          directory: 'docs/research/R001-test-initiative',
          number: 1
        }),
        resolveByPrefix: vi.fn().mockResolvedValue({
          directory: 'docs/research/R001-test-initiative',
        }),
      };
    })
  };
});

// Mock WorkflowRuntime
vi.mock('../plugins/workflow-runtime.js', () => {
  return {
    WorkflowRuntime: vi.fn().mockImplementation(() => {
      return {
        executeWorkflow: vi.fn().mockResolvedValue({
          summary: 'Mock research report generated.',
          intents: [],
          summaries: [],
          logPath: '/tmp/fake.log',
        })
      };
    })
  };
});

describe('Research Command Dispatch (TR-P12-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock brief.md read — the implementation now reads this
    (fsPromises.readFile as any).mockResolvedValue('# Test Brief\n## Objective\nTest objective');
  });

  it('TR-P12-001: dispatches methodology plugin to WorkflowRuntime when --run is present', async () => {
    const result = await researchCommandHandler({
      initiative: 'test-initiative',
      methodology: 'technical',
      run: true
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;
    
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      'gwrk-research-technical',
      expect.stringContaining('Test objective')
    );

    // Output now shows directory and log path
    expect(result).toContain('Research:');
  });

  it('TR-P12-001: defaults to technical methodology if none provided with --run', async () => {
    await researchCommandHandler({
      initiative: 'test-initiative',
      run: true
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;
    
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      'gwrk-research-technical',
      expect.anything()
    );
  });

  it('TR-P12-001: dispatches custom methodology when provided with --run', async () => {
    await researchCommandHandler({
      initiative: 'test-initiative',
      methodology: 'jtbd',
      run: true
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;
    
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      'gwrk-research-jtbd',
      expect.anything()
    );
  });

  it('TR-P12-001: does NOT dispatch to WorkflowRuntime if --run is absent', async () => {
    const result = await researchCommandHandler({
      initiative: 'test-initiative'
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    expect(WorkflowRuntimeMock).not.toHaveBeenCalled();
    expect(result).not.toContain('Methodology execution complete');
  });
});
