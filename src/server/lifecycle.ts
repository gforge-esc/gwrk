/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { EventEmitter } from "node:events";
import type { GwrkConfig } from "../utils/config.js";
import type { ServerLifecycle } from "./types.js";

export class LifecycleMonitor extends EventEmitter {
  private lastTick: number;
  private interval: NodeJS.Timeout | null = null;
  private status: ServerLifecycle = "starting";

  constructor(private config: GwrkConfig) {
    super();
    this.lastTick = Date.now();
  }

  getStatus(): ServerLifecycle {
    return this.status;
  }

  setStatus(status: ServerLifecycle) {
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
      } else if (this.status === "sleeping") {
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
