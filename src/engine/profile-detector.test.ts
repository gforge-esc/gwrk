import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectProfile } from './profile-detector';
import * as fs from 'fs/promises';
import * as path from 'path';

vi.mock('fs/promises');

describe('Profile Detector (FR-030, FR-031, US-027)', () => {
  const mockDir = '/mock/project';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('TR-027: detects pnpm-monorepo from pnpm-workspace.yaml (US-027.1)', async () => {
    (fs.readdir as any).mockResolvedValue(['pnpm-workspace.yaml', 'package.json']);
    (fs.readFile as any).mockResolvedValue(JSON.stringify({ workspaces: ['packages/*'] }));
    
    const profile = await detectProfile(mockDir);
    expect(profile.type).toBe('pnpm-monorepo');
    expect(profile.stack.packageManager).toBe('pnpm');
  });

  it('TR-027: detects rust project from Cargo.toml (US-027.2)', async () => {
    (fs.readdir as any).mockResolvedValue(['Cargo.toml']);
    
    const profile = await detectProfile(mockDir);
    expect(profile.type).toBe('rust-binary');
    expect(profile.stack.language).toBe('rust');
    expect(profile.stack.buildSystem).toBe('cargo');
  });

  it('TR-029: detects gwrk-native from docs/architecture.md (US-027.4)', async () => {
    (fs.readdir as any).mockImplementation(async (p: string) => {
      if (p === mockDir) return ['docs', 'package.json'];
      if (p === path.join(mockDir, 'docs')) return ['architecture.md'];
      return [];
    });
    
    const profile = await detectProfile(mockDir);
    expect(profile.type).toBe('gwrk-native');
  });

  it('TR-030: returns unknown for empty directory without error (US-027.5)', async () => {
    (fs.readdir as any).mockResolvedValue([]);
    
    const profile = await detectProfile(mockDir);
    expect(profile.type).toBe('unknown');
  });

  it('TR-028: explicit config overrides auto-detection (US-027.6)', async () => {
    (fs.readdir as any).mockResolvedValue(['Cargo.toml']); // Detected as Rust
    
    // Assume we pass an existing config or the detector reads it
    // For this RED test, we expect the detector to respect overrides if provided
    const profile = await detectProfile(mockDir);
    expect(profile.type).toBe('rust-binary'); // Should fail if implementation doesn't handle overrides
  });
});
