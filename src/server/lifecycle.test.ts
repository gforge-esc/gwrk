import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { LifecycleMonitor } from "./lifecycle.js";

describe("LifecycleMonitor", () => {
  let config: GwrkConfig;
  let monitor: LifecycleMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    config = {
      server: {
        heartbeatIntervalMs: 1000,
      },
    } as any;
    monitor = new LifecycleMonitor(config);
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  it("should start in ready state", () => {
    monitor.start();
    expect(monitor.getStatus()).toBe("ready");
  });

  it("should detect sleep when heartbeat drifts", async () => {
    monitor.start();
    const sleepSpy = vi.fn();
    monitor.on("server:sleep", sleepSpy);

    // Simulate drift by moving clock forward but not calling interval
    vi.setSystemTime(Date.now() + 4000);
    vi.advanceTimersByTime(1000); // Trigger the interval

    expect(monitor.getStatus()).toBe("sleeping");
    expect(sleepSpy).toHaveBeenCalled();
  });

  it("should detect wake when heartbeat resumes", async () => {
    monitor.start();
    const wakeSpy = vi.fn();
    monitor.on("server:wake", wakeSpy);

    // Sleep
    vi.setSystemTime(Date.now() + 4000);
    vi.advanceTimersByTime(1000);
    expect(monitor.getStatus()).toBe("sleeping");

    // Wake
    vi.advanceTimersByTime(1000);
    expect(wakeSpy).toHaveBeenCalled();
  });
});
