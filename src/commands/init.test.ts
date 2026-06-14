import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initCommand } from './init.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Mock child_process to prevent actual execution of git/gh/ssh commands
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  exec: vi.fn()
}));

// Mock readline for interactive prompts
vi.mock('node:readline', () => ({
  createInterface: vi.fn().mockReturnValue({
    question: vi.fn((q, cb) => cb('y')), // Default to 'y' for confirmations
    close: vi.fn()
  })
}));

describe('FR-001: Unified Init Command', () => {
  let tmpDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-init-test-'));
    process.chdir(tmpDir);
    // Initialize dummy git repo to satisfy check
    fs.mkdirSync(path.join(tmpDir, '.git'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('US-001: Project Initialization', () => {
    it('auto-detects project type from filesystem signals and presents for confirmation', async () => {
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      
      expect(fs.existsSync(path.join(tmpDir, '.gwrkrc.json'))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.project.type).toBeDefined();
    });

    it('walks through profile sections interactively', async () => {
      // TR-001: Verify interactive flow prompts for stack, layout, etc.
      // This is RED because the current stub doesn't use readline
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      const { createInterface } = await import('node:readline');
      expect(createInterface).toHaveBeenCalled();
    });

    it('detects installed agent CLIs and configures agents block', async () => {
      // Mock 'which' or similar check in child_process
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValue(Buffer.from('/usr/local/bin/gemini'));

      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.agents).toBeDefined();
    });

    it('provisions Slack channel if tokens available', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      process.env.SLACK_APP_TOKEN = 'xapp-test';
      
      // Mock Slack API call (via setupSlack or similar)
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      // Verify something happened regarding Slack
      expect(true).toBe(false); // RED
    });

    it('writes complete .gwrkrc.json with full project profile', async () => {
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.project).toBeDefined();
      expect(config.project.stack).toBeDefined();
      expect(config.project.layout).toBeDefined();
    });

    it('scaffolds directories and seeds plugins', async () => {
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      expect(fs.existsSync(path.join(tmpDir, '.gwrk'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gwrk', 'rules'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'specs'))).toBe(true);
    });

    it('runs workstation provisioning steps (TCC, SSH, gh)', async () => {
      // TR-021: Should update ~/.gwrk/setup.json
      // Note: We need to mock os.homedir() to point to tmpDir/home
      const homeDir = path.join(tmpDir, 'home');
      fs.mkdirSync(homeDir);
      vi.mock('node:os', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:os')>();
        return { ...actual, homedir: () => homeDir };
      });

      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      
      expect(fs.existsSync(path.join(homeDir, '.gwrk', 'setup.json'))).toBe(true);
    });

    it('clones gwrk-plugins registry to ~/.gwrk/registry/', async () => {
      // FR-044 / TR-036
      const homeDir = path.join(tmpDir, 'home');
      fs.mkdirSync(homeDir, { recursive: true });
      
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      
      expect(fs.existsSync(path.join(homeDir, '.gwrk', 'registry'))).toBe(true);
    });

    it('detects installed extensions and updates .gwrkrc.json', async () => {
      // FR-045 / TR-037
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.extensions).toBeDefined();
    });

    it('--non-interactive flag uses auto-detection for all fields with zero prompts', async () => {
      const { createInterface } = await import('node:readline');
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      expect(createInterface).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpDir, '.gwrkrc.json'))).toBe(true);
    });
  });

  describe('TR-001 / TR-021: Idempotency and Pre-flight', () => {
    it('running gwrk init again shows current config and offers to update (idempotent)', async () => {
      fs.writeFileSync(path.join(tmpDir, '.gwrkrc.json'), JSON.stringify({ project: { name: 'existing' } }));
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      // RED: check that it doesn't just crash or overwrite without merge logic
      expect(true).toBe(false);
    });
  });

  describe('FR-001: Error States', () => {
    it('fails if not in a git repo', async () => {
      fs.rmSync(path.join(tmpDir, '.git'), { recursive: true });
      await expect(initCommand.parseAsync(['node', 'init'], { from: 'user' }))
        .rejects.toThrow(/Not a git repository/);
    });

    it('fails if not interactive terminal + no --non-interactive', async () => {
      // Mock isatty to return false
      const originalIsTTY = process.stdin.isTTY;
      process.stdin.isTTY = false;
      try {
        await expect(initCommand.parseAsync(['node', 'init'], { from: 'user' }))
          .rejects.toThrow(/Must be run in an interactive terminal/);
      } finally {
        process.stdin.isTTY = originalIsTTY;
      }
    });

    it('fails if gh CLI not authenticated', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (typeof cmd === 'string' && cmd.includes('gh auth status')) {
          throw new Error('Not authenticated');
        }
        return Buffer.from('');
      });

      await expect(initCommand.parseAsync(['node', 'init'], { from: 'user' }))
        .rejects.toThrow(/gh auth status failed/);
    });
  });
});
