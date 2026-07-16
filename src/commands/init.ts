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
import { saveSetupState } from "../utils/setup-state.js";
import { loadDevice, saveDevice } from "../utils/device.js";

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

/**
 * Detect workstation readiness for the autonomous ship loop: an SSH public key
 * and an authenticated GitHub CLI. Never throws — results are recorded as
 * diagnostics in setup.json.
 */
function detectWorkstation(): { ssh: boolean; gh: boolean } {
  let ssh = false;
  try {
    const sshPath = path.join(os.homedir(), ".ssh");
    ssh =
      fs.existsSync(sshPath) &&
      fs.readdirSync(sshPath).some((f) => f.endsWith(".pub"));
  } catch {}
  let gh = false;
  try {
    execSync("gh auth status", { stdio: "ignore" });
    gh = true;
  } catch {}
  return { ssh, gh };
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
 * Read and parse a JSON file, returning undefined if absent or malformed.
 */
// biome-ignore lint/suspicious/noExplicitAny: parsed json config
function readJsonSafe(filePath: string): Record<string, any> | undefined {
  if (!fs.existsSync(filePath)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return undefined;
  }
}

/**
 * Ensure `.gitignore` contains `entry`, creating the file if needed. Idempotent.
 */
function ensureGitignoreEntry(cwd: string, entry: string): void {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf-8");
    if (content.split(/\r?\n/).some((line) => line.trim() === entry)) {
      return;
    }
  }
  const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(gitignorePath, `${prefix}${entry}\n`);
}

/**
 * Unified Init Command.
 * Two-layer design:
 *   Layer 1 — Machine setup (first run, creates ~/.gwrk/device.json)
 *   Layer 2 — Project setup (every run, idempotent)
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

  // ── Layer 1: Machine Setup ──────────────────────────────────────────
  // Runs once per machine. Gated by ~/.gwrk/device.json.
  const existingDevice = loadDevice();
  let deviceRole: "server" | "remote";

  if (options.remote) {
    deviceRole = "remote";
  } else if (options.server) {
    deviceRole = "server";
  } else if (existingDevice) {
    // Machine already set up — preserve existing role
    deviceRole = existingDevice.role;
  } else if (isNonInteractive) {
    // No device.json, non-interactive — default to remote
    deviceRole = "remote";
  } else {
    // First run on this machine — ask
    process.stdout.write("\n🦩 First-time gwrk setup on this machine.\n\n");
    process.stdout.write(
      "  gwrk uses a single server device for harvest, Slack, and the\n" +
      "  autonomous daemon. All other machines are remote — they run\n" +
      "  agents locally and push work to GitHub.\n\n",
    );
    const isServerDevice = await confirm("Is this machine the gwrk server?", false);
    deviceRole = isServerDevice ? "server" : "remote";
  }

  // Save device identity (idempotent on id)
  const device = saveDevice(deviceRole);
  if (!existingDevice) {
    process.stdout.write(`Device registered: ${device.hostname} (${deviceRole})\n`);
  } else if (existingDevice.role !== deviceRole) {
    process.stdout.write(`Device role changed: ${existingDevice.role} → ${deviceRole}\n`);
  }

  // ── Layer 2: Project Setup ─────────────────────────────────────────

  // 2. Idempotency Check
  if (root === cwd && !isNonInteractive && !options.remote && !options.server) {
    process.stdout.write("gwrk already initialized. Run with --non-interactive to update.\n");
    return;
  }

  // 3. Discovery Phase
  const profile = await detectProfile(cwd);
  const extensions = await detectExtensions();
  const detectedAgents = await detectAgents();

  // Load any existing config so re-init is non-destructive: preserve project
  // identity the user already set, and migrate a legacy tracked `agents` block
  // (or an existing personal one) instead of re-detecting from scratch.
  const existingTracked = readJsonSafe(path.join(cwd, ".gwrkrc.json")) ?? {};
  const existingLocal = readJsonSafe(path.join(cwd, ".gwrkrc.local.json")) ?? {};
  const existingProject = existingTracked.project ?? {};
  const existingAgents = existingLocal.agents ?? existingTracked.agents;
  const existingStack =
    existingProject.stack && Object.keys(existingProject.stack).length > 0
      ? existingProject.stack
      : undefined;

  // 4. Interactive Wizard
  let config: any = {
    project: {
      name: existingProject.name ?? path.basename(cwd),
      type: existingProject.type ?? profile.type,
      stack: existingStack ?? profile.stack,
      layout: existingProject.layout ?? profile.layout,
      architecture: existingProject.architecture ?? "unknown",
      conventions: existingProject.conventions ?? "unknown"
    },
    agents: existingAgents ?? buildAgentConfig(detectedAgents),
    extensions: Object.fromEntries(
      extensions.filter(e => e.detected).map(e => [e.id, {}])
    )
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
      const { ssh, gh } = detectWorkstation();
      process.stdout.write(
        ssh ? "✅ SSH keys detected.\n" : "⚠️ No SSH keys detected in ~/.ssh/\n",
      );
      process.stdout.write(
        gh
          ? "✅ GitHub CLI authenticated.\n"
          : "⚠️ GitHub CLI (gh) not authenticated. Run 'gh auth login'.\n",
      );
    }
  }

  // 5. Registry Sync (server-only — remote devices don't run the daemon)
  if (deviceRole === "server") {
    process.stdout.write("Syncing plugin registry...\n");
    await syncRegistry();
  }

  // 6. Slack Setup (server-only)
  if (deviceRole === "server" && (!isAgent || (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN))) {
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

  // 8. Write Config — split into project (tracked) and personal (gitignored).
  // Preserve any other tracked top-level keys the user had (extensions,
  // workspaces, server, effort); only project identity is refreshed here and
  // the personal `agents`/`slack` layers are removed from the tracked file.
  const projectConfig: Record<string, unknown> = { ...existingTracked };
  projectConfig.project = {
    name: config.project.name,
    type: config.project.type,
    stack: config.project.stack,
    layout: config.project.layout,
    architecture: config.project.architecture,
    conventions: config.project.conventions,
  };
  delete projectConfig.agents;

  const personalConfig: Record<string, unknown> = {
    agents: config.agents,
  };

  // Slack config goes to personal (contains per-developer webhook prefs)
  if (config.project.slack) {
    (personalConfig as Record<string, unknown>).project = {
      slack: config.project.slack,
    };
  }

  const configPath = path.join(cwd, ".gwrkrc.json");
  const localConfigPath = path.join(cwd, ".gwrkrc.local.json");
  const exampleConfigPath = path.join(cwd, ".gwrkrc.local.json.example");

  fs.writeFileSync(configPath, JSON.stringify(projectConfig, null, 2));
  fs.writeFileSync(localConfigPath, JSON.stringify(personalConfig, null, 2));

  // Keep out of git: the personal config (per-machine, may hold secrets) and
  // gwrk's own runtime artifacts. `.runs/` matters most — the backend selector
  // writes .runs/quota-cache.json before ship's dirty-tree check, so an
  // untracked .runs/ makes ship refuse to run on its own output.
  for (const entry of [".gwrkrc.local.json", ".runs/", ".gwrk/server.pid"]) {
    ensureGitignoreEntry(cwd, entry);
  }

  // Ship a tracked template teammates copy to .gwrkrc.local.json. Agents only —
  // never the Slack layer, since this file is committed.
  const exampleConfig: Record<string, unknown> = { agents: config.agents };
  fs.writeFileSync(exampleConfigPath, JSON.stringify(exampleConfig, null, 2));

  // Persist workstation setup state so `gwrk ship`'s pre-flight ("Run gwrk init
  // first") is actually satisfiable. ssh/gh are recorded as diagnostics.
  const workstation = detectWorkstation();
  saveSetupState({
    completedAt: new Date().toISOString(),
    deviceId: device.id,
    deviceRole: device.role,
    steps: {
      tcc: true,
      ssh: workstation.ssh,
      gh: workstation.gh,
      verification: true,
    },
  });

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
    process.stdout.write(`Project config written to ${configPath}\n`);
    process.stdout.write(`Agent config written to ${localConfigPath} (gitignored — personal to your machine)\n`);
    process.stdout.write(`Shareable template written to ${exampleConfigPath} (commit this; teammates copy it to .gwrkrc.local.json)\n`);
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
  .option("--remote", "Register this machine as a remote device (no daemon, no harvest)")
  .option("--server", "Register this machine as the gwrk server")
  .action(initAction);
