/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "node:events";
import * as os from "node:os";
import type { GwrkConfig } from "../utils/config.js";
import type { NetworkStatus } from "./types.js";

export class NetworkMonitor extends EventEmitter {
  private status: NetworkStatus = "unknown";
  private interval: NodeJS.Timeout | null = null;

  constructor(private config: GwrkConfig) {
    super();
  }

  isOnline(): boolean {
    const interfaces = os.networkInterfaces();
    return Object.values(interfaces).some((iface) =>
      iface?.some(
        (addr) =>
          !addr.internal && (addr.family === "IPv4" || addr.family === "IPv6"),
      ),
    );
  }

  getStatus(): NetworkStatus {
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

  private check() {
    const online = this.isOnline();
    const newStatus: NetworkStatus = online ? "online" : "offline";

    if (this.status !== newStatus) {
      this.status = newStatus;
      if (newStatus === "online") {
        this.emit("network:up");
      } else {
        this.emit("network:down");
      }
    }
  }
}
