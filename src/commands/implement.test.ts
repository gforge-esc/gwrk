import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePhase } from './implement';
import * as state from '../utils/state';
import * as agent from '../utils/agent';
import * as branch from '../utils/branch';
import * as config from '../utils/config';
import * as wudState from '../utils/wud-state';
import * as log from '../utils/log';
import * as exec from '../utils/exec';
import { execFile } from 'node:child_process';

vi.mock('../utils/state');
vi.mock('../utils/agent');
vi.mock('../utils/branch');
vi.mock('../utils/config');
vi.mock('../utils/wud-state');
vi.mock('../utils/log');
vi.mock('../utils/exec');
vi.mock('node:child_process');

describe('FR-001: Implement Command Task Loop', () => {
  const mockConfig: config.GwrkConfig = {
    project: { name: 'test-project' },
    agents: {
      define: 'gemini',
      implement: 'gemini',
    }
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-001 Scenario 1: executes all tasks in phase sequentially', async () => {
    const featureDir = 'specs/004-wud-loop';
    const phaseNumber = 1;

    // Mock loading tasks
    const mockTasks = [
      { id: 'T001', status: 'open', phase: 'phase-01', gateScript: 'gates/T001-gate.sh' },
      { id: 'T002', status: 'open', phase: 'phase-01', gateScript: 'gates/T002-gate.sh' },
    ];
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [{ id: 'phase-01', tasks: mockTasks as any }]
    } as any);
    
    // Mock sequential task fetching
    vi.mocked(state.nextTask)
      .mockReturnValueOnce(mockTasks[0] as any)
      .mockReturnValueOnce(mockTasks[1] as any)
      .mockReturnValue(null);

    // Mock branch setup
    vi.mocked(branch.ensureBranch).mockResolvedValue('feat/004-wud-loop');

    // Mock gate pre-flight (FAIL - expected) and post-flight (PASS)
    vi.mocked(exec.runGate)
      .mockReturnValueOnce({ exitCode: 1, stdout: '', stderr: '' }) // T001 pre-flight
      .mockReturnValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // T001 post-flight
      .mockReturnValueOnce({ exitCode: 1, stdout: '', stderr: '' }) // T002 pre-flight
      .mockReturnValueOnce({ exitCode: 0, stdout: '', stderr: '' }); // T002 post-flight

    // Mock agent dispatch
    vi.mocked(agent.dispatchAgent).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

    const result = await executePhase({
      featureDir,
      phaseNumber,
      config: mockConfig,
    });

    expect(result.tasksCompleted).toBe(2);
    expect(state.loadTaskState).toHaveBeenCalledWith(featureDir);
    expect(branch.ensureBranch).toHaveBeenCalledWith('004-wud-loop');
    expect(exec.runGate).toHaveBeenCalledTimes(4);
    expect(agent.dispatchAgent).toHaveBeenCalledTimes(2);
    expect(state.markTaskComplete).toHaveBeenCalledTimes(2);
  });

  it('US-001 Scenario 2: rejects when tasks.json is missing', async () => {
    vi.mocked(state.loadTaskState).mockImplementation(() => {
      throw new Error('tasks.json not found for feature');
    });

    await expect(executePhase({
      featureDir: 'invalid-feature',
      phaseNumber: 1,
      config: mockConfig,
    })).rejects.toThrow('tasks.json not found for feature');
  });
});

describe('FR-002: Branch Management in Implement', () => {
  it('US-007 Scenario 1: ensures feature branch exists and merges develop', async () => {
    vi.mocked(branch.ensureBranch).mockResolvedValue('feat/004-wud-loop');
    vi.mocked(state.loadTaskState).mockReturnValue({ phases: [] } as any);

    await executePhase({
      featureDir: 'specs/004-wud-loop',
      phaseNumber: 1,
      config: { project: { name: 'test' }, agents: { define: 'gemini', implement: 'gemini' } } as any,
    });

    expect(branch.ensureBranch).toHaveBeenCalledWith('004-wud-loop');
  });
});

describe('FR-003: Pre-flight Gate Integrity', () => {
  it('US-002 Scenario 1: skips task if pre-flight gate already passes', async () => {
    const mockTask = { id: 'T001', status: 'open', phase: 'phase-01' };
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [{ id: 'phase-01', tasks: [mockTask] as any }]
    } as any);
    vi.mocked(state.nextTask).mockReturnValueOnce(mockTask as any).mockReturnValue(null);
    vi.mocked(branch.ensureBranch).mockResolvedValue('feat/004-wud-loop');

    // Pre-flight PASSES (exit 0) -> skip implement
    vi.mocked(exec.runGate).mockReturnValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const result = await executePhase({
      featureDir: 'specs/004-wud-loop',
      phaseNumber: 1,
      config: { project: { name: 'test' }, agents: { define: 'gemini', implement: 'gemini' } } as any,
    });

    expect(result.tasksSkipped).toBe(1);
    expect(agent.dispatchAgent).not.toHaveBeenCalled();
  });
});

describe('FR-009: Agent Dispatch Configuration', () => {
  it('US-008 Scenario 1: dispatches agent configured in config', async () => {
    const mockTask = { id: 'T001', status: 'open', phase: 'phase-01' };
    vi.mocked(state.loadTaskState).mockReturnValue({
      phases: [{ id: 'phase-01', tasks: [mockTask] as any }]
    } as any);
    vi.mocked(state.nextTask).mockReturnValueOnce(mockTask as any).mockReturnValue(null);
    vi.mocked(branch.ensureBranch).mockResolvedValue('feat/004-wud-loop');
    vi.mocked(exec.runGate).mockReturnValueOnce({ exitCode: 1, stdout: '', stderr: '' }).mockReturnValueOnce({ exitCode: 0, stdout: '', stderr: '' });

    const customConfig: any = {
      project: { name: 'test' },
      agents: {
        implement: 'claude'
      }
    };

    await executePhase({
      featureDir: 'specs/004-wud-loop',
      phaseNumber: 1,
      config: customConfig,
    });

    expect(agent.dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({
      backend: 'claude'
    }));
  });
});
