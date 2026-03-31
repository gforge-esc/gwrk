import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntentEngine } from './intent-engine.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * RED TESTS: Phase 4 - IntentEngine (Layer 2.5 - F014-R)
 * 
 * Requirements addressed: 
 * FR-L25-002, US-012, TR-011
 */

describe('IntentEngine (FR-L25-002, US-012, TR-011)', () => {
  let engine: IntentEngine;
  const projectRoot = '/tmp/intent-test';

  beforeEach(() => {
    // IntentEngine doesn't exist yet, so this will fail to compile (ideal RED state)
    engine = new IntentEngine();
    vi.clearAllMocks();
  });

  describe('executeIntents (FR-L25-002, US-012)', () => {
    it('US-012: SHOULD execute WRITE_FILE intent and create parent directories if needed', async () => {
      const intents = [{
        action: 'WRITE_FILE',
        filePath: 'src/new/file.ts',
        content: 'console.log("hello world");'
      }];
      
      const summary = await engine.executeIntents(intents, projectRoot);
      
      expect(summary.length).toBe(1);
      expect(summary[0].action).toBe('WRITE_FILE');
      expect(summary[0].status).toBe('success');
    });

    it('US-012: SHOULD execute CREATE_DIR intent', async () => {
      const intents = [{
        action: 'CREATE_DIR',
        dirPath: 'docs/new-docs'
      }];
      
      const summary = await engine.executeIntents(intents, projectRoot);
      
      expect(summary[0].action).toBe('CREATE_DIR');
      expect(summary[0].status).toBe('success');
    });

    it('US-012: SHOULD execute RUN_COMMAND intent in the project root context', async () => {
      const intents = [{
        action: 'RUN_COMMAND',
        command: 'ls'
      }];
      
      const summary = await engine.executeIntents(intents, projectRoot);
      
      expect(summary[0].action).toBe('RUN_COMMAND');
      expect(summary[0].status).toBe('success');
    });
  });

  describe('Security & Path Containment (TR-011)', () => {
    it('TR-011: SHOULD block WRITE_FILE outside the project root', async () => {
      const intents = [{
        action: 'WRITE_FILE',
        filePath: '../../etc/passwd',
        content: 'malicious'
      }];
      
      // Expected: Workflow execution violation: File writes must be within project root.
      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/File writes must be within project root/);
    });

    it('TR-011: SHOULD block CREATE_DIR outside the project root', async () => {
      const intents = [{
        action: 'CREATE_DIR',
        dirPath: '/usr/bin/malicious'
      }];
      
      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/Directory creation must be within project root/);
    });

    it('TR-011: SHOULD block RUN_COMMAND from escaping project root (if supported)', async () => {
      // This might be harder to enforce strictly at the intent level, but let's assert the check
      const intents = [{
        action: 'RUN_COMMAND',
        command: 'cd / && rm -rf /'
      }];
      
      // IntentEngine should probably have some basic command safety or at least restricted context
      // For now, we assert it's handled as per decision-forge in plan.md
      await expect(engine.executeIntents(intents, projectRoot))
        .rejects.toThrow(/Unsafe command execution/);
    });
  });

  describe('Multi-action intents (FR-L25-007)', () => {
    it('FR-L25-007: SHOULD execute multiple intents in sequence', async () => {
      const intents = [
        { action: 'CREATE_DIR', dirPath: 'src/utils' },
        { action: 'WRITE_FILE', filePath: 'src/utils/test.ts', content: '' }
      ];
      
      const summaries = await engine.executeIntents(intents, projectRoot);
      expect(summaries.length).toBe(2);
      expect(summaries[0].action).toBe('CREATE_DIR');
      expect(summaries[1].action).toBe('WRITE_FILE');
    });
  });
});
