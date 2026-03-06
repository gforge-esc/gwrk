import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';

// We mock the commands to avoid side effects during registration check
vi.mock('./commands/init.js', () => ({ initCommand: new Command('init') }));
vi.mock('./commands/specify.js', () => ({ specifyCommand: new Command('specify') }));
vi.mock('./commands/plan.js', () => ({ planCommand: new Command('plan') }));
vi.mock('./commands/analyze.js', () => ({ analyzeCommand: new Command('analyze') }));
vi.mock('./commands/effort.js', () => ({ effortCommand: new Command('effort') }));
vi.mock('./commands/compression.js', () => ({ compressionCommand: new Command('compression') }));
vi.mock('./commands/tasks.js', () => ({ tasksCommand: new Command('tasks') }));
vi.mock('./commands/wud.js', () => ({ wudCommand: new Command('wud') }));
vi.mock('./commands/define.js', () => ({ defineCommand: new Command('define') }));
vi.mock('./commands/implement.js', () => ({ implementCommand: new Command('implement') }));
vi.mock('./commands/runs.js', () => ({ runsCommand: new Command('runs') }));
vi.mock('./commands/stats.js', () => ({ statsCommand: new Command('stats') }));
vi.mock('./commands/pulse.js', () => ({ registerPulseCommands: vi.fn() }));
vi.mock('./utils/config.js', () => ({ loadConfig: vi.fn() }));

describe('FR-001 / FR-004: CLI Command Registration', () => {
  it('US-001 / US-003: registers implement and wud commands', async () => {
    const parseSpy = vi.spyOn(Command.prototype, 'parse').mockImplementation(() => { return {} as any; });
    
    // Re-import cli to trigger registration
    const { program } = await import('./cli.js');
    
    const commandNames = program.commands.map(c => c.name());
    expect(commandNames).toContain('implement');
    expect(commandNames).toContain('wud');
    
    parseSpy.mockRestore();
  });
});
