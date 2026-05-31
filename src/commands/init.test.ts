import { describe, it, expect, vi } from 'vitest';
import { initCommand } from './init.js';
import * as fs from 'node:fs';

vi.mock('node:fs');

describe('US-014: gwrk init Seeding', () => {
  it('TR-P10-001: seeds .gwrk/rules/ from builtins', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    
    await initCommand('/fake/project');

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.gwrk/rules'), expect.any(Object));
    expect(fs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('builtins/rules/operating-model.md'),
      expect.stringContaining('.gwrk/rules/operating-model.md')
    );
  });
});
