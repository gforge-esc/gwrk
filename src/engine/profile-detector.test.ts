import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectProfile, resolveProfile } from './profile-detector';
import * as fs from 'fs/promises';

vi.mock('fs/promises');

describe('Profile Detector (FR-030, FR-031, US-027)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should detect pnpm-monorepo from pnpm-workspace.yaml (FR-030 rule 3)', async () => {
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (path.toString().includes('pnpm-workspace.yaml')) return;
      throw new Error();
    });

    const profile = await detectProfile('/tmp/project');
    expect(profile.type).toBe('pnpm-monorepo');
    expect(profile.stack.packageManager).toBe('pnpm');
  });

  it('should detect rust project from Cargo.toml (FR-030 rule 1)', async () => {
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (path.toString().includes('Cargo.toml')) return;
      throw new Error();
    });

    const profile = await detectProfile('/tmp/project');
    expect(profile.type).toMatch(/rust/);
    expect(profile.stack.language).toBe('rust');
  });

  it('should detect gwrk-native from docs/architecture.md (FR-030 rule 7)', async () => {
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (path.toString().includes('docs/architecture.md')) return;
      throw new Error();
    });

    const profile = await detectProfile('/tmp/project');
    expect(profile.type).toBe('gwrk-native');
  });

  it('should return unknown for empty directory (FR-030 rule 8)', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error());

    const profile = await detectProfile('/tmp/project');
    expect(profile.type).toBe('unknown');
  });

  it('should allow explicit config to override auto-detection (FR-032)', async () => {
    vi.mocked(fs.access).mockImplementation(async (path) => {
      if (path.toString().includes('Cargo.toml')) return;
      throw new Error();
    });

    const explicit = { type: 'gwrk-native' as const };
    const profile = await resolveProfile('/tmp/project', explicit);
    
    expect(profile.type).toBe('gwrk-native');
    expect(profile.stack.language).toBe('rust');
  });
});
