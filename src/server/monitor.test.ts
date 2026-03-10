import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { SystemMonitor } from "./monitor.js";

describe("SystemMonitor", () => {
  it("should sample system resources", () => {
    const monitor = new SystemMonitor();
    const stats = monitor.sample();

    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
    expect(stats.memPercent).toBeGreaterThanOrEqual(0);
    expect(stats.memPercent).toBeLessThanOrEqual(100);
    expect(stats.diskFreeGb).toBeGreaterThanOrEqual(0);
  });

  it("should throttle when limits are exceeded", () => {
    const monitor = new SystemMonitor();
    const config = {
      parallelism: {
        local: {
          maxCpu: 1, // Very low to trigger throttle
          maxMem: 80,
          minDiskGb: 10,
        },
      },
    };

    // We might need to mock sample to ensure it triggers
    vi.spyOn(monitor, "sample").mockReturnValue({
      cpuPercent: 90,
      memPercent: 50,
      diskFreeGb: 100,
    });

    expect(monitor.isThrottled(config)).toBe(true);
  });
});
