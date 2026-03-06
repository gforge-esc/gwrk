import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startServer, stopServer } from '../index.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('FR-005: Dispatch HTTP API', () => {
  let tempDir: string;
  let config: any;
  let server: any;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwrk-dispatch-api-test-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    
    // Mocking specs directory so feature exists
    fs.mkdirSync(path.join(tempDir, 'specs/f1'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'specs/f1/spec.md'), '# F1 Spec');

    config = {
      project: { name: 'test-project' },
      agents: { 
        defaults: { implement: 'gemini' },
        fallbackOrder: ['gemini']
      },
      parallelism: {
        local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 10 },
        cloud: { maxConcurrent: 10 }
      },
      server: { port: 18795, host: '127.0.0.1' }
    };

    server = await startServer(config);
  });

  afterEach(async () => {
    await stopServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('should accept a valid dispatch request', async () => {
    // US-004 acceptance scenario 1 (partial)
    const response = await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: {
        featureId: 'f1',
        phaseId: 'p1',
        backend: 'gemini'
      }
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.featureId).toBe('f1');
    expect(body.status).toBe('running'); // Should be running since queue is empty
  });

  it('should return 400 for unknown backend', async () => {
    // FR-005 error states
    const response = await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: {
        featureId: 'f1',
        phaseId: 'p1',
        backend: 'invalid-backend'
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('Unknown agent backend');
  });

  it('should return 404 for missing feature', async () => {
    // FR-005 error states
    const response = await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: {
        featureId: 'non-existent',
        phaseId: 'p1',
        backend: 'gemini'
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('Feature non-existent not found');
  });

  it('should return status of a specific dispatch', async () => {
    // US-004 acceptance scenario 1 (partial)
    await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: { featureId: 'f1', phaseId: 'p1', backend: 'gemini' }
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/dispatch/f1/p1'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('running');
  });

  it('should return full queue state', async () => {
    // US-005 acceptance scenario 1
    await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: { featureId: 'f1', phaseId: 'p1', backend: 'gemini' }
    });
    await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: { featureId: 'f1', phaseId: 'p2', backend: 'gemini' }
    });
    await server.inject({
      method: 'POST',
      url: '/api/dispatch',
      payload: { featureId: 'f1', phaseId: 'p3', backend: 'gemini' }
    });

    const response = await server.inject({
      method: 'GET',
      url: '/api/dispatch/queue'
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.active.length).toBe(2);
    expect(body.queued.length).toBe(1);
  });
});
