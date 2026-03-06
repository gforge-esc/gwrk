import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkPhaseVerdict } from './verdict.js';
import { loadTaskState } from './state.js';

vi.mock('./state.js');

describe('FR-005: Verdict Checker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-003 Scenario 1: returns GO if all tasks in phase are completed', () => {
    vi.mocked(loadTaskState).mockReturnValue({
      phases: [
        {
          id: 'phase-01',
          tasks: [
            { id: 'T001', title: 'Task 1', status: 'completed' },
            { id: 'T002', title: 'Task 2', status: 'completed' }
          ]
        }
      ]
    } as any);

    const result = checkPhaseVerdict('specs/004-wud-loop', 1);

    expect(result.verdict).toBe('GO');
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(2);
    expect(result.openTasks).toHaveLength(0);
  });

  it('US-003 Scenario 2: returns NO-GO if some tasks in phase are still open', () => {
    vi.mocked(loadTaskState).mockReturnValue({
      phases: [
        {
          id: 'phase-01',
          tasks: [
            { id: 'T001', title: 'Task 1', status: 'completed' },
            { id: 'T002', title: 'Task 2', status: 'open' }
          ]
        }
      ]
    } as any);

    const result = checkPhaseVerdict('specs/004-wud-loop', 1);

    expect(result.verdict).toBe('NO-GO');
    expect(result.totalTasks).toBe(2);
    expect(result.completedTasks).toBe(1);
    expect(result.openTasks).toHaveLength(1);
    expect(result.openTasks[0]?.id).toBe('T002');
  });

  it('rejects invalid input: phase not found in tasks.json', () => {
    vi.mocked(loadTaskState).mockReturnValue({
      phases: [
        {
          id: 'phase-02',
          tasks: []
        }
      ]
    } as any);

    expect(() => checkPhaseVerdict('specs/004-wud-loop', 1)).toThrow(/Phase phase-01 not found/);
  });
});
