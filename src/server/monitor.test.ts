// src/server/monitor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SystemMonitor } from './monitor';
import os from 'os';
import { execSync } from 'child_process';

vi.mock('os');
vi.mock('child_process');

describe('FR-014: System Resource Monitoring', () => {
  const mockConfig = {
    parallelism: {
      local: {
        maxCpu: 80,
        maxMem: 70,
        minDiskGb: 10,
        maxClones: 3
      }
    }
  } as any;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('US-010 acceptance scenario 1: samples CPU, memory, and disk correctly', () => {
    // Mock CPU: total 100, idle 20 -> 80% usage
    vi.mocked(os.cpus).mockReturnValue([
      { times: { user: 40, nice: 0, sys: 40, idle: 20, irq: 0 } }
    ] as any);
    // Mock Mem: total 1000, free 300 -> 70% usage
    vi.mocked(os.totalmem).mockReturnValue(1000);
    vi.mocked(os.freemem).mockReturnValue(300);
    // Mock Disk: df -BG / -> outputs something with 15G free
    vi.mocked(execSync).mockReturnValue(Buffer.from('Filesystem 1G-blocks Used Available Use% Mounted on\n/dev/sda1 100G 85G 15G 85% /'));

    const monitor = new SystemMonitor(mockConfig);
    const sample = monitor.sample();

    expect(sample.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(sample.cpuPercent).toBeLessThanOrEqual(100);
    expect(sample.memPercent).toBe(70);
    expect(sample.diskFreeGb).toBe(15);
  });

  it('US-010 acceptance scenario 2: throttles when CPU exceeds limit', () => {
    // 90% CPU usage
    vi.mocked(os.cpus).mockReturnValue([
      { times: { user: 45, nice: 0, sys: 45, idle: 10, irq: 0 } }
    ] as any);
    vi.mocked(os.totalmem).mockReturnValue(1000);
    vi.mocked(os.freemem).mockReturnValue(500);
    vi.mocked(execSync).mockReturnValue(Buffer.from('... 50G ...'));

    const monitor = new SystemMonitor(mockConfig);
    monitor.sample();
    expect(monitor.isThrottled()).toBe(true);
  });

  it('US-010 acceptance scenario 3: throttles when memory exceeds limit', () => {
    vi.mocked(os.cpus).mockReturnValue([{ times: { idle: 100 } }] as any);
    // 80% Mem usage (limit is 70)
    vi.mocked(os.totalmem).mockReturnValue(1000);
    vi.mocked(os.freemem).mockReturnValue(200);
    vi.mocked(execSync).mockReturnValue(Buffer.from('... 50G ...'));

    const monitor = new SystemMonitor(mockConfig);
    monitor.sample();
    expect(monitor.isThrottled()).toBe(true);
  });

  it('US-010 acceptance scenario 4: throttles when disk is below minimum', () => {
    vi.mocked(os.cpus).mockReturnValue([{ times: { idle: 100 } }] as any);
    vi.mocked(os.totalmem).mockReturnValue(1000);
    vi.mocked(os.freemem).mockReturnValue(800);
    // 5G free (limit is 10G)
    vi.mocked(execSync).mockReturnValue(Buffer.from('Filesystem 1G-blocks Used Available Use% Mounted on\n/dev/sda1 100G 95G 5G 95% /'));

    const monitor = new SystemMonitor(mockConfig);
    monitor.sample();
    expect(monitor.isThrottled()).toBe(true);
  });

  it('rejects invalid input: handles disk check failure', () => {
    // Negative path — FR-014 error state
    vi.mocked(execSync).mockImplementation(() => { throw new Error('df failed'); });
    
    const monitor = new SystemMonitor(mockConfig);
    // Should gracefully handle or throw according to contract (monitor.md doesn't specify but US-010 implies error message)
    expect(() => monitor.sample()).toThrow('df failed');
  });
});
