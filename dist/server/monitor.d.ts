import type { GwrkConfig } from "../utils/config.js";
import type { SystemStatus as SystemResources } from "./types.js";
export declare class SystemMonitor {
    private config;
    private lastCpus;
    private interval;
    private currentResources;
    constructor(config: GwrkConfig);
    /**
     * Samples system resources and updates internal cache.
     */
    sample(): SystemResources;
    /**
     * Returns true if any resource exceeds configured limits.
     */
    isThrottled(): boolean;
    /**
     * Starts periodic sampling at the specified interval.
     */
    startPolling(intervalMs?: number): void;
    /**
     * Stops the polling interval.
     */
    stopPolling(): void;
    /**
     * Returns current cached or sampled resources.
     */
    getResources(): SystemResources;
}
