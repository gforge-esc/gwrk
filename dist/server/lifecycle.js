import { EventEmitter } from "node:events";
export class LifecycleMonitor extends EventEmitter {
    config;
    lastTick;
    interval = null;
    status = "starting";
    constructor(config) {
        super();
        this.config = config;
        this.lastTick = Date.now();
    }
    getStatus() {
        return this.status;
    }
    setStatus(status) {
        if (this.status !== status) {
            this.status = status;
            this.emit("lifecycle:change", status);
        }
    }
    start() {
        this.lastTick = Date.now();
        this.setStatus("ready");
        this.interval = setInterval(() => {
            const now = Date.now();
            const diff = now - this.lastTick;
            const heartbeatInterval = this.config.server.heartbeatIntervalMs;
            if (diff > 3 * heartbeatInterval) {
                // Sleep detected
                if (this.status !== "sleeping") {
                    this.setStatus("sleeping");
                    this.emit("server:sleep");
                }
            }
            else if (this.status === "sleeping") {
                // Wake detected
                this.emit("server:wake");
            }
            this.lastTick = now;
        }, this.config.server.heartbeatIntervalMs);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.setStatus("stopping");
    }
}
