import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWudLogger } from './log';
import fs from 'node:fs';

vi.mock('node:fs');

describe('FR-010: WUD Run Logging', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-009 Scenario 1: creates a log file in .runs/', () => {
    const logger = createWudLogger('004-wud-loop', '1');
    logger.info('Test message');

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.runs/'),
      expect.stringContaining('[INFO] Test message'),
      'utf-8'
    );
  });

  it('records stage transitions', () => {
    const logger = createWudLogger('004-wud-loop', '1');
    logger.stage('IMPLEMENTING', 1, 3);

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.runs/'),
      expect.stringContaining('[STAGE] IMPLEMENTING — Iteration 1/3'),
      'utf-8'
    );
  });
});
