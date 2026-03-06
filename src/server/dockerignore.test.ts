// src/server/dockerignore.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('T012: Setup Docker ignore patterns', () => {
  it('.dockerignore exists and excludes node_modules and .git (US-008)', () => {
    // RED - File does not exist yet
    const dockerignorePath = join(process.cwd(), '.dockerignore');
    expect(existsSync(dockerignorePath)).toBe(true);

    const content = readFileSync(dockerignorePath, 'utf-8');
    expect(content).toContain('node_modules');
    expect(content).toContain('.git');
    expect(content).toContain('.gwrk/server.pid');
  });
});
