// src/server/index.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startServer, stopServer } from './index.js';
import type { GwrkConfig } from '../utils/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('FR-001, FR-002: Daemon Bootstrap', () => {
  let tempDir: string;
  let config: any; // Using any as config schema hasn't been updated yet

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-server-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    
    config = {
      project: { name: 'test-project' },
      agents: { define: 'gemini', implement: 'codex-cloud' },
      server: {
        port: 18790,
        host: '127.0.0.1'
      }
    };
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should start the Fastify server and bind to configured port', async () => {
    // US-001 acceptance scenario 1
    const instance = await startServer(config);
    expect(instance).toBeDefined();
    
    // Check if it's listening on the correct address
    const addresses = instance.addresses();
    expect(addresses.some(a => a.port === 18790)).toBe(true);

    // Verify /health returns 200
    const response = await instance.inject({
      method: 'GET',
      url: '/health'
    });
    expect(response.statusCode).toBe(200);

    await stopServer(instance);
  });

  it('should write a PID file on start', async () => {
    // US-007 acceptance scenario 1
    const instance = await startServer(config);
    const pidPath = path.join(tempDir, '.gwrk/server.pid');
    expect(fs.existsSync(pidPath)).toBe(true);
    
    await stopServer(instance);
  });

  it('should remove the PID file on stop', async () => {
    // US-002 acceptance scenario 1, US-007 acceptance scenario 2
    const instance = await startServer(config);
    const pidPath = path.join(tempDir, '.gwrk/server.pid');
    expect(fs.existsSync(pidPath)).toBe(true);

    await stopServer(instance);
    expect(fs.existsSync(pidPath)).toBe(false);
  });
});

describe('FR-003: Graceful Shutdown', () => {
  it('should close the server instance', async () => {
    // US-002
    const config = {
      project: { name: 'test-project' },
      agents: { define: 'gemini', implement: 'codex-cloud' },
      server: { port: 18791, host: '127.0.0.1' }
    };
    const instance = await startServer(config as any);
    await stopServer(instance);
    
    // After stop, injecting should fail or instance should be closed
    // Fastify instance doesn't have an easy "isClosed" prop, but we can check if it accepts requests
    await expect(instance.inject({ url: '/health' })).rejects.toThrow();
  });
});
