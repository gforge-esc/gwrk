import { EventEmitter } from "node:events";
import type { GwrkConfig } from "../utils/config.js";
import type { ServerLifecycle } from "./types.js";
export declare class LifecycleMonitor extends EventEmitter {
    private config;
    private lastTick;
    private interval;
    private status;
    constructor(config: GwrkConfig);
    getStatus(): ServerLifecycle;
    setStatus(status: ServerLifecycle): void;
    start(): void;
    stop(): void;
}
