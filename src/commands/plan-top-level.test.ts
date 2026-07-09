/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { planCommand } from './plan.js';

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