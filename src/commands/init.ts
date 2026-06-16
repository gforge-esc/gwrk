/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { detectProfile } from "../engine/profile-detector.js";

/**
 * Find the nearest gwrk project root by searching upwards for .gwrkrc.json.
 */
function findProjectRoot(startDir: string): string | undefined {
  let current = startDir;
  const root = path.parse(current).root;
  while (current && current !== root) {
    if (fs.existsSync(path.join(current, ".gwrkrc.json"))) {
      return current;
    }
    current = path.dirname(current);
  }
  return undefined;
}

/**
 * Unified Init Command.
 * Absorbs setup.ts and integrates interactive profile wizard.
 * Also handles workspace appending for polyglot monorepos (020).
 */
export const initAction = async (options: any): Promise<void> => {
  const cwd = process.cwd();
  const root = findProjectRoot(cwd);

  if (root && root !== cwd && options.workspace) {
    // US-004: Append workspace to existing config if in a subdirectory
    const configPath = path.join(root, ".gwrkrc.json");
    let config: any;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (error) {
      throw new Error(`Failed to parse existing config at ${configPath}`);
    }

    config.workspaces = config.workspaces || {};
    const relativePath = path.relative(root, cwd);
    
    // Auto-detect profile for this workspace
    const wsProfile = await detectProfile(cwd);
    
    config.workspaces[relativePath] = {
      type: wsProfile.type,
      stack: wsProfile.stack,
      layout: wsProfile.layout
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    process.stdout.write(`Added workspace '${options.workspace}' at ${relativePath} to ${configPath}\n`);
    return;
  }

  // If already initialized at this level
  if (root === cwd && !options.nonInteractive && !options.agent) {
    process.stdout.write("gwrk already initialized. Run with --non-interactive to update.\n");
    return;
  }

  // Placeholder for the rest of Phase 10 Unified Init
  throw new Error("Not implemented: FR-001, FR-046");
};

export const initCommand = new Command("init")
  .description("Initialize a new gwrk project")
  .option("--non-interactive", "Run without interactive prompts")
  .option("--agent", "Agent-optimized init mode")
  .option("--workspace <name>", "Select a workspace profile")
  .action(initAction);
