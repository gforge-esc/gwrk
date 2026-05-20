import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DefineOrchestrator } from './define-orchestrator.js';

const { mockExecuteWorkflow } = vi.hoisted(() => ({
  mockExecuteWorkflow: vi.fn(),
}));

vi.mock('../plugins/workflow-runtime.js', () => ({
  WorkflowRuntime: class {
    executeWorkflow = mockExecuteWorkflow;
  },
}));

vi.mock('../utils/state.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/state.js")>();
  return {
    ...actual,
    loadTaskState: vi.fn().mockReturnValue({
      phases: [{ id: "phase-01", tasks: [] }]
    }),
  };
});

describe('DefineOrchestrator (FR-L25-003, FR-L25-004, US-013, TR-010)', () => {
  let orchestrator: DefineOrchestrator;

  beforeEach(() => {
    orchestrator = new DefineOrchestrator({
      featureId: 'test-feature',
      backend: 'gemini',
      cwd: process.cwd(),
    });
    
    mockExecuteWorkflow.mockReset();
    mockExecuteWorkflow.mockResolvedValue({
      summary: "Verdict: READY",
      intents: [],
      summaries: [],
    });
    
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('run (FR-L25-004, US-013, TR-010)', () => {
    it('TR-010: SHOULD transition through PLAN_TO_TASKS, ANALYZE, and DEFINE_TESTS', async () => {
      const exitCode = await orchestrator.run();
      
      expect(exitCode).toBe(0);
      expect(mockExecuteWorkflow).toHaveBeenCalledWith("gwrk-plan-to-tasks", expect.anything(), expect.objectContaining({ quiet: true }));
      expect(mockExecuteWorkflow).toHaveBeenCalledWith("gwrk-analyze", expect.anything(), expect.objectContaining({ quiet: true }));
      expect(mockExecuteWorkflow).toHaveBeenCalledWith("gwrk-define-tests", expect.anything(), expect.objectContaining({ quiet: true }));
    });

    it('US-026/FR-028: SHOULD pass quiet: true to all workflows (Phase 12) (RED)', async () => {
      await orchestrator.run();
      
      const calls = mockExecuteWorkflow.mock.calls;
      for (const call of calls) {
        expect(call[2]).toEqual(expect.objectContaining({ quiet: true }));
      }
    });

    it('FR-L25-003: SHOULD use WorkflowRuntime for all stage transitions', async () => {
      await orchestrator.run();
      expect(mockExecuteWorkflow).toHaveBeenCalled();
    });
  });
});
