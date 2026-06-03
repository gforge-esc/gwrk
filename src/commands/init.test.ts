import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initAction } from './init.js';
import fs from 'node:fs';
import { detectProfile } from '../engine/profile-detector.js';

vi.mock('node:fs');
vi.mock('../utils/signal.js', () => ({
  withSignal: vi.fn((name, fn) => fn()),
  CommandError: class extends Error {
    constructor(message: string, exitCode: number) {
      super(message);
    }
  }
}));
vi.mock('../engine/profile-detector.js', () => ({
  detectProfile: vi.fn().mockResolvedValue({ 
    type: 'nodejs',
    stack: { language: 'typescript' },
    layout: 'flat'
  })
}));
vi.mock('../plugins/migrate.js', () => ({
  migratePlugins: vi.fn()
}));
vi.mock('../plugins/seed.js', () => ({
  seedSkills: vi.fn()
}));
vi.mock('../db/runs.js', () => ({
  registerProject: vi.fn()
}));
vi.mock('../utils/format.js', () => ({
  banner: vi.fn(),
  success: vi.fn(),
  color: { BOLD: '', DIM: '', GREEN: '', CYAN: '', YELLOW: '', RESET: '' }
}));

describe('FR-L25-005: gwrk init MUST provision core workflows and project grounding dirs', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readdirSync).mockReturnValue([]);
    vi.mocked(detectProfile).mockResolvedValue({ 
      type: 'nodejs',
      stack: { language: 'typescript' },
      layout: 'flat'
    });
  });

  it('US-014: When gwrk init is run, Then ~/.gwrk/plugins/workflows/ is created', async () => {
    await initAction({ nonInteractive: true });
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.gwrk/plugins/workflows'), expect.objectContaining({ recursive: true }));
  });

  it('US-014: When gwrk init is run, Then .gwrk/ontology and .gwrk/perspective directories are created', async () => {
    await initAction({ nonInteractive: true });
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.gwrk/ontology'), expect.objectContaining({ recursive: true }));
    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.gwrk/perspective'), expect.objectContaining({ recursive: true }));
  });

  it('Negative path: Should handle fs.mkdirSync errors gracefully when directory already exists (EEXIST)', async () => {
    vi.mocked(fs.mkdirSync).mockImplementation((path: any) => {
      if (typeof path === 'string' && path.includes('.gwrk/ontology')) {
        const err = new Error('EEXIST');
        (err as any).code = 'EEXIST';
        throw err;
      }
    });
    await expect(initAction({ nonInteractive: true })).resolves.not.toThrow();
  });
});
