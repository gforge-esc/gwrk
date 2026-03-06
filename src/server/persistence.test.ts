import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { persistDispatch } from './persistence.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { DispatchRecord } from './types.js';

describe('DM-001: Persistence (dispatches.jsonl)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-persistence-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    fs.mkdirSync(path.join(tempDir, '.gwrk'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should append a dispatch record to .gwrk/dispatches.jsonl', () => {
    const record: DispatchRecord = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      featureId: 'f1',
      phaseId: 'p1',
      backend: 'gemini',
      status: 'queued',
      branchName: 'phase/f1-p1',
      attempts: [],
      createdAt: new Date().toISOString()
    };

    persistDispatch(record);

    const logPath = path.join(tempDir, '.gwrk/dispatches.jsonl');
    expect(fs.existsSync(logPath)).toBe(true);
    
    const content = fs.readFileSync(logPath, 'utf8');
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe(record.id);
    expect(parsed.status).toBe('queued');
  });

  it('should handle multiple appends correctly', () => {
    const record1: any = { id: '1', status: 'queued' };
    const record2: any = { id: '1', status: 'running' };

    persistDispatch(record1);
    persistDispatch(record2);

    const logPath = path.join(tempDir, '.gwrk/dispatches.jsonl');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).status).toBe('queued');
    expect(JSON.parse(lines[1]).status).toBe('running');
  });
});
