import * as fs from "node:fs";
import * as os from "node:os";
export class SystemMonitor {
    config;
    lastCpus;
    interval;
    currentResources;
    constructor(config) {
        this.config = config;
        this.lastCpus = os.cpus();
        this.currentResources = this.sample();
    }
    /**
     * Samples system resources and updates internal cache.
     */
    sample() {
        const currentCpus = os.cpus();
        let totalIdle = 0;
        let totalTick = 0;
        if (this.lastCpus) {
            for (let i = 0; i < currentCpus.length; i++) {
                const cpu = currentCpus[i];
                const lastCpu = this.lastCpus[i];
                if (!lastCpu)
                    continue;
                const idle = cpu.times.idle - lastCpu.times.idle;
                let total = 0;
                for (const type in cpu.times) {
                    total +=
                        cpu.times[type] -
                            lastCpu.times[type];
                }
                totalIdle += idle;
                totalTick += total;
            }
        }
        const cpuPercent = totalTick > 0 ? (1 - totalIdle / totalTick) * 100 : 0;
        this.lastCpus = currentCpus;
        const memFree = os.freemem();
        const memTotal = os.totalmem();
        const memPercent = (1 - memFree / memTotal) * 100;
        let diskFreeGb = 0;
        try {
            const stats = fs.statfsSync(".");
            diskFreeGb = Number((BigInt(stats.bavail) * BigInt(stats.bsize)) /
                BigInt(1024 * 1024 * 1024));
        }
        catch (e) {
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
    isThrottled() {
        // If we're polling, use cached resources. Otherwise, sample now.
        const stats = this.interval ? this.currentResources : this.sample();
        return (stats.cpuPercent > this.config.parallelism.local.maxCpu ||
            stats.memPercent > this.config.parallelism.local.maxMem ||
            stats.diskFreeGb < this.config.parallelism.local.minDiskGb);
    }
    /**
     * Starts periodic sampling at the specified interval.
     */
    startPolling(intervalMs = 10000) {
        if (this.interval)
            this.stopPolling();
        this.interval = setInterval(() => {
            this.sample();
        }, intervalMs);
    }
    /**
     * Stops the polling interval.
     */
    stopPolling() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = undefined;
        }
    }
    /**
     * Returns current cached or sampled resources.
     */
    getResources() {
        return this.currentResources;
    }
}
