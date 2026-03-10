import * as fs from "node:fs";
import * as os from "node:os";
import type { GwrkConfig } from "../utils/config.js";
import type { SystemResources } from "./types.js";

export class SystemMonitor {
  private lastCpus: os.CpuInfo[] | undefined;
  private interval: NodeJS.Timeout | undefined;
  private currentResources: SystemResources;

  constructor(private config: GwrkConfig) {
    this.lastCpus = os.cpus();
    this.currentResources = this.sample();
  }

  /**
   * Samples system resources and updates internal cache.
   */
  sample(): SystemResources {
    const currentCpus = os.cpus();

    let totalIdle = 0;
    let totalTick = 0;

    if (this.lastCpus) {
      for (let i = 0; i < currentCpus.length; i++) {
        const cpu = currentCpus[i];
        const lastCpu = this.lastCpus[i];

        if (!lastCpu) continue;

        const idle = cpu.times.idle - lastCpu.times.idle;
        let total = 0;
        for (const type in cpu.times) {
          total +=
            (cpu.times as Record<string, number>)[type] -
            (lastCpu.times as Record<string, number>)[type];
        }

        totalIdle += idle;
        totalTick += total;
      }
    }

    const cpuPercent = totalTick > 0 ? (1 - totalIdle / totalTick) * 100 : 0;

    this.lastCpus = currentCpus;

    const memTotal = os.totalmem();
    // os.freemem() on macOS returns only truly free memory (excludes
    // cached/purgeable), so it always reads near 0.  Node 22+ provides
    // os.availableMemory() which accounts for reclaimable pages.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const osExt = os as Record<string, unknown>;
    const memAvailable =
      typeof osExt.availableMemory === "function"
        ? (osExt.availableMemory as () => number)()
        : os.freemem();
    const memPercent = ((memTotal - memAvailable) / memTotal) * 100;

    let diskFreeGb = 0;
    try {
      const stats = fs.statfsSync(".");
      diskFreeGb = Number(
        (BigInt(stats.bavail) * BigInt(stats.bsize)) /
          BigInt(1024 * 1024 * 1024),
      );
    } catch (e) {
      // Fallback or ignore
    }

    this.currentResources = {
      cpuPercent: Number(cpuPercent.toFixed(1)),
      memPercent: Number(memPercent.toFixed(1)),
      diskFreeGb: Number(diskFreeGb.toFixed(1)),
    };

    return this.currentResources;
  }

  /**
   * Returns true if any resource exceeds configured limits.
   */
  isThrottled(): boolean {
    // If we're polling, use cached resources. Otherwise, sample now.
    const stats = this.interval ? this.currentResources : this.sample();

    return (
      stats.cpuPercent > this.config.parallelism.local.maxCpu ||
      stats.memPercent > this.config.parallelism.local.maxMem ||
      stats.diskFreeGb < this.config.parallelism.local.minDiskGb
    );
  }

  /**
   * Starts periodic sampling at the specified interval.
   */
  startPolling(intervalMs = 10000): void {
    if (this.interval) this.stopPolling();

    this.interval = setInterval(() => {
      this.sample();
    }, intervalMs);
  }

  /**
   * Stops the polling interval.
   */
  stopPolling(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
  }

  /**
   * Returns current cached or sampled resources.
   */
  getResources(): SystemResources {
    return this.currentResources;
  }
}
