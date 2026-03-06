// src/commands/server.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { serverCommand } from './server.js';
import * as server from '../server/index.js';
import * as pidUtils from '../server/pid.js';
import * as configUtils from '../utils/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

vi.mock('../server/index.js');
vi.mock('../server/pid.js');
vi.mock('../utils/config.js');

describe('FR-001: gwrk server start', () => {
  let tempDir: string;
  let config: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-server-cmd-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });

    config = {
      project: { name: 'test-project' },
      agents: { define: 'gemini', implement: 'codex-cloud' },
      server: { port: 18790, host: '127.0.0.1' }
    };
    vi.mocked(configUtils.loadConfig).mockReturnValue(config);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should start the server if not already running', async () => {
    // US-001 acceptance scenario 1
    vi.mocked(pidUtils.readPid).mockReturnValue(null);
    vi.mocked(server.startServer).mockResolvedValue({} as any);

    await serverCommand.parseAsync(['start'], { from: 'user' });

    expect(server.startServer).toHaveBeenCalledWith(config);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('gwrk server listening on'));
  });

  it('should fail if server is already running', async () => {
    // US-001 acceptance scenario 2
    vi.mocked(pidUtils.readPid).mockReturnValue(1234);

    await expect(() =>
      serverCommand.parseAsync(['start'], { from: 'user' })
    ).rejects.toThrow('process.exit(1)');
    
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Server already running'));
    expect(server.startServer).not.toHaveBeenCalled();
  });
});

describe('FR-003: gwrk server stop', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-server-stop-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should stop the server if it is running', async () => {
    // US-002 acceptance scenario 1
    vi.mocked(pidUtils.readPid).mockReturnValue(1234);
    // In actual implementation, stop might send SIGTERM or use stopServer if internal
    // Spec says "sends SIGTERM to the daemon process (via PID file)"
    // So we might need to mock process.kill
    const killSpy = vi.spyOn(process, 'kill').mockReturnValue(true as any);

    await serverCommand.parseAsync(['stop'], { from: 'user' });

    expect(killSpy).toHaveBeenCalledWith(1234, 'SIGTERM');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Stopping gwrk server'));
  });

  it('should fail if no server is running', async () => {
    // US-002 acceptance scenario 2
    vi.mocked(pidUtils.readPid).mockReturnValue(null);

    await expect(() =>
      serverCommand.parseAsync(['stop'], { from: 'user' })
    ).rejects.toThrow('process.exit(1)');
    
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No server running'));
  });
});
