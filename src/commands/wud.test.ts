import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runWudLoop, wudCommand } from './wud.js';
import { executePhase } from './implement.js';
import { dispatchAgent } from '../utils/agent.js';
import { checkPhaseVerdict } from '../utils/verdict.js';
import { createPR, waitForCI } from '../utils/pr.js';
import { saveWudState, loadWudState } from '../utils/wud-state.js';
import { createWudLogger } from '../utils/log.js';
import { startRun, finishRun } from '../db/runs.js';
import { loadConfig } from '../utils/config.js';

vi.mock('./implement.js');
vi.mock('../utils/agent.js');
vi.mock('../utils/verdict.js');
vi.mock('../utils/pr.js');
vi.mock('../utils/wud-state.js');
vi.mock('../utils/log.js');
vi.mock('../db/runs.js');
vi.mock('../utils/config.js');

describe('FR-004: WUD State Machine orchestrator', () => {
  const mockOpts = {
    featureDir: 'specs/004-wud-loop',
    phaseNumber: 1,
    config: {
      project: { name: 'gwrk' },
      agents: { implement: 'gemini', review: 'gemini' }
    } as any,
    maxIterations: 3
  };

  const mockLogger = {
    info: vi.fn(),
    stage: vi.fn()
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(createWudLogger).mockReturnValue(mockLogger as any);
    vi.mocked(loadWudState).mockReturnValue(null);
    vi.mocked(executePhase).mockResolvedValue({ tasksCompleted: 1, tasksSkipped: 0, totalTasks: 1, branch: 'feat/004-wud-loop' });
    vi.mocked(checkPhaseVerdict).mockReturnValue({ verdict: 'GO', totalTasks: 1, completedTasks: 1, openTasks: [] });
    vi.mocked(dispatchAgent).mockResolvedValue({ verdict: 'GO' } as any);
    vi.mocked(createPR).mockResolvedValue(123);
    vi.mocked(waitForCI).mockResolvedValue(true);
  });

  it('TR-004: walks the happy path state machine', async () => {
    // US-003 Scenario 1: Happy path BRANCH_SETUP → IMPLEMENTING → CODE_REVIEW → UAT_REVIEW → PR_CI → DONE
    const result = await runWudLoop(mockOpts);

    expect(result.stage).toBe('DONE');
    expect(result.iteration).toBe(1);
    expect(result.prNumber).toBe(123);

    expect(saveWudState).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'BRANCH_SETUP' }));
    expect(executePhase).toHaveBeenCalled();
    expect(dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ role: 'review-code' }));
    expect(dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ role: 'review-uat' }));
    expect(createPR).toHaveBeenCalled();
    expect(waitForCI).toHaveBeenCalled();
    expect(saveWudState).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'DONE' }));
  });

  it('FR-005 / TR-005: loops back to IMPLEMENTING on NO-GO from review', async () => {
    // First iteration: NO-GO from code review
    vi.mocked(dispatchAgent)
      .mockResolvedValueOnce({ verdict: 'NO-GO' } as any) // CODE_REVIEW NO-GO
      .mockResolvedValueOnce({ verdict: 'GO' } as any);   // Subsequent UAT_REVIEW if reached, but it should loop back

    // Mock checkPhaseVerdict to return NO-GO after implementation if retry is needed
    // Actually WUD loops back to IMPLEMENTING which sets the state to IMPLEMENTING
    // Let's mock dispatchAgent more precisely
    vi.mocked(dispatchAgent).mockReset();
    vi.mocked(dispatchAgent)
      .mockResolvedValueOnce({ verdict: 'NO-GO' } as any) // Iteration 1: CODE_REVIEW NO-GO
      .mockResolvedValueOnce({ verdict: 'GO' } as any)    // Iteration 2: CODE_REVIEW GO
      .mockResolvedValueOnce({ verdict: 'GO' } as any);   // Iteration 2: UAT_REVIEW GO

    const result = await runWudLoop({ ...mockOpts, maxIterations: 2 });

    expect(result.iteration).toBe(2);
    expect(result.stage).toBe('DONE');
    expect(executePhase).toHaveBeenCalledTimes(2);
  });

  it('FR-007 / TR-007: triggers circuit breaker after MAX_ITERATIONS', async () => {
    // US-004 Scenario 1: MAX_ITERATIONS reached
    vi.mocked(dispatchAgent).mockResolvedValue({ verdict: 'NO-GO' } as any);

    const result = await runWudLoop({ ...mockOpts, maxIterations: 1 });

    expect(result.stage).toBe('CIRCUIT_BREAK');
    expect(result.iteration).toBe(1);
    expect(saveWudState).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ stage: 'CIRCUIT_BREAK' }));
  });

  it('FR-008 / TR-008: US-005: resumes from saved state', async () => {
    // Crash recovery: start from CODE_REVIEW
    vi.mocked(loadWudState).mockReturnValue({
      stage: 'CODE_REVIEW',
      iteration: 1,
      feature: '004-wud-loop',
      phase: '1',
      updatedAt: '2026-03-05T12:00:00Z'
    });

    const result = await runWudLoop(mockOpts);

    expect(executePhase).not.toHaveBeenCalled(); // Skipped as it starts from CODE_REVIEW
    expect(dispatchAgent).toHaveBeenCalledWith(expect.objectContaining({ role: 'review-code' }));
    expect(result.stage).toBe('DONE');
  });

  it('FR-010 / TR-010: logs stage transitions', async () => {
    await runWudLoop(mockOpts);
    expect(mockLogger.stage).toHaveBeenCalledWith('IMPLEMENTING', 1, 3);
    expect(mockLogger.stage).toHaveBeenCalledWith('CODE_REVIEW', 1, 3);
  });

  it('FR-006: waits for CI and fails if checks fail', async () => {
    vi.mocked(waitForCI).mockResolvedValue(false);

    const result = await runWudLoop(mockOpts);

    expect(result.stage).toBe('FAILED');
    expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('CI checks failed'));
  });

  it('rejects invalid input: tasks.json not found (via verdict)', async () => {
    vi.mocked(checkPhaseVerdict).mockImplementation(() => {
      throw new Error('tasks.json not found');
    });

    await expect(runWudLoop(mockOpts)).rejects.toThrow('tasks.json not found');
  });
});

describe('gwrk wud command — CLI integration', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReturnValue({
      project: { name: 'gwrk' },
      agents: { implement: 'gemini', review: 'gemini' }
    } as any);
    vi.mocked(startRun).mockReturnValue(88);
  });

  it('calls runWudLoop with correct arguments', async () => {
    vi.mocked(runWudLoop).mockResolvedValue({ stage: 'DONE', iteration: 1, durationMs: 1000 });

    await wudCommand.parseAsync(['node', 'cli.js', '004-wud-loop', '1']);

    expect(runWudLoop).toHaveBeenCalledWith(expect.objectContaining({
      featureDir: expect.stringContaining('004-wud-loop'),
      phaseNumber: 1
    }));
    expect(finishRun).toHaveBeenCalledWith(88, expect.objectContaining({ exit_code: 0 }));
  });

  it('handles circuit breaker exit code', async () => {
    vi.mocked(runWudLoop).mockResolvedValue({ stage: 'CIRCUIT_BREAK', iteration: 3, durationMs: 5000 });
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('process.exit'); });

    try {
      await wudCommand.parseAsync(['node', 'cli.js', '004-wud-loop', '1']);
    } catch (e) {
      // ignore process.exit error
    }

    expect(processExitSpy).toHaveBeenCalledWith(1);
    expect(finishRun).toHaveBeenCalledWith(88, expect.objectContaining({ exit_code: 1 }));
  });
});
