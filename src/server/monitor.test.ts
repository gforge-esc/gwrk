/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { SystemMonitor } from "./monitor.js";

describe("SystemMonitor", () => {
  const mockConfig: GwrkConfig = {
    project: { name: "test" },
    agents: { define: "gemini", implement: "gemini" },
    server: { host: "localhost", port: 18790 },
    parallelism: {
      local: {
        maxCpu: 80,
        maxMem: 70,
        minDiskGb: 10,
        maxClones: 3,
      },
      cloud: { maxConcurrent: 10 },
    },
  };

  it("should sample system resources", () => {
    const monitor = new SystemMonitor(mockConfig);
    const stats = monitor.sample();

    expect(stats.cpuPercent).toBeGreaterThanOrEqual(0);
    expect(stats.cpuPercent).toBeLessThanOrEqual(100);
    expect(stats.memPercent).toBeGreaterThanOrEqual(0);
    expect(stats.memPercent).toBeLessThanOrEqual(100);
    expect(stats.diskFreeGb).toBeGreaterThanOrEqual(0);
  });

  it("should throttle when CPU limits are exceeded", () => {
    const monitor = new SystemMonitor(mockConfig);

    vi.spyOn(monitor, "sample").mockReturnValue({
      cpuPercent: 90,
      memPercent: 50,
      diskFreeGb: 100,
    });

    expect(monitor.isThrottled()).toBe(true);
  });

  it("should throttle when Memory limits are exceeded", () => {
    const monitor = new SystemMonitor(mockConfig);

    vi.spyOn(monitor, "sample").mockReturnValue({
      cpuPercent: 50,
      memPercent: 80,
      diskFreeGb: 100,
    });

    expect(monitor.isThrottled()).toBe(true);
  });

  it("should throttle when Disk limits are exceeded", () => {
    const monitor = new SystemMonitor(mockConfig);

    vi.spyOn(monitor, "sample").mockReturnValue({
      cpuPercent: 50,
      memPercent: 50,
      diskFreeGb: 5,
    });

    expect(monitor.isThrottled()).toBe(true);
  });

  it("should not throttle when within limits", () => {
    const monitor = new SystemMonitor(mockConfig);

    vi.spyOn(monitor, "sample").mockReturnValue({
      cpuPercent: 50,
      memPercent: 50,
      diskFreeGb: 100,
    });

    expect(monitor.isThrottled()).toBe(false);
  });

  it("should support polling", async () => {
    vi.useFakeTimers();
    const monitor = new SystemMonitor(mockConfig);
    const sampleSpy = vi.spyOn(monitor, "sample");

    monitor.startPolling(5000);

    vi.advanceTimersByTime(5000);
    expect(sampleSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(sampleSpy).toHaveBeenCalledTimes(2);

    monitor.stopPolling();
    vi.advanceTimersByTime(5000);
    expect(sampleSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
