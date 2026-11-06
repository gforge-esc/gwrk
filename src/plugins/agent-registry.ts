/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getAgentContextSync, recordAgentContextSync } from "../db/plugins.js";
import type { AgentBackend } from "./agent-backend.js";
import { BUILTIN_AGENTS } from "./builtins/agents/index.js";
import type { LoadedPlugin, PluginLoader } from "./loader.js";
import type { AnyManifest } from "./manifest.js";

export class BackendNotFoundError extends Error {
  constructor(name: string) {
    super(`Agent backend '${name}' not found.`);
    this.name = "BackendNotFoundError";
  }
}

function isAgentBackendInstance(candidate: unknown): candidate is AgentBackend {
  return (
    Boolean(candidate) &&
    typeof candidate === "object" &&
    typeof (candidate as AgentBackend).name === "string" &&
    typeof (candidate as AgentBackend).dispatch === "function" &&
    typeof (candidate as AgentBackend).isAvailable === "function" &&
    typeof (candidate as AgentBackend).parseResult === "function"
  );
}

async function instantiateDynamicAgentPlugin(
  plugin: LoadedPlugin<AnyManifest>,
): Promise<AgentBackend | null> {
  if (plugin.manifest.type !== "agent") return null;
  const adapterRel = plugin.manifest.adapter || "adapter.js";
  const candidates = [
    path.resolve(plugin.path, adapterRel),
    path.resolve(plugin.path, adapterRel.replace(/\.ts$/, ".js")),
  ];

  const targetPath = candidates.find((c) => fs.existsSync(c));
  if (!targetPath) return null;

  const mod = await import(pathToFileURL(targetPath).href);
  for (const exported of [mod.default, ...Object.values(mod)]) {
    if (isAgentBackendInstance(exported)) {
      return exported;
    }
    if (typeof exported === "function") {
      try {
        const instance = new (exported as new () => unknown)();
        if (isAgentBackendInstance(instance)) {
          return instance;
        }
      } catch {
        // Not a zero-arg constructor
      }
    }
  }
  return null;
}

export class AgentBackendRegistry {
  constructor(private loader?: PluginLoader) {}

  /**
   * Returns a list of all available agent backends.
   */
  async getBackends(): Promise<Record<string, AgentBackend>> {
    const backends: Record<string, AgentBackend> = { ...BUILTIN_AGENTS };

    // Discover user-installed plugins via loader
    if (this.loader) {
      try {
        const plugins = await this.loader.listPlugins({ type: "agent" });
        for (const plugin of plugins) {
          if (!backends[plugin.name]) {
            const resolved = await this.loader.resolvePlugin(plugin.name);
            const dynamicBackend =
              await instantiateDynamicAgentPlugin(resolved);
            if (dynamicBackend) {
              backends[plugin.name] = dynamicBackend;
            }
          }
        }
      } catch {
        // Ignore loader discovery errors
      }
    }

    return backends;
  }

  /**
   * Resolves the adapter instance for a given agent backend.
   * Resolution Order:
   * 1. User-installed plugin at ~/.gwrk/plugins/agents/<name>/.
   * 2. Built-in adapter in src/plugins/builtins/agents/.
   */
  async getAgentBackend(name: string): Promise<AgentBackend> {
    // 1. Check user-installed plugins via loader
    if (this.loader) {
      try {
        const plugin = await this.loader.resolvePlugin(name);
        if (
          plugin.manifest.type === "agent" &&
          (!plugin.path.includes("plugins/builtins/") || !BUILTIN_AGENTS[name])
        ) {
          const dynamicBackend = await instantiateDynamicAgentPlugin(plugin);
          if (dynamicBackend) {
            return dynamicBackend;
          }
        }
      } catch {
        // Not found in user plugins, continue to built-ins
      }
    }

    // 2. Built-in adapters
    const builtin = BUILTIN_AGENTS[name];
    if (builtin) {
      return builtin;
    }

    throw new BackendNotFoundError(name);
  }

  /**
   * Calls syncGovernance() for all active/detected backends.
   * Tracks sync state in SQLite to avoid redundant writes.
   */
  async syncAllBackends(
    projectRoot: string,
    governance: string,
  ): Promise<void> {
    const allBackends = await this.getBackends();
    const hash = crypto.createHash("sha256").update(governance).digest("hex");

    for (const [name, adapter] of Object.entries(allBackends)) {
      if (await adapter.isAvailable()) {
        const lastSync = getAgentContextSync(projectRoot, name);
        if (lastSync?.context_hash === hash) {
          continue; // Skip redundant sync
        }

        await adapter.syncGovernance(projectRoot, governance);
        recordAgentContextSync({
          project_root: projectRoot,
          backend_name: name,
          context_hash: hash,
          last_sync_at: new Date().toISOString(),
        });
      }
    }
  }
}
