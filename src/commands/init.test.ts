import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initCommand } from './init.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('FR-L25-005: gwrk init MUST provision core workflows and project grounding dirs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-014: When gwrk init is run, Then ~/.gwrk/plugins/workflows/ is created', async () => {
    await initCommand();
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.gwrk/plugins/workflows'), expect.objectContaining({ recursive: true }));
  });

  it('US-014: When gwrk init is run, Then .gwrk/ontology and .gwrk/perspective directories are created', async () => {
    await initCommand();
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.gwrk/ontology'), expect.objectContaining({ recursive: true }));
    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.gwrk/perspective'), expect.objectContaining({ recursive: true }));
  });

  it('Negative path: Should handle fs.mkdir errors gracefully when directory already exists (EEXIST)', async () => {
    vi.mocked(fs.mkdir).mockRejectedValueOnce({ code: 'EEXIST' });
    await expect(initCommand()).resolves.not.toThrow();
  });
});
