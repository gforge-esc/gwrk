import { EventEmitter } from "node:events";
import type { GwrkConfig } from "../utils/config.js";
import type { NetworkStatus } from "./types.js";
export declare class NetworkMonitor extends EventEmitter {
    private config;
    private status;
    private interval;
    constructor(config: GwrkConfig);
    isOnline(): boolean;
    getStatus(): NetworkStatus;
    start(): void;
    stop(): void;
    private check;
}
