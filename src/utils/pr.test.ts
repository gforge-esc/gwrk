import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPR, waitForCI } from './pr.js';
import { run } from './exec.js';
import fs from 'node:fs';
import { loadTaskState } from './state.js';

vi.mock('./exec.js');
vi.mock('node:fs');
vi.mock('./state.js');

describe('FR-006: PR + CI Gate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-006 Scenario 1: creates a PR via gh CLI', async () => {
    vi.mocked(run).mockResolvedValue('https://github.com/repo/pull/123\n');
    vi.mocked(loadTaskState).mockReturnValue({
      phases: [{ id: 'phase-01', tasks: [{ id: 'T001', title: 'Task 1', status: 'completed' }] }]
    } as any);

    const prNumber = await createPR({
      featureName: '004-wud-loop',
      phaseNumber: 1,
      featureDir: 'specs/004-wud-loop'
    });

    expect(prNumber).toBe(123);
    expect(run).toHaveBeenCalledWith('gh', [
      'pr', 'create',
      '--base', 'develop',
      '--title', 'feat(004-wud-loop): Phase 1 complete',
      '--body', expect.stringContaining('Tasks Completed')
    ]);
  });

  it('returns existing PR number if PR already exists', async () => {
    // gh pr create fails if PR exists, then we should try gh pr list
    const error = new Error('a pull request for branch "..." already exists');
    (error as any).stderr = 'a pull request for branch "feat/004-wud-loop" already exists';
    vi.mocked(run).mockRejectedValueOnce(error);
    vi.mocked(run).mockResolvedValueOnce('456\n'); // gh pr list output

    const prNumber = await createPR({
      featureName: '004-wud-loop',
      phaseNumber: 1,
      featureDir: 'specs/004-wud-loop'
    });

    expect(prNumber).toBe(456);
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'list', '--head', 'feat/004-wud-loop', '--json', 'number', '--jq', '.[0].number']);
  });

  it('US-003 Scenario 1: waits for CI via gh pr checks --watch', async () => {
    vi.mocked(run).mockResolvedValue('All checks passed\n');

    const result = await waitForCI(123, 30);

    expect(result).toBe(true);
    expect(run).toHaveBeenCalledWith('gh', ['pr', 'checks', '123', '--watch'], { timeout: 30 * 60 * 1000 });
  });

  it('returns false if CI checks fail', async () => {
    vi.mocked(run).mockRejectedValue(new Error('Checks failed'));

    const result = await waitForCI(123, 30);

    expect(result).toBe(false);
  });

  it('rejects invalid input: gh CLI not found', async () => {
    vi.mocked(run).mockRejectedValue(new Error('command not found: gh'));

    await expect(createPR({
      featureName: '004-wud-loop',
      phaseNumber: 1,
      featureDir: 'specs/004-wud-loop'
    })).rejects.toThrow(/gh CLI not found/);
  });
});
