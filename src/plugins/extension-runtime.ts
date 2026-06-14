import path from "node:path";
import { loadConfig } from "../utils/config.js";
import { PluginLoader } from "./loader.js";
import type { ExtensionManifest } from "./manifest.js";
import type { ContextProvider, ContextResult } from "./context-provider.js";

/**
 * Maximum character limit for aggregated external context (TC-017)
 */
const MAX_CONTEXT_CHARS = 10000;

export interface ActiveExtension {
  name: string;
  adapter: ContextProvider;
  config: Record<string, any>;
}

/**
 * Discovers and loads enabled extension plugins for the project.
 */
export async function discoverExtensions(
  projectRoot: string,
): Promise<ActiveExtension[]> {
  let config: any;
  try {
    config = loadConfig(projectRoot);
  } catch {
    return [];
  }

  if (!config) return [];

  const enabledExtensions = config.extensions || {};
  const extensionNames = Object.keys(enabledExtensions);
  if (extensionNames.length === 0) return [];

  const loader = new PluginLoader({ projectDir: projectRoot });
  const activeExtensions: ActiveExtension[] = [];

  for (const name of extensionNames) {
    try {
      const loaded = await loader.resolvePlugin(name);
      if (loaded.manifest.type !== "extension") continue;

      const manifest = loaded.manifest as ExtensionManifest;
      const adapterPath = path.resolve(loaded.path, manifest.adapter);

      // TC-016: Extension Isolation - wrap import in try-catch
      try {
        const module = await import(adapterPath);
        // Supports both default export and direct export
        const adapter = module.default || module;

        if (typeof adapter.resolveContext === "function") {
          activeExtensions.push({
            name,
            adapter: adapter as ContextProvider,
            config: enabledExtensions[name],
          });
        }
      } catch (err) {
        console.error(`Failed to load adapter for extension '${name}':`, err);
      }
    } catch (err) {
      // TC-018: Silent Fail for missing or invalid extensions
      console.warn(`Extension '${name}' enabled in config but not found.`);
    }
  }

  return activeExtensions;
}

/**
 * Aggregates context from all active context provider extensions.
 */
export async function resolveExtensionContext(
  projectRoot: string,
  keywords: string[] = [],
): Promise<ContextResult[]> {
  const activeExtensions = await discoverExtensions(projectRoot);
  const allResults: ContextResult[] = [];

  for (const { name, adapter, config } of activeExtensions) {
    try {
      const results = await adapter.resolveContext({
        keywords,
        projectRoot,
        config,
      });
      allResults.push(...results);
    } catch (err) {
      // TC-016: Extension Isolation
      console.error(`Extension '${name}' failed to resolve context:`, err);
    }
  }

  // TC-017: Context Truncation
  let currentLength = 0;
  const truncatedResults: ContextResult[] = [];

  for (const res of allResults) {
    if (currentLength + res.content.length > MAX_CONTEXT_CHARS) {
      const remaining = MAX_CONTEXT_CHARS - currentLength;
      if (remaining > 100) {
        // Only include partial if significant
        truncatedResults.push({
          ...res,
          content: `${res.content.substring(0, remaining)}... [TRUNCATED]`,
        });
      }
      break;
    }
    truncatedResults.push(res);
    currentLength += res.content.length;
  }

  return truncatedResults;
}
