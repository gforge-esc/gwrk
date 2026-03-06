// src/server/git-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPhaseBranch, mergePhaseBack, isClean, hasConflicts } from './git-manager';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('FR-010: Git Branch Lifecycle Management', () => {
  const feature = '001-cli-core';
  const phase = 'phase-01';
  const featureBranch = 'feature/001-cli-core-wip';
  const phaseBranch = 'phase/001-cli-core-phase-01';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createPhaseBranch', () => {
    it('US-006 scenario 1: Creates phase branch from feature branch', async () => {
      // Mock git status --porcelain (clean)
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        if (args?.includes('status')) {
          (cb as any)(null, { stdout: '' });
        } else {
          (cb as any)(null, { stdout: '' });
        }
      });

      const result = await createPhaseBranch(feature, phase);
      expect(result).toBe(phaseBranch);
      expect(execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['checkout', '-b', phaseBranch, featureBranch]), expect.any(Function));
    });

    it('rejects invalid input: Feature branch not found (FR-010 error state)', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        if (args?.includes('checkout')) {
          const error = new Error('Branch feature/001-cli-core-wip not found');
          (error as any).code = 1;
          (cb as any)(error, { stderr: 'Branch feature/001-cli-core-wip not found' });
        } else {
          (cb as any)(null, { stdout: '' });
        }
      });

      await expect(createPhaseBranch(feature, phase)).rejects.toThrow('Branch feature/001-cli-core-wip not found');
    });

    it('rejects invalid input: Dirty working tree (FR-010 error state)', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        if (args?.includes('status')) {
          (cb as any)(null, { stdout: 'M modified-file.ts' });
        } else {
          (cb as any)(null, { stdout: '' });
        }
      });

      await expect(createPhaseBranch(feature, phase)).rejects.toThrow('Working tree has uncommitted changes');
    });
  });

  describe('mergePhaseBack', () => {
    it('US-006 scenario 2: Merges phase branch back into feature branch', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        (cb as any)(null, { stdout: '' });
      });

      await mergePhaseBack(feature, phase);
      expect(execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['checkout', featureBranch]), expect.any(Function));
      expect(execFile).toHaveBeenCalledWith('git', expect.arrayContaining(['merge', phaseBranch]), expect.any(Function));
    });

    it('rejects invalid input: Merge conflict (FR-010 error state)', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        if (args?.includes('merge')) {
          const error = new Error('Merge conflict');
          (error as any).code = 1;
          (cb as any)(error, { stderr: 'CONFLICT (content): Merge conflict in file.ts' });
        } else {
          (cb as any)(null, { stdout: '' });
        }
      });

      await expect(mergePhaseBack(feature, phase)).rejects.toThrow(/Merge conflict in phase/);
    });

    it('rejects invalid input: Branch does not exist', async () => {
        vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
          if (args?.includes('checkout')) {
            const error = new Error('Branch not found');
            (error as any).code = 1;
            (cb as any)(error, { stderr: 'Branch phase/001-cli-core-phase-01 not found' });
          } else {
            (cb as any)(null, { stdout: '' });
          }
        });

        await expect(mergePhaseBack(feature, phase)).rejects.toThrow(/Branch phase\/.* not found/);
    });
  });

  describe('isClean', () => {
    it('returns true if no uncommitted changes', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        (cb as any)(null, { stdout: '' });
      });
      const result = await isClean('.');
      expect(result).toBe(true);
    });

    it('returns false if uncommitted changes exist', async () => {
        vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
          (cb as any)(null, { stdout: 'M file.ts' });
        });
        const result = await isClean('.');
        expect(result).toBe(false);
    });
  });

  describe('hasConflicts', () => {
    it('returns true if merge would conflict', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
        if (args?.includes('merge')) {
          const error = new Error('Merge conflict');
          (cb as any)(error, { stderr: 'CONFLICT' });
        } else {
          (cb as any)(null, { stdout: '' });
        }
      });
      const result = await hasConflicts(feature, phase);
      expect(result).toBe(true);
    });

    it('returns false if merge would not conflict', async () => {
        vi.mocked(execFile).mockImplementation((cmd, args, cb) => {
          (cb as any)(null, { stdout: '' });
        });
        const result = await hasConflicts(feature, phase);
        expect(result).toBe(false);
    });
  });
});
