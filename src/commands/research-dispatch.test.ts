/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

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

// Mock config + model resolution — research now resolves the configured
// agent (agents.define) and its model rather than defaulting to gemini.
vi.mock('../utils/config.js', () => ({
  loadConfig: vi.fn(() => ({ agents: { define: 'claude' } })),
}));
vi.mock('../utils/resolve-model.js', () => ({
  resolveModelForTask: vi.fn(() => 'claude-opus-4-8'),
}));

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
      expect.stringContaining('Test objective'),
      expect.objectContaining({ agent: 'claude', model: 'claude-opus-4-8' })
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
      expect.anything(),
      expect.objectContaining({ agent: 'claude' })
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
      expect.anything(),
      expect.objectContaining({ agent: 'claude' })
    );
  });

  it('passes the configured define agent (not the gemini default) to the workflow', async () => {
    await researchCommandHandler({
      initiative: 'test-initiative',
      methodology: 'technical',
      run: true,
    });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;
    const callArgs = runtimeInstance.executeWorkflow.mock.calls[0];
    expect(callArgs[2]).toEqual({ agent: 'claude', model: 'claude-opus-4-8' });
  });

  it('resolves methodology from brief frontmatter when no --methodology flag', async () => {
    (fsPromises.readFile as any).mockResolvedValue(
      '---\nmethodology: jtbd\n---\n# Brief\n## Objective\nSomething',
    );

    await researchCommandHandler({ initiative: 'test-initiative', run: true });

    const WorkflowRuntimeMock = WorkflowRuntime as any;
    const runtimeInstance = WorkflowRuntimeMock.mock.results[0].value;
    expect(runtimeInstance.executeWorkflow).toHaveBeenCalledWith(
      'gwrk-research-jtbd',
      expect.anything(),
      expect.objectContaining({ agent: 'claude' }),
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
