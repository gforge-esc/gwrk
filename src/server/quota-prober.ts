/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import * as path from "node:path";
import { execCommand } from "../utils/exec.js";
import type { AgentBackendConfig, QuotaProbe } from "./agent-registry.js";

export interface QuotaReading {
  percent: number;
  resetsIn: string;
  probedAt: string; // ISO date
  status: "fresh" | "cached" | "shared-pool" | "timeout-assumed-available";
}

interface QuotaCache {
  [backendName: string]: QuotaReading;
}

export class QuotaProber {
  private cachePath: string;
  private cache: QuotaCache = {};
  private modelCooldowns: Map<string, number> = new Map(); // key: "backend:model", value: timestamp

  constructor(projectRoot: string = process.cwd()) {
    this.cachePath = path.join(projectRoot, ".runs", "quota-cache.json");
    this.loadCache();
  }

  private loadCache() {
    if (fs.existsSync(this.cachePath)) {
      try {
        this.cache = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
      } catch (error) {
        this.cache = {};
      }
    }
  }

  private saveCache() {
    const dir = path.dirname(this.cachePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
  }

  async probeQuota(
    backend: AgentBackendConfig,
    allBackends: Record<string, AgentBackendConfig>,
    visited: Set<string> = new Set(),
  ): Promise<QuotaReading> {
    const config = backend.quotaProbe;
    const cached = this.cache[backend.name];

    // Check cache first
    if (cached && config.cacheTTLMinutes > 0) {
      const probedAt = new Date(cached.probedAt).getTime();
      const now = Date.now();
      if (now - probedAt < config.cacheTTLMinutes * 60 * 1000) {
        return { ...cached, status: "cached" };
      }
    }

    if (visited.has(backend.name)) {
      return this.getOptimisticReading("fresh");
    }
    visited.add(backend.name);

    let reading: QuotaReading;

    try {
      switch (config.method) {
        case "interactive-scrape":
          reading = await this.scrapeInteractive(backend.name, config);
          break;
        case "shared-pool":
          reading = await this.probeSharedPool(config, allBackends, visited);
          break;
        default:
          reading = this.getOptimisticReading("fresh");
          break;
      }
    } catch (error) {
      reading = this.getOptimisticReading("timeout-assumed-available");
    }

    this.cache[backend.name] = reading;
    this.saveCache();
    return reading;
  }

  private async scrapeInteractive(
    backendName: string,
    config: Extract<QuotaProbe, { method: "interactive-scrape" }>,
  ): Promise<QuotaReading> {
    const sessionId = `gwrk-probe-${backendName}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const probeTask = (async (): Promise<QuotaReading> => {
      try {
        // 1. Start tmux session with the command
        await execCommand("tmux", [
          "new-session",
          "-d",
          "-s",
          sessionId,
          config.command,
        ]);

        // Wait a bit for the app to start
        await new Promise((r) => setTimeout(r, 1000));

        // 2. Send keys
        await execCommand("tmux", [
          "send-keys",
          "-t",
          sessionId,
          config.sendKeys,
          "C-m",
        ]);

        // Wait for response
        await new Promise((r) => setTimeout(r, 1500));

        // 3. Capture pane
        const result = await execCommand("tmux", [
          "capture-pane",
          "-pt",
          sessionId,
        ]);

        const match = result.stdout.match(new RegExp(config.parseRegex));
        if (match?.[1]) {
          let percent = Number.parseFloat(match[1]);
          if (config.invertPercent) {
            percent = 100 - percent;
          }
          return {
            percent,
            resetsIn: "unknown",
            probedAt: new Date().toISOString(),
            status: "fresh",
          };
        }
        return this.getOptimisticReading("timeout-assumed-available");
      } finally {
        // 4. Kill session (always cleanup)
        await execCommand("tmux", ["kill-session", "-t", sessionId]).catch(
          () => {},
        );
      }
    })();

    const timeoutTask = new Promise<QuotaReading>((resolve) => {
      setTimeout(() => {
        resolve(this.getOptimisticReading("timeout-assumed-available"));
      }, 5000);
    });

    return Promise.race([probeTask, timeoutTask]);
  }

  private async probeSharedPool(
    config: Extract<QuotaProbe, { method: "shared-pool" }>,
    allBackends: Record<string, AgentBackendConfig>,
    visited: Set<string>,
  ): Promise<QuotaReading> {
    const sharedBackend = allBackends[config.sharedWith];
    if (!sharedBackend || visited.has(config.sharedWith)) {
      return this.getOptimisticReading("shared-pool");
    }

    const reading = await this.probeQuota(sharedBackend, allBackends, visited);
    return { ...reading, status: "shared-pool" };
  }

  private getOptimisticReading(status: QuotaReading["status"]): QuotaReading {
    return {
      percent: 100,
      resetsIn: "unknown",
      probedAt: new Date().toISOString(),
      status,
    };
  }

  // Model Cooldown Tracking (FR-010)
  markModelFailure(backendName: string, modelName: string, cooldownMs = 60000) {
    this.modelCooldowns.set(
      `${backendName}:${modelName}`,
      Date.now() + cooldownMs,
    );
  }

  isModelInCooldown(backendName: string, modelName: string): boolean {
    const expiry = this.modelCooldowns.get(`${backendName}:${modelName}`);
    if (!expiry) return false;
    if (Date.now() > expiry) {
      this.modelCooldowns.delete(`${backendName}:${modelName}`);
      return false;
    }
    return true;
  }
}
