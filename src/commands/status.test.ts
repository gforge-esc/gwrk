// src/commands/status.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { statusCommand } from './status';

// Mock the server response
const mockRunningStatus = {
  server: { status: 'running', pid: 1234, uptime: 3600, port: 18790 },
  system: { cpuPercent: 45, memPercent: 50, diskFreeGb: 15 },
  dispatch: { queueDepth: 0, activeCount: 0, completedCount: 10, failedCount: 1 },
  sandboxes: []
};

const mockStoppedStatus = {
  server: { status: 'stopped' }
};

describe('FR-004: Status CLI Command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Assuming the command uses a fetch wrapper or something we can mock
    global.fetch = vi.fn();
  });

  it('US-003 acceptance scenario 1: displays running status and metrics when daemon is active', async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => mockRunningStatus
    } as any);

    // We'll need a way to capture the output, maybe mock console.log or use a return value
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    // In actual implementation, we'll pass args or use a mock commander instance
    await statusCommand.parseAsync(['node', 'gwrk', 'status', '--json']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"status": "running"'));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"cpuPercent": 45'));
  });

  it('US-003 acceptance scenario 2: displays stopped status when daemon is not active', async () => {
    // Simulate connection refused
    vi.mocked(global.fetch).mockRejectedValue(new Error('Connection refused'));

    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    await statusCommand.parseAsync(['node', 'gwrk', 'status', '--json']);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('"status": "stopped"'));
  });

  it('rejects invalid input: handles server returning 500', async () => {
    // Negative path — FR-004 error state
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error'
    } as any);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    await statusCommand.parseAsync(['node', 'gwrk', 'status']);
    
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Error querying status'));
  });
});
