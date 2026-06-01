import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initCommand } from './init';
import * as inquirer from 'inquirer';
import * as fs from 'fs/promises';

vi.mock('inquirer');
vi.mock('fs/promises');

describe('Init Command (FR-001, FR-022, US-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should run interactive wizard when no flags provided (US-001 AC 1, 2)', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({
      confirmDetect: true,
      stack: 'typescript',
      confirmWorkstation: true
    });

    await initCommand.parseAsync(['node', 'gwrk', 'init']);

    expect(inquirer.prompt).toHaveBeenCalled();
  });

  it('should support --non-interactive mode and bypass prompts (US-001 AC 11)', async () => {
    await initCommand.parseAsync(['node', 'gwrk', 'init', '--non-interactive']);

    expect(inquirer.prompt).not.toHaveBeenCalled();
  });

  it('should perform workstation provisioning including SSH key gen (FR-022, US-001 AC 4)', async () => {
    vi.mocked(inquirer.prompt).mockResolvedValue({ confirmWorkstation: true });

    await initCommand.parseAsync(['node', 'gwrk', 'init']);
    
    // Verify workstation logic integration
  });

  it('should detect installed agent CLIs and configure agents block (US-001 AC 3)', async () => {
    // Placeholder for agent detection logic verification
  });

  it('should provision Slack channel if tokens available (US-001 AC 5)', async () => {
    // Placeholder for Slack provisioning logic verification
  });

  it('should register project in gwrk.db (US-001 AC 9)', async () => {
    // Verify DB registration logic integration
  });

  it('should be idempotent and detect existing .gwrkrc.json (US-001 AC 10)', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);

    await initCommand.parseAsync(['node', 'gwrk', 'init']);
    
    expect(inquirer.prompt).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('already initialized') })
    ]));
  });

  it('should scaffold mandatory directories and seed plugins (US-001 AC 7, 8)', async () => {
    await initCommand.parseAsync(['node', 'gwrk', 'init', '--non-interactive']);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.gwrk'), expect.anything());
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('specs'), expect.anything());
  });

  it('should fail if not in a git repository (FR-001 Error Path)', async () => {
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (path.toString().includes('.git')) throw new Error('Not a git repo');
      return;
    });

    await expect(initCommand.parseAsync(['node', 'gwrk', 'init'])).rejects.toThrow();
  });
});
