import * as os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GwrkConfig } from "../utils/config.js";
import { NetworkMonitor } from "./network.js";

vi.mock("node:os", () => ({
  networkInterfaces: vi.fn(),
}));

describe("NetworkMonitor", () => {
  let config: GwrkConfig;
  let monitor: NetworkMonitor;

  beforeEach(() => {
    vi.useFakeTimers();
    config = {
      server: {
        networkCheckIntervalMs: 1000,
      },
    } as any;
    monitor = new NetworkMonitor(config);
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  it("should detect online state when interfaces are present", () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      en0: [
        {
          address: "192.168.1.1",
          family: "IPv4",
          internal: false,
          netmask: "255.255.255.0",
          mac: "00:00:00:00:00:00",
          cidr: "192.168.1.1/24",
        },
      ],
    });

    expect(monitor.isOnline()).toBe(true);
  });

  it("should detect offline state when no external interfaces are present", () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      lo0: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          internal: true,
          netmask: "255.0.0.0",
          mac: "00:00:00:00:00:00",
          cidr: "127.0.0.1/8",
        },
      ],
    });

    expect(monitor.isOnline()).toBe(false);
  });

  it("should emit network:down when going offline", () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      en0: [{ address: "1.2.3.4", internal: false, family: "IPv4" } as any],
    });
    monitor.start();
    expect(monitor.getStatus()).toBe("online");

    const downSpy = vi.fn();
    monitor.on("network:down", downSpy);

    vi.mocked(os.networkInterfaces).mockReturnValue({
      lo0: [{ internal: true } as any],
    });
    vi.advanceTimersByTime(1000);

    expect(monitor.getStatus()).toBe("offline");
    expect(downSpy).toHaveBeenCalled();
  });

  it("should emit network:up when going online", () => {
    vi.mocked(os.networkInterfaces).mockReturnValue({
      lo0: [{ internal: true } as any],
    });
    monitor.start();
    expect(monitor.getStatus()).toBe("offline");

    const upSpy = vi.fn();
    monitor.on("network:up", upSpy);

    vi.mocked(os.networkInterfaces).mockReturnValue({
      en0: [{ address: "1.2.3.4", internal: false, family: "IPv4" } as any],
    });
    vi.advanceTimersByTime(1000);

    expect(monitor.getStatus()).toBe("online");
    expect(upSpy).toHaveBeenCalled();
  });
});
