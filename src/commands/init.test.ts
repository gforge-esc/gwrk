import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initCommand } from './init.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
      // Mock profile-detector.detectProfile
      // Mock inquirer to confirm
      fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
      
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      
      expect(fs.existsSync(path.join(tmpDir, '.gwrkrc.json'))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.project.type).toBe('nodejs');
    });

    it('walks through profile sections interactively', async () => {
      // Should verify that inquirer is called for stack, layout, etc.
      expect(true).toBe(false); // RED
    });

    it('detects installed agent CLIs and configures agents block', async () => {
      // Mock 'which' or similar check
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.agents).toBeDefined();
    });

    it('provisions Slack channel if tokens available', async () => {
      process.env.SLACK_BOT_TOKEN = 'xoxb-test';
      // Mock Slack API call
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      expect(true).toBe(false); // RED: check Slack API mock call
    });

    it('writes complete .gwrkrc.json with full project profile', async () => {
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, '.gwrkrc.json'), 'utf-8'));
      expect(config.project).toBeDefined();
      expect(config.project.stack).toBeDefined();
    });

    it('scaffolds directories and seeds plugins', async () => {
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      expect(fs.existsSync(path.join(tmpDir, '.gwrk'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.gwrk', 'rules'))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'specs'))).toBe(true);
    });

    it('runs workstation provisioning steps (TCC, SSH, gh)', async () => {
      // Should check if ~/.gwrk/setup.json is created (mocking home dir)
      expect(true).toBe(false); // RED
    });

    it('--non-interactive flag uses auto-detection for all fields with zero prompts', async () => {
      // Verify no inquirer prompts are called
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      expect(fs.existsSync(path.join(tmpDir, '.gwrkrc.json'))).toBe(true);
    });
  });

  describe('TR-001 / TR-021: Idempotency and Pre-flight', () => {
    it('running gwrk init again shows current config and offers to update (idempotent)', async () => {
      fs.writeFileSync(path.join(tmpDir, '.gwrkrc.json'), JSON.stringify({ project: { name: 'existing' } }));
      await initCommand.parseAsync(['node', 'init'], { from: 'user' });
      // Should not overwrite without confirmation or should merge
      expect(true).toBe(false); // RED
    });

    it('ship pre-flight rejection if setup incomplete', async () => {
      // This might be a test for gwrk ship but it's mentioned in TR-021
      expect(true).toBe(false); // RED
    });
  });

  describe('FR-001: Error States', () => {
    it('fails if not in a git repo', async () => {
      fs.rmSync(path.join(tmpDir, '.git'), { recursive: true });
      await expect(initCommand.parseAsync(['node', 'init'], { from: 'user' }))
        .rejects.toThrow('Not a git repository');
    });

    it('fails if not interactive terminal + no --non-interactive', async () => {
      // Mock isatty to return false
      expect(true).toBe(false); // RED
    });

    it('fails if gh CLI not authenticated', async () => {
      // Mock 'gh auth status' to fail
      expect(true).toBe(false); // RED
    });

    it('fails if SSH key generation fails', async () => {
      // Mock ssh-keygen failure
      expect(true).toBe(false); // RED
    });
  });

  describe('TC-011: Schema backward compat', () => {
    it('existing .gwrkrc.json files parse without error', async () => {
      const oldConfig = {
        name: "test-project",
        agents: { "gemini": { provider: "google" } }
      };
      fs.writeFileSync(path.join(tmpDir, '.gwrkrc.json'), JSON.stringify(oldConfig));
      // Should be able to run init or other commands without schema error
      await initCommand.parseAsync(['node', 'init', '--non-interactive'], { from: 'user' });
      expect(true).toBe(true); 
    });
  });
});
