import { EventEmitter } from "node:events";
import * as os from "node:os";
export class NetworkMonitor extends EventEmitter {
    config;
    status = "unknown";
    interval = null;
    constructor(config) {
        super();
        this.config = config;
    }
    isOnline() {
        const interfaces = os.networkInterfaces();
        return Object.values(interfaces).some((iface) => iface?.some((addr) => !addr.internal && (addr.family === "IPv4" || addr.family === "IPv6")));
    }
    getStatus() {
        return this.status;
    }
    start() {
        this.check();
        this.interval = setInterval(() => {
            this.check();
        }, this.config.server.networkCheckIntervalMs);
    }
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }
    check() {
        const online = this.isOnline();
        const newStatus = online ? "online" : "offline";
        if (this.status !== newStatus) {
            this.status = newStatus;
            if (newStatus === "online") {
                this.emit("network:up");
            }
            else {
                this.emit("network:down");
            }
        }
    }
}
