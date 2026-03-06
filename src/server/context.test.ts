// src/server/context.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compileContext, writeContextToSandbox } from './context';
import { readFile, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  readdir: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('FR-007: Agent Context Compilation', () => {
  const featureDir = '/specs/001-cli-core';
  const phaseId = 'phase-01';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('compileContext', () => {
    it('US-009 scenario 1: Compiles context from spec, plan, rules, and tasks', async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes('rules')) return ['rule1.md'] as any;
        if (path.toString().includes('gates')) return ['gate1.sh'] as any;
        return [] as any;
      });

      vi.mocked(readFile).mockImplementation(async (path) => {
        if (path.toString().includes('rule1.md')) return 'Rule 1 content';
        if (path.toString().includes('spec.md')) return 'Spec content';
        if (path.toString().includes('plan.md')) return 'Plan content';
        if (path.toString().includes('tasks.json')) return JSON.stringify({
          tasks: [{ id: 'task-1', phase: 'phase-01', description: 'Task 1' }]
        });
        if (path.toString().includes('gate1.sh')) return 'Gate 1 content';
        return '';
      });

      const context = await compileContext(featureDir, phaseId);

      expect(context).toContain('# Phase Context: 001-cli-core / phase-01');
      expect(context).toContain('## Governance Rules');
      expect(context).toContain('Rule 1 content');
      expect(context).toContain('## Feature Specification');
      expect(context).toContain('Spec content');
      expect(context).toContain('## Implementation Plan');
      expect(context).toContain('Plan content');
      expect(context).toContain('## Current Tasks');
      expect(context).toContain('Task 1');
      expect(context).toContain('## Gate Scripts');
      expect(context).toContain('Gate 1 content');
    });

    it('rejects invalid input: spec.md not found (FR-013 error state)', async () => {
      vi.mocked(readFile).mockImplementation(async (path) => {
        if (path.toString().includes('spec.md')) {
          const error = new Error('ENOENT');
          (error as any).code = 'ENOENT';
          throw error;
        }
        return '';
      });

      await expect(compileContext(featureDir, phaseId)).rejects.toThrow(/spec.md not found/);
    });

    it('rejects invalid input: .agent/rules/ directory missing (FR-013 error state)', async () => {
      vi.mocked(readdir).mockImplementation(async (path) => {
        if (path.toString().includes('rules')) {
          const error = new Error('ENOENT');
          (error as any).code = 'ENOENT';
          throw error;
        }
        return [] as any;
      });

      await expect(compileContext(featureDir, phaseId)).rejects.toThrow(/.agent\/rules\/ directory not found/);
    });
  });

  describe('writeContextToSandbox', () => {
    it('writes context to sandbox via docker exec', async () => {
      const containerId = 'test-container';
      const context = 'Some compiled context';

      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        (cb as any)(null, { stdout: '' });
      });

      await writeContextToSandbox(containerId, context);

      expect(execFile).toHaveBeenCalledWith(
        'docker',
        expect.arrayContaining(['exec', '-i', containerId, 'bash', '-c', 'mkdir -p /workspace/.gwrk && cat > /workspace/.gwrk/phase-context.md']),
        expect.any(Function)
      );
    });

    it('throws if docker exec fails', async () => {
        const containerId = 'test-container';
        const context = 'Some compiled context';

        vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
          (cb as any)(new Error('Docker fail'), { stderr: 'Docker fail' });
        });

        await expect(writeContextToSandbox(containerId, context)).rejects.toThrow('Docker fail');
    });
  });
});
