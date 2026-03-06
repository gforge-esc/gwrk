import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createWudLogger } from './log.js';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('node:fs');

describe('FR-010: WUD Run Logging', () => {
  const feature = '004-wud-loop';
  const phase = '1';
  const mockDate = new Date('2026-03-05T10:00:00Z');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(mockDate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('US-009 Scenario 1: creates a timestamped log file in .runs/', () => {
    const logger = createWudLogger(feature, phase);
    
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringMatching(/\.runs\/.*_wud_004-wud-loop_p1\.log/),
      expect.stringContaining('# gwrk Work-Until-Done Log'),
      'utf-8'
    );
  });

  it('logs info messages with timestamps', () => {
    const logger = createWudLogger(feature, phase);
    vi.mocked(fs.appendFileSync).mockClear();

    logger.info('Starting branch setup');

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\[\d{2}:\d{2}:\d{2}\] \[INFO\] Starting branch setup/),
      'utf-8'
    );
  });

  it('logs stage transitions with timestamps and iteration info', () => {
    const logger = createWudLogger(feature, phase);
    vi.mocked(fs.appendFileSync).mockClear();

    logger.stage('IMPLEMENTING', 1, 3);

    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringMatching(/\[\d{2}:\d{2}:\d{2}\] \[STAGE\] IMPLEMENTING — Iteration 1\/3/),
      'utf-8'
    );
  });
});
