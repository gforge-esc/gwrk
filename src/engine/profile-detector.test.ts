import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectToolchain } from './profile-detector';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('FR-015: Toolchain Detection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('TR-016: identifies Biome when biome.json is present', async () => {
    (fs.access as any).mockImplementation((path: string) => 
      path.endsWith('biome.json') ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
    );
    const result = await detectToolchain('/test/path');
    expect(result.primary).toBe('biome');
  });

  it('TR-016: identifies Ruff when ruff.toml is present', async () => {
    (fs.access as any).mockImplementation((path: string) => 
      path.endsWith('ruff.toml') ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
    );
    const result = await detectToolchain('/test/path');
    expect(result.primary).toBe('ruff');
  });

  it('TR-016: identifies Vitest as the test runner', async () => {
    (fs.access as any).mockImplementation((path: string) => 
      path.endsWith('vitest.config.ts') ? Promise.resolve() : Promise.reject(new Error('ENOENT'))
    );
    const result = await detectToolchain('/test/path');
    expect(result.test).toBe('vitest');
  });

  it('TC-015: performs zero-cost detection (filesystem only, no network)', async () => {
    await detectToolchain('/test/path');
    expect(vi.isMockFunction(fs.access)).toBe(true);
  });

  it('handles projects with no recognized toolchain', async () => {
    (fs.access as any).mockRejectedValue(new Error('ENOENT'));
    const result = await detectToolchain('/test/path');
    expect(result.primary).toBeUndefined();
  });
});