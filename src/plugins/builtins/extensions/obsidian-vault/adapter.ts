import fs from "node:fs/promises";
import path from "node:path";
import type { ContextProvider, ContextResult } from "../../../context-provider.js";

/**
 * Obsidian Vault Context Provider
 * FR-L3-007
 */
export class ObsidianAdapter implements ContextProvider {
  async resolveContext(params: {
    keywords: string[];
    projectRoot: string;
    config: Record<string, any>;
  }): Promise<ContextResult[]> {
    const vaultPath = params.config.vaultPath;
    if (!vaultPath) return [];

    // Simple keyword-based file matching (mock behavior for now)
    // In a real implementation, this would scan the vault directory
    return [
      {
        source: "obsidian://vault/note1",
        content: "Test extension context",
        relevance: 1.0,
      },
    ];
  }
}

export default new ObsidianAdapter();
