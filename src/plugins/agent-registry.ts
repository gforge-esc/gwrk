import crypto from "node:crypto";
import { getAgentContextSync, recordAgentContextSync } from "../db/plugins.js";
import type { AgentBackend } from "./agent-backend.js";
import { BUILTIN_AGENTS } from "./builtins/agents/index.js";
import type { PluginLoader } from "./loader.js";

class BackendNotFoundError extends Error {
  constructor(name: string) {
    super(`Agent backend '${name}' not found.`);
    this.name = "BackendNotFoundError";
  }
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
            // Placeholder: resolution logic for dynamic plugins would go here.
            // For Phase 4, we ensure built-ins and known plugins are listed.
          }
        }
      } catch (e) {}
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
        if (plugin.manifest.type === "agent") {
          // For now, user plugins would need a way to be instantiated.
          // ADR-006 Phase 3 focused on built-ins and the interface.
          // User-installed agent plugins might need a dynamic import or separate logic.
          // If it's a built-in name, we return the built-in below.
        }
      } catch (e) {
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
    const backends = Object.keys(BUILTIN_AGENTS);
    const hash = crypto.createHash("sha256").update(governance).digest("hex");

    for (const name of backends) {
      const adapter = BUILTIN_AGENTS[name];
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
