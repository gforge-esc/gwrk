import os from "node:os";
import fs from "node:fs";

export interface SystemStatus {
  cpuPercent: number;
  memPercent: number;
  diskFreeGb: number;
}

export class SystemMonitor {
  private lastCpus: os.CpuInfo[] | undefined;
  private lastTime: number | undefined;

  constructor() {
    this.lastCpus = os.cpus();
    this.lastTime = Date.now();
  }

  sample(): SystemStatus {
    const currentCpus = os.cpus();
    const currentTime = Date.now();

    let totalIdle = 0;
    let totalTick = 0;

    if (this.lastCpus) {
      for (let i = 0; i < currentCpus.length; i++) {
        const cpu = currentCpus[i];
        const lastCpu = this.lastCpus[i];
        
        const idle = cpu.times.idle - lastCpu.times.idle;
        let total = 0;
        for (const type in cpu.times) {
          total += (cpu.times as any)[type] - (lastCpu.times as any)[type];
        }
        
        totalIdle += idle;
        totalTick += total;
      }
    }

    const cpuPercent = totalTick > 0 ? (1 - totalIdle / totalTick) * 100 : 0;
    
    this.lastCpus = currentCpus;
    this.lastTime = currentTime;

    const memFree = os.freemem();
    const memTotal = os.totalmem();
    const memPercent = (1 - memFree / memTotal) * 100;

    let diskFreeGb = 0;
    try {
      // Use project root or current dir
      const stats = fs.statfsSync(".");
      diskFreeGb = Number((BigInt(stats.bavail) * BigInt(stats.bsize) / BigInt(1024 * 1024 * 1024)));
    } catch (e) {
      // Fallback or ignore
    }

    return {
      cpuPercent: Number(cpuPercent.toFixed(1)),
      memPercent: Number(memPercent.toFixed(1)),
      diskFreeGb: Number(diskFreeGb.toFixed(1))
    };
  }

  isThrottled(config: any): boolean {
    const stats = this.sample();
    return (
      stats.cpuPercent > config.parallelism.local.maxCpu ||
      stats.memPercent > config.parallelism.local.maxMem ||
      stats.diskFreeGb < config.parallelism.local.minDiskGb
    );
  }
}
