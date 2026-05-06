import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SystemMonitor } from "./monitor.js";
import type { GwrkConfig } from "../utils/config.js";

const TEST_CONFIG = {
  parallelism: {
    local: { maxClones: 2, maxCpu: 80, maxMem: 70, minDiskGb: 5 },
    cloud: { maxConcurrent: 5 },
  },
} as GwrkConfig;

// FR-014: System resource monitoring
describe("FR-014: SystemMonitor", () => {
  let monitor: SystemMonitor;

  beforeEach(() => {
    monitor = new SystemMonitor(TEST_CONFIG);
  });

  afterEach(() => {
    monitor.stopPolling();
  });

  // US-003 #1: sample() returns valid resource metrics
  describe("sample()", () => {
    it("US-003 #1: returns cpuPercent as number between 0 and 100", () => {
      const resources = monitor.sample();
      expect(resources.cpuPercent).toBeGreaterThanOrEqual(0);
      expect(resources.cpuPercent).toBeLessThanOrEqual(100);
    });

    it("US-003 #2: returns memPercent as number between 0 and 100", () => {
      const resources = monitor.sample();
      expect(resources.memPercent).toBeGreaterThanOrEqual(0);
      expect(resources.memPercent).toBeLessThanOrEqual(100);
    });

    it("US-003 #3: returns diskFreeGb as positive number", () => {
      const resources = monitor.sample();
      expect(resources.diskFreeGb).toBeGreaterThan(0);
    });
  });

  // US-010 #1: isThrottled() checks against config limits
  describe("isThrottled()", () => {
    it("US-010 #1: returns false when all resources are within limits", () => {
      // With generous limits, should not be throttled on dev machine
      const generousConfig = {
        parallelism: {
          local: { maxClones: 2, maxCpu: 99, maxMem: 99, minDiskGb: 0.1 },
          cloud: { maxConcurrent: 5 },
        },
      } as GwrkConfig;
      const m = new SystemMonitor(generousConfig);
      expect(m.isThrottled()).toBe(false);
      m.stopPolling();
    });

    it("US-010 #2: returns true when CPU exceeds maxCpu", () => {
      const tightConfig = {
        parallelism: {
          local: { maxClones: 2, maxCpu: 0, maxMem: 99, minDiskGb: 0.1 },
          cloud: { maxConcurrent: 5 },
        },
      } as GwrkConfig;
      const m = new SystemMonitor(tightConfig);
      // CPU is always > 0, so with maxCpu=0 this should throttle
      expect(m.isThrottled()).toBe(true);
      m.stopPolling();
    });

    it("US-010 #3: returns true when disk is below minDiskGb", () => {
      const tightConfig = {
        parallelism: {
          local: { maxClones: 2, maxCpu: 99, maxMem: 99, minDiskGb: 999999 },
          cloud: { maxConcurrent: 5 },
        },
      } as GwrkConfig;
      const m = new SystemMonitor(tightConfig);
      // No machine has 999999 GB free
      expect(m.isThrottled()).toBe(true);
      m.stopPolling();
    });
  });

  // Polling lifecycle
  describe("startPolling() / stopPolling()", () => {
    it("US-003 #4: startPolling begins periodic sampling", () => {
      monitor.startPolling(100);
      // After starting, getStatus should return cached data
      const status = monitor.getStatus();
      expect(status.server).toBeDefined();
      expect(status.system).toBeDefined();
    });

    it("US-003 #5: stopPolling clears the interval", () => {
      monitor.startPolling(100);
      monitor.stopPolling();
      // Should not throw after stopping
      expect(() => monitor.stopPolling()).not.toThrow();
    });
  });

  // getStatus() shape validation
  describe("getStatus()", () => {
    it("US-003 #6: returns SystemStatus with all required fields", () => {
      const status = monitor.getStatus();
      expect(status).toHaveProperty("server");
      expect(status).toHaveProperty("system");
      expect(status).toHaveProperty("dispatch");
      expect(status).toHaveProperty("sandboxes");
      expect(status.system).toHaveProperty("cpuPercent");
      expect(status.system).toHaveProperty("memPercent");
      expect(status.system).toHaveProperty("diskFreeGb");
    });
  });
});
