import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

/**
 * Phase 4 - IntentEngine (Layer 2.5 - F014-R)
 *
 * Requirements addressed:
 * FR-L25-002, US-012, TR-011
 */

// Mock node:fs/promises to prevent real FS mutations (TR-011)
vi.mock('node:fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock node:child_process to prevent real command execution (TR-011)
vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd: string, _opts: unknown, cb?: (err: unknown, result: { stdout: string; stderr: string }) => void) => {
    if (cb) {
      cb(null, { stdout: 'mocked output', stderr: '' });
    }
  }),
}));

// Import AFTER mocks are set up
import { IntentEngine } from './intent-engine.js';
import fs from 'node:fs/promises';
import { exec } from 'node:child_process';

describe('IntentEngine (FR-L25-002, US-012, TR-011)', () => {
  let engine: IntentEngine;
  const projectRoot = '/fake/project/root';

  beforeEach(() => {
    engine = new IntentEngine();
    vi.clearAllMocks();
  });

  describe('executeIntents (FR-L25-002, US-012)', () => {
    it('US-012: SHOULD execute WRITE_FILE intent and create parent directories if needed', async () => {
      const intents = [{
        action: 'WRITE_FILE' as const,
        filePath: 'src/new/file.ts',
        content: 'console.log("hello world");'
      }];

      const summary = await engine.executeIntents(intents, projectRoot);

      expect(summary.length).toBe(1);
      expect(summary[0].action).toBe('WRITE_FILE');
      expect(summary[0].status).toBe('success');

      // Verify mocked FS was called with correct paths (TR-011: no real mutations)
      const expectedDir = path.resolve(projectRoot, 'src/new');
      expect(fs.mkdir).toHaveBeenCalledWith(expectedDir, { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(
        path.resolve(projectRoot, 'src/new/file.ts'),
        'console.log("hello world");'
      );
    });

    it('US-012: SHOULD execute CREATE_DIR intent', async () => {
      const intents = [{
        action: 'CREATE_DIR' as const,
        dirPath: 'docs/new-docs'
      }];

      const summary = await engine.executeIntents(intents, projectRoot);

      expect(summary[0].action).toBe('CREATE_DIR');
      expect(summary[0].status).toBe('success');

      // Verify mocked FS was called (TR-011: no real mutations)
      expect(fs.mkdir).toHaveBeenCalledWith(
        path.resolve(projectRoot, 'docs/new-docs'),
        { recursive: true }
      );
    });

    it('US-012: SHOULD execute RUN_COMMAND intent in the project root context', async () => {
      const intents = [{
        action: 'RUN_COMMAND' as const,
        command: 'ls'
      }];

      const summary = await engine.executeIntents(intents, projectRoot);

      expect(summary[0].action).toBe('RUN_COMMAND');
      expect(summary[0].status).toBe('success');

      // Verify mocked exec was called with correct cwd (TR-011: no real execution)
      expect(exec).toHaveBeenCalledWith(
        'ls',
        { cwd: path.resolve(projectRoot) },
        expect.any(Function)
      );
    });
  });

  describe('Security & Path Containment (TR-011)', () => {
    it('TR-011: SHOULD block WRITE_FILE outside the project root', async () => {
      const intents = [{
        action: 'WRITE_FILE' as const,
        filePath: '../../etc/passwd',
        content: 'malicious'
      }];

      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/File writes must be within project root/);
    });

    it('TR-011: SHOULD block CREATE_DIR outside the project root', async () => {
      const intents = [{
        action: 'CREATE_DIR' as const,
        dirPath: '/usr/bin/malicious'
      }];

      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/Directory creation must be within project root/);
    });

    it('TR-011: SHOULD block RUN_COMMAND from escaping project root (if supported)', async () => {
      const intents = [{
        action: 'RUN_COMMAND' as const,
        command: 'cd / && rm -rf /'
      }];

      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/Unsafe command execution/);
    });

    it('TR-011: SHOULD NOT call real FS operations during tests', async () => {
      const intents = [
        { action: 'WRITE_FILE' as const, filePath: 'test.txt', content: 'data' },
        { action: 'CREATE_DIR' as const, dirPath: 'new-dir' },
      ];

      await engine.executeIntents(intents, projectRoot);

      // All FS calls should go through mocks, not real filesystem
      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });

  describe('Multi-action intents (FR-L25-007)', () => {
    it('FR-L25-007: SHOULD execute multiple intents in sequence', async () => {
      const intents = [
        { action: 'CREATE_DIR' as const, dirPath: 'src/utils' },
        { action: 'WRITE_FILE' as const, filePath: 'src/utils/test.ts', content: '' }
      ];

      const summaries = await engine.executeIntents(intents, projectRoot);
      expect(summaries.length).toBe(2);
      expect(summaries[0].action).toBe('CREATE_DIR');
      expect(summaries[1].action).toBe('WRITE_FILE');
    });
  });
});
