import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveWudState, loadWudState } from './wud-state';
import fs from 'node:fs';

vi.mock('node:fs');

describe('FR-008: WUD State Persistence', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-005 Scenario 1: saves state JSON to disk', () => {
    const stateFile = '.runs/004-wud-loop_p1.state';
    const state = {
      stage: 'CODE_REVIEW',
      iteration: 1,
      feature: '004-wud-loop',
      phase: '1',
      updatedAt: '2026-03-05T12:00:00Z',
    };

    saveWudState(stateFile as any, state as any);

    expect(fs.writeFileSync).toHaveBeenCalledWith(
      stateFile,
      expect.stringContaining('"stage":"CODE_REVIEW"'),
      'utf-8'
    );
  });

  it('US-005 Scenario 2: loads state JSON from disk', () => {
    const stateFile = '.runs/004-wud-loop_p1.state';
    const state = {
      stage: 'CODE_REVIEW',
      iteration: 1,
      feature: '004-wud-loop',
      phase: '1',
      updatedAt: '2026-03-05T12:00:00Z',
    };

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(state));

    const loadedState = loadWudState(stateFile);

    expect(loadedState).toEqual(state);
  });

  it('returns null if state file does not exist', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(loadWudState('missing.state')).toBeNull();
  });

  it('resets terminal states to BRANCH_SETUP', () => {
    const stateFile = '.runs/004-wud-loop_p1.state';
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      stage: 'DONE',
      iteration: 1,
      feature: '004-wud-loop',
      phase: '1',
      updatedAt: '2026-03-05T12:00:00Z',
    }));

    const loadedState = loadWudState(stateFile);
    expect(loadedState?.stage).toBe('BRANCH_SETUP');
  });
});
