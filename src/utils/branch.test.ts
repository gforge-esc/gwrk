import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureBranch, pushBranch } from './branch';
import { execFile } from 'node:child_process';

vi.mock('node:child_process');

describe('FR-002: Branch Management', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('ensureBranch', () => {
    it('US-007 Scenario 1: creates feat/<feature> from develop if not exists', async () => {
      // Mock git branch -a showing no such branch
      vi.mocked(execFile).mockImplementation((cmd, args, opts, cb): any => {
        const command = args?.join(' ');
        if (command?.includes('branch -a')) {
          cb(null, { stdout: 'master\ndevelop\n' });
        } else {
          cb(null, { stdout: '' });
        }
      });

      const branch = await ensureBranch('004-wud-loop');

      expect(branch).toBe('feat/004-wud-loop');
      expect(execFile).toHaveBeenCalledWith('git', ['checkout', 'develop'], expect.any(Object), expect.any(Function));
      expect(execFile).toHaveBeenCalledWith('git', ['pull'], expect.any(Object), expect.any(Function));
      expect(execFile).toHaveBeenCalledWith('git', ['checkout', '-b', 'feat/004-wud-loop'], expect.any(Object), expect.any(Function));
    });

    it('US-007 Scenario 2: checkouts and merges develop if local branch exists', async () => {
      // Mock git branch -a showing local branch
      vi.mocked(execFile).mockImplementation((cmd, args, opts, cb): any => {
        const command = args?.join(' ');
        if (command?.includes('branch -a')) {
          cb(null, { stdout: '  develop\n* feat/004-wud-loop\n' });
        } else {
          cb(null, { stdout: '' });
        }
      });

      const branch = await ensureBranch('004-wud-loop');

      expect(branch).toBe('feat/004-wud-loop');
      expect(execFile).toHaveBeenCalledWith('git', ['checkout', 'feat/004-wud-loop'], expect.any(Object), expect.any(Function));
      expect(execFile).toHaveBeenCalledWith('git', ['merge', 'develop', '--no-edit'], expect.any(Object), expect.any(Function));
    });
  });

  describe('pushBranch', () => {
    it('pushes with force-with-lease', async () => {
      vi.mocked(execFile).mockImplementation((cmd, args, opts, cb): any => {
        cb(null, { stdout: '' });
      });

      await pushBranch('004-wud-loop');

      expect(execFile).toHaveBeenCalledWith('git', ['push', 'origin', 'feat/004-wud-loop', '--force-with-lease'], expect.any(Object), expect.any(Function));
    });
  });
});
