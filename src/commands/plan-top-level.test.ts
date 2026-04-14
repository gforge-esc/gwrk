import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
// @ts-ignore - Module does not exist yet (RED)
import { planCommand } from './plan-new.js';

describe('gwrk plan subcommands (FR-005/013/017/019)', () => {
  let program: Command;

  beforeEach(() => {
    program = new Command();
    program.addCommand(planCommand);
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('FR-019: all subcommands should fail on empty graph with remediation message', async () => {
    vi.mock('../engine/plan-store.js', () => ({
      PlanStore: class {
        isEmpty = () => true;
      }
    }));

    const subcommands = ['status', 'next', 'critical', 'waves', 'verify', 'render'];
    for (const sub of subcommands) {
      try {
        await program.parseAsync(['node', 'test', 'plan', sub]);
      } catch (err) {}
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("No build plan data. Run 'gwrk plan seed' or 'gwrk plan init'.")
      );
    }
  });

  it('FR-013: gwrk plan seed should populate graph', async () => {
    try {
      await program.parseAsync(['node', 'test', 'plan', 'seed']);
    } catch (err) {}
  });

  it('FR-017: gwrk plan init --dry-run should list features', async () => {
    try {
      await program.parseAsync(['node', 'test', 'plan', 'init', '--dry-run']);
    } catch (err) {}
  });
});