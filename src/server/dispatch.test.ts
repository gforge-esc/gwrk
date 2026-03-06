import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DispatchQueue } from './dispatch.js';
import type { GwrkConfig } from '../utils/config.js';
import type { DispatchRecord, DispatchRequest } from './types.js';

describe('FR-008: Dispatch Queue (FIFO)', () => {
  let queue: DispatchQueue;
  let mockDeps: any;
  let config: GwrkConfig;

  beforeEach(() => {
    config = {
      project: { name: 'test-project' },
      agents: { 
        defaults: { implement: 'gemini' },
        fallbackOrder: ['gemini', 'claude']
      },
      parallelism: {
        local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 10 },
        cloud: { maxConcurrent: 10 }
      },
      server: { port: 18790, host: '127.0.0.1' }
    } as any;

    mockDeps = {
      config,
      sandbox: { 
        createSandbox: vi.fn().mockResolvedValue({ containerId: 'c1' }),
        destroySandbox: vi.fn().mockResolvedValue(undefined)
      },
      gitManager: { 
        createPhaseBranch: vi.fn().mockResolvedValue('phase/f1-p1'),
        mergePhaseBack: vi.fn().mockResolvedValue(undefined)
      },
      context: { 
        compileContext: vi.fn().mockResolvedValue('# Context'),
        writeContextToSandbox: vi.fn().mockResolvedValue(undefined)
      },
      monitor: { 
        isThrottled: vi.fn().mockReturnValue(false)
      },
      persist: { 
        persistDispatch: vi.fn()
      }
    };

    queue = new DispatchQueue(mockDeps);
  });

  it('should process dispatches in FIFO order', async () => {
    // US-005 acceptance scenario 1 (partial)
    const req1: DispatchRequest = { featureId: 'f1', phaseId: 'p1', backend: 'gemini' };
    const req2: DispatchRequest = { featureId: 'f1', phaseId: 'p2', backend: 'gemini' };
    const req3: DispatchRequest = { featureId: 'f1', phaseId: 'p3', backend: 'gemini' };

    queue.enqueue(req1);
    queue.enqueue(req2);
    queue.enqueue(req3);

    const state = queue.getQueue();
    expect(state.active.length).toBe(2); // maxClones = 2
    expect(state.queued.length).toBe(1);
    expect(state.active[0].phaseId).toBe('p1');
    expect(state.active[1].phaseId).toBe('p2');
    expect(state.queued[0].phaseId).toBe('p3');
  });

  it('should respect maxClones throttling', async () => {
    // US-005
    const reqs = [1, 2, 3].map(i => ({ featureId: 'f1', phaseId: `p${i}`, backend: 'gemini' } as DispatchRequest));
    reqs.forEach(r => queue.enqueue(r));

    expect(mockDeps.sandbox.createSandbox).toHaveBeenCalledTimes(2);
    expect(queue.getQueue().active.length).toBe(2);
    expect(queue.getQueue().queued.length).toBe(1);
  });

  it('should pause dispatch when monitor is throttled', async () => {
    // US-010 acceptance scenario 1
    mockDeps.monitor.isThrottled.mockReturnValue(true);
    
    queue.enqueue({ featureId: 'f1', phaseId: 'p1', backend: 'gemini' });
    
    expect(mockDeps.sandbox.createSandbox).not.toHaveBeenCalled();
    expect(queue.getQueue().active.length).toBe(0);
    expect(queue.getQueue().queued.length).toBe(1);
    expect(queue.getQueue().throttled).toBe(true);
  });
});

describe('FR-009: Retry & Escalation', () => {
  let queue: DispatchQueue;
  let mockDeps: any;
  let config: GwrkConfig;

  beforeEach(() => {
    config = {
      project: { name: 'test-project' },
      agents: { 
        defaults: { implement: 'gemini' },
        fallbackOrder: ['gemini', 'claude']
      },
      parallelism: {
        local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 10 },
        cloud: { maxConcurrent: 10 }
      },
      server: { port: 18790, host: '127.0.0.1' }
    } as any;

    mockDeps = {
      config,
      sandbox: { 
        createSandbox: vi.fn().mockResolvedValue({ containerId: 'c1' }),
        destroySandbox: vi.fn().mockResolvedValue(undefined)
      },
      gitManager: { 
        createPhaseBranch: vi.fn().mockResolvedValue('phase/f1-p1'),
        mergePhaseBack: vi.fn().mockResolvedValue(undefined)
      },
      context: { 
        compileContext: vi.fn().mockResolvedValue('# Context'),
        writeContextToSandbox: vi.fn().mockResolvedValue(undefined)
      },
      monitor: { isThrottled: vi.fn().mockReturnValue(false) },
      persist: { persistDispatch: vi.fn() }
    };

    queue = new DispatchQueue(mockDeps);
  });

  it('should retry 3 times on the same backend before escalating', async () => {
    // US-005 acceptance scenario 2 (partial)
    const record = queue.enqueue({ featureId: 'f1', phaseId: 'p1', backend: 'gemini' });
    
    // Fail 1st attempt
    await queue.handleCompletion(record.id, 1, 'Error 1');
    expect(queue.getDispatch('f1', 'p1')?.attempts.length).toBe(2);
    expect(queue.getDispatch('f1', 'p1')?.attempts[1].backend).toBe('gemini');

    // Fail 2nd attempt
    await queue.handleCompletion(record.id, 1, 'Error 2');
    expect(queue.getDispatch('f1', 'p1')?.attempts.length).toBe(3);
    expect(queue.getDispatch('f1', 'p1')?.attempts[2].backend).toBe('gemini');

    // Fail 3rd attempt
    await queue.handleCompletion(record.id, 1, 'Error 3');
    expect(queue.getDispatch('f1', 'p1')?.attempts.length).toBe(4);
    expect(queue.getDispatch('f1', 'p1')?.attempts[3].backend).toBe('claude'); // Escalated
  });

  it('should fail after exhausting all backends', async () => {
    const record = queue.enqueue({ featureId: 'f1', phaseId: 'p1', backend: 'gemini' });
    
    // Fail 3 times gemini
    await queue.handleCompletion(record.id, 1, 'err');
    await queue.handleCompletion(record.id, 1, 'err');
    await queue.handleCompletion(record.id, 1, 'err');
    
    // Now on claude (attempt 4)
    expect(queue.getDispatch('f1', 'p1')?.attempts[3].backend).toBe('claude');

    // Fail 3 times claude
    await queue.handleCompletion(record.id, 1, 'err');
    await queue.handleCompletion(record.id, 1, 'err');
    await queue.handleCompletion(record.id, 1, 'err');

    // 7th attempt would be next backend, but only gemini, claude in fallbackOrder
    // So it should mark as failed
    const finalRecord = queue.getDispatch('f1', 'p1');
    expect(finalRecord?.status).toBe('failed');
  });

  it('should merge back on successful completion', async () => {
    // US-006 acceptance scenario 2
    const record = queue.enqueue({ featureId: 'f1', phaseId: 'p1', backend: 'gemini' });
    
    await queue.handleCompletion(record.id, 0, '');
    
    expect(mockDeps.gitManager.mergePhaseBack).toHaveBeenCalledWith('f1', 'p1');
    expect(queue.getDispatch('f1', 'p1')?.status).toBe('completed');
  });
});
