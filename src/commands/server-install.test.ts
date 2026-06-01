import { describe, it, expect, vi, beforeEach } from 'vitest';
import { installServer, uninstallServer, getLogs } from './server-install.js';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

vi.mock('node:fs');
vi.mock('node:child_process');

describe('US-008: Persistent Service Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('FR-012: Install Server', () => {
    it('writes LaunchAgent plist and loads via launchctl', async () => {
      await expect(installServer()).resolves.not.toThrow();
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('com.gwrk.server.plist'),
        expect.stringContaining('RunAtLoad'),
        'utf8'
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('launchctl load'),
        expect.any(Object)
      );
    });
  });

  describe('FR-013: Uninstall Server', () => {
    it('unloads via launchctl and removes plist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await expect(uninstallServer()).resolves.not.toThrow();
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('launchctl unload'),
        expect.any(Object)
      );
      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('com.gwrk.server.plist'));
    });

    it('succeeds silently if agent not loaded', async () => {
      vi.mocked(execSync).mockImplementationOnce(() => { throw new Error('not loaded'); });
      await expect(uninstallServer()).resolves.not.toThrow();
    });
  });

  describe('FR-014: Server Logs', () => {
    it('shows message if log file missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await getLogs();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('No log file found'));
      spy.mockRestore();
    });

    it('streams log file with --follow', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await expect(getLogs({ follow: true })).resolves.not.toThrow();
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('tail -f'),
        expect.any(Object)
      );
    });

    it('cats log file without follow', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      await expect(getLogs()).resolves.not.toThrow();
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining('cat '),
        expect.any(Object)
      );
    });
  });
});
