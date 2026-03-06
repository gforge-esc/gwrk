import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('TR-008: Server Integration', () => {
  let tempDir: string;
  let serverProcess: any;
  const PORT = 18798;
  const HOST = '127.0.0.1';

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-integration-test-'));
    
    // Prepare .gwrkrc.json
    const config = {
      project: { name: 'test-project' },
      agents: { 
        defaults: { implement: 'gemini' },
        fallbackOrder: ['gemini']
      },
      parallelism: {
        local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 10 },
        cloud: { maxConcurrent: 10 }
      },
      server: { port: PORT, host: HOST }
    };
    fs.writeFileSync(path.join(tempDir, '.gwrkrc.json'), JSON.stringify(config));
    
    // Mock specs directory
    fs.mkdirSync(path.join(tempDir, 'specs/f1'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'specs/f1/spec.md'), '# F1 Spec');
    fs.mkdirSync(path.join(tempDir, '.gwrk'), { recursive: true });
  });

  afterEach(() => {
    if (serverProcess) {
      serverProcess.kill();
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle full lifecycle: start -> dispatch -> status -> stop', async () => {
    // US-001, US-002, US-003, US-004
    
    // 1. Start server
    serverProcess = spawn('npx', ['tsx', 'src/cli.ts', 'server', 'start'], {
      cwd: tempDir,
      env: { ...process.env, NODE_ENV: 'test' }
    });

    // Wait for server to be ready
    let ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        const res = await fetch(`http://${HOST}:${PORT}/health`);
        if (res.status === 200) {
          ready = true;
          break;
        }
      } catch (e) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!ready) {
      throw new Error('Server failed to start (expected in RED state)');
    }

    // 2. Dispatch a phase
    const dispatchRes = await fetch(`http://${HOST}:${PORT}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        featureId: 'f1',
        phaseId: 'p1',
        backend: 'gemini'
      })
    });
    expect(dispatchRes.status).toBe(201);

    // 3. Check status
    const statusRes = await fetch(`http://${HOST}:${PORT}/api/status`);
    const statusData = await statusRes.json() as any;
    expect(statusData.server.status).toBe('running');
    expect(statusData.dispatch.activeCount).toBe(1);

    // 4. Stop server
    const stopProcess = spawn('npx', ['tsx', 'src/cli.ts', 'server', 'stop'], {
      cwd: tempDir
    });
    
    await new Promise((resolve) => stopProcess.on('exit', resolve));
    
    // Verify port released
    await expect(fetch(`http://${HOST}:${PORT}/health`)).rejects.toThrow();
  });
});
