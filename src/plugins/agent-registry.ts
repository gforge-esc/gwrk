import { BUILTIN_AGENTS } from "./builtins/agents/index.js";
import type { AgentBackend } from "./agent-backend.js";
import type { PluginLoader } from "./loader.js";

export class BackendNotFoundError extends Error {
  constructor(name: string) {
    super(`Agent backend '${name}' not found.`);
    this.name = "BackendNotFoundError";
  }
}

export class AgentBackendRegistry {
  constructor(private loader?: PluginLoader) {}

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
        if (plugin.manifest.type === 'agent') {
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
   */
  async syncAllBackends(projectRoot: string, governance: string): Promise<void> {
    const backends = Object.keys(BUILTIN_AGENTS);
    for (const name of backends) {
      const adapter = BUILTIN_AGENTS[name];
      await adapter.syncGovernance(projectRoot, governance);
    }
  }
}
