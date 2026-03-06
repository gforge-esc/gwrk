// src/server/dockerfile.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('T013: Create gwrk-sandbox Dockerfile', () => {
  it('Dockerfile.sandbox exists in the root (US-008)', () => {
    // RED - File does not exist yet
    const dockerfilePath = join(process.cwd(), 'Dockerfile.sandbox');
    expect(existsSync(dockerfilePath)).toBe(true);
  });

  it('contains essential gwrk-sandbox instructions (US-008)', () => {
    const dockerfilePath = join(process.cwd(), 'Dockerfile.sandbox');
    // This will fail if the file doesn't exist
    const content = readFileSync(dockerfilePath, 'utf-8');
    
    expect(content).toContain('FROM node:');
    expect(content).toContain('apt-get install -y git');
    expect(content).toContain('gh');
    expect(content).toContain('WORKDIR /workspace');
  });
});
