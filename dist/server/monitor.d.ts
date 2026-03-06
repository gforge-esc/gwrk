export interface SystemStatus {
    cpuPercent: number;
    memPercent: number;
    diskFreeGb: number;
}
export declare class SystemMonitor {
    private lastCpus;
    private lastTime;
    constructor();
    sample(): SystemStatus;
    isThrottled(config: any): boolean;
}
