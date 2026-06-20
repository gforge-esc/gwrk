/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execSync } from "node:child_process";
import { Command } from "commander";
import { detectProfile } from "../engine/profile-detector.js";
import { detectExtensions } from "../engine/extension-detector.js";
import { syncRegistry } from "../engine/registry.js";
import { setupSlack } from "./setup-slack.js";
import readline from "node:readline/promises";
import { CommandError } from "../utils/signal.js";

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

async function prompt(question: string, defaultValue?: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${question}${defaultValue ? ` (${defaultValue})` : ""}: `);
    return answer.trim() || defaultValue || "";
  } finally {
    rl.close();
  }
}

async function confirm(question: string, defaultYes = true): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${question} [${defaultYes ? "Y/n" : "y/N"}]: `);
    const lower = answer.toLowerCase().trim();
    if (lower === "") return defaultYes;
    return lower === "y" || lower === "yes";
  } finally {
    rl.close();
  }
}

async function detectAgents() {
  const agents = ["agy", "claude", "gemini", "codex", "ollama", "gh"];
  const detected = [];
  for (const a of agents) {
    try {
      execSync(`which ${a}`, { stdio: "ignore" });
      detected.push(a);
    } catch {}
  }
  return detected;
}

/**
 * Build a schema-compliant agents config block from detected CLIs.
 * Must match GwrkConfigSchema.agents (define, implement, registry, fallbackOrder).
 */
function buildAgentConfig(detected: string[]): Record<string, unknown> {
  // Prefer agy, then claude, then first detected
  const preferred = detected.find(a => a === "agy")
    || detected.find(a => a === "claude")
    || detected[0]
    || "agy";

  const registry: Record<string, unknown> = {};
  for (const agent of detected) {
    registry[agent] = {
      name: agent,
      type: "local-cli",
      command: agent,
      discoveryMethod: "manual",
      quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
      maxConcurrent: agent === "agy" ? 2 : 1,
      models: [],
    };
  }

  return {
    define: preferred,
    implement: preferred,
    registry,
    fallbackOrder: detected,
  };
}

/**
 * Unified Init Command.
 * Absorbs setup.ts and integrates interactive profile wizard.
 * Also handles workspace appending for polyglot monorepos (020).
 */
export const initAction = async (options: any): Promise<void> => {
  const cwd = process.cwd();
  const root = findProjectRoot(cwd);
  const isAgent = options.agent || process.env.GWRK_AGENT === "1";
  const isNonInteractive = options.nonInteractive || isAgent;

  // 1. Workspace Append (020)
  if (root && root !== cwd && options.workspace) {
    const configPath = path.join(root, ".gwrkrc.json");
    let config: any;
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (error) {
      throw new Error(`Failed to parse existing config at ${configPath}`);
    }

    config.workspaces = config.workspaces || {};
    const relativePath = path.relative(root, cwd);
    
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

  // 2. Idempotency Check
  if (root === cwd && !isNonInteractive) {
    process.stdout.write("gwrk already initialized. Run with --non-interactive to update.\n");
    return;
  }

  // 3. Discovery Phase
  const profile = await detectProfile(cwd);
  const extensions = await detectExtensions();
  const detectedAgents = await detectAgents();

  // 4. Interactive Wizard
  let config: any = {
    project: {
      name: path.basename(cwd),
      type: profile.type,
      stack: profile.stack,
      layout: profile.layout,
      architecture: "unknown",
      conventions: "unknown"
    },
    agents: buildAgentConfig(detectedAgents),
    extensions: extensions.filter(e => e.detected).map(e => e.id)
  };

  if (!isNonInteractive) {
    process.stdout.write("\n🦩 Welcome to gwrk init wizard!\n\n");
    
    config.project.name = await prompt("Project name", config.project.name);
    
    if (await confirm(`Detected profile: ${profile.type} (${profile.stack?.language || "unknown"}). Correct?`)) {
      // Keep detected
    } else {
      config.project.type = await prompt("Project type (e.g. nodejs, rust, python)", config.project.type);
      config.project.stack.language = await prompt("Primary language", config.project.stack.language);
    }

    config.project.layout = await prompt("Project layout (flat, src-nested, lib-nested, monorepo)", config.project.layout);
    config.project.architecture = await prompt("Architecture (e.g. Hexagonal, Layered, Clean)", "Layered");
    config.project.conventions = await prompt("Conventions (e.g. TDD, ESM, functional)", "TDD");

    if (await confirm("Perform workstation provisioning (SSH, gh auth)?")) {
      // Workstation provisioning
      try {
        const sshPath = path.join(os.homedir(), ".ssh");
        const hasSsh = fs.existsSync(sshPath) && fs.readdirSync(sshPath).some(f => f.endsWith(".pub"));
        if (!hasSsh) {
          process.stdout.write("⚠️ No SSH keys detected in ~/.ssh/\n");
        } else {
          process.stdout.write("✅ SSH keys detected.\n");
        }

        try {
          execSync("gh auth status", { stdio: "pipe" });
          process.stdout.write("✅ GitHub CLI authenticated.\n");
        } catch {
          process.stdout.write("⚠️ GitHub CLI (gh) not authenticated. Run 'gh auth login'.\n");
        }
      } catch (e) {
        process.stdout.write("⚠️ Workstation provisioning check failed.\n");
      }
    }
  }

  // 5. Registry Sync
  process.stdout.write("Syncing plugin registry...\n");
  await syncRegistry();

  // 6. Slack Setup
  if (!isAgent || (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN)) {
    try {
      await setupSlack({ ...options, nonInteractive: isNonInteractive });
    } catch (e) {
      if (!isNonInteractive) {
        process.stdout.write("⚠️ Slack setup skipped or failed.\n");
      }
    }
  }

  // 7. Scaffold Directories
  const dirs = ["specs", "docs/architecture", "docs/decisions"];
  for (const d of dirs) {
    const dirPath = path.join(cwd, d);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  // 8. Write Config
  const configPath = path.join(cwd, ".gwrkrc.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  // 9. Output
  if (isAgent) {
    const output = {
      status: "success",
      projectId: config.project.name,
      profile: config.project,
      extensions: config.extensions,
      agents: config.agents
    };
    process.stdout.write(JSON.stringify(output, null, 2) + "\n");
  } else {
    process.stdout.write("\n✅ gwrk initialized successfully.\n");
    process.stdout.write(`Config written to ${configPath}\n`);
    process.stdout.write("Next steps:\n");
    process.stdout.write("  gwrk define spec my-feature\n");
    process.stdout.write("  gwrk status\n\n");
  }
};

export const initCommand = new Command("init")
  .description("Initialize a new gwrk project")
  .option("--non-interactive", "Run without interactive prompts")
  .option("--agent", "Agent-optimized init mode")
  .option("--workspace <name>", "Select a workspace profile")
  .action(initAction);
