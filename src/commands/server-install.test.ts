import { describe, it, expect } from 'vitest';
import { installServer, uninstallServer, getLogs } from './server-install.js';

describe('US-008: Persistent Service Management', () => {
  describe('FR-012: Install Server', () => {
    it('writes LaunchAgent plist and loads via launchctl', async () => {
      expect(installServer).toBeDefined();
      expect(true).toBe(false);
    });
  });

  describe('FR-013: Uninstall Server', () => {
    it('unloads via launchctl and removes plist', async () => {
      expect(uninstallServer).toBeDefined();
      expect(true).toBe(false);
    });
    it('succeeds silently if agent not loaded', async () => {
      expect(true).toBe(false);
    });
  });

  describe('FR-014: Server Logs', () => {
    it('streams log file with --follow', async () => {
      expect(getLogs).toBeDefined();
      expect(true).toBe(false);
    });
  });

  describe('FR-015: PID Authority', () => {
    it('resolves PID from launchctl when installed', async () => {
      expect(true).toBe(false);
    });
  });
});