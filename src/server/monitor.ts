import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import type { GwrkConfig } from "../utils/config.js";
import type { SystemResources } from "./types.js";

/**
 * Returns available memory in bytes.
 * On macOS, os.freemem() only reports truly free pages (near zero on a busy Mac).
 * We parse vm_stat to include free + inactive + purgeable pages, which are all
 * reclaimable by the OS for new allocations.
 * Falls back to os.freemem() on non-macOS or if vm_stat fails.
 */
function getAvailableMemory(): number {
  if (process.platform !== "darwin") {
    return os.freemem();
  }

  try {
    const output = execSync("vm_stat", { encoding: "utf-8", timeout: 2000 });
    // Parse page size from first line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
    const pageSizeMatch = output.match(/page size of (\d+) bytes/);
    const pageSize = pageSizeMatch ? Number(pageSizeMatch[1]) : 16384;

    const getValue = (label: string): number => {
      const match = output.match(new RegExp(`${label}:\\s+(\\d+)`));
      return match ? Number(match[1]) : 0;
    };

    const free = getValue("Pages free");
    const inactive = getValue("Pages inactive");
    const purgeable = getValue("Pages purgeable");
    const speculative = getValue("Pages speculative");

    return (free + inactive + purgeable + speculative) * pageSize;
  } catch {
    return os.freemem();
  }
}

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
    // inactive/purgeable/cached), so it always reads near 0 on a busy Mac.
    // We parse vm_stat on macOS to get the real available memory.
    const memAvailable = getAvailableMemory();
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
