import fs from "node:fs";
import path from "node:path";

/**
 * Detects installed extension CLIs (e.g. obsidian-cli)
 * and returns them as a block for .gwrkrc.json
 */
export async function detectExtensions(): Promise<Record<string, any>> {
  throw new Error("Not implemented");
}
