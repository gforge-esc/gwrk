/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { Command } from "commander";
import { installArchitectureContext } from "../adapters/architecture/context-files.js";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import { resolveDesign } from "../domain/architecture-context.js";
import { resolveDecisionsDir } from "../engine/adr-scaffold.js";
import { detectExtensions } from "../engine/extension-detector.js";
import { detectProfile } from "../engine/profile-detector.js";
import { syncRegistry } from "../engine/registry.js";
import { BUILTIN_AGENTS } from "../plugins/builtins/agents/index.js";
import { ensureSlackChannel } from "../server/slack-channel.js";
import { loadDevice, saveDevice } from "../utils/device.js";
import { saveSetupState } from "../utils/setup-state.js";
import { CommandError } from "../utils/signal.js";
import {
  getSourceExtension,
  getTestExtension,
} from "../utils/toolchain-mapper.js";
import { setupSlack } from "./setup-slack.js";

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

async function prompt(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `${question}${defaultValue ? ` (${defaultValue})` : ""}: `,
    );
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
    const answer = await rl.question(
      `${question} [${defaultYes ? "Y/n" : "y/N"}]: `,
    );
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

export interface DetectedAgent {
  name: string;
  installed: boolean;
  available: boolean;
}

/**
 * Probe agent backends: check both installation (`which`) and runtime
 * availability (`isAvailable()`). Only agents with builtin adapters
 * are probed — ollama/gh have no AgentBackend implementation.
 */
export async function detectAgents(): Promise<DetectedAgent[]> {
  const agents = ["agy", "claude", "codex"];
  const results: DetectedAgent[] = [];
  for (const a of agents) {
    let installed = false;
    try {
      execSync(`which ${a}`, { stdio: "ignore" });
      installed = true;
    } catch {}
    if (!installed) continue;

    let available = false;
    const backend = BUILTIN_AGENTS[a];
    if (backend) {
      try {
        available = await backend.isAvailable();
      } catch {
        available = false;
      }
    } else {
      available = installed;
    }
    results.push({ name: a, installed, available });
  }
  return results;
}

/** Auto-select preference order when no user input. */
const AGENT_PREFERENCE = ["agy", "claude", "codex"];

/**
 * Build a schema-compliant agents config block.
 * Must match GwrkConfigSchema.agents (define, implement, registry, fallbackOrder).
 */
function buildAgentConfig(
  agents: DetectedAgent[],
  defaultAgent: string,
  fallbackOrder: string[],
): Record<string, unknown> {
  const registry: Record<string, unknown> = {};
  for (const agent of agents.filter((a) => a.available)) {
    registry[agent.name] = {
      name: agent.name,
      type: "local-cli",
      command: agent.name,
      discoveryMethod: "manual",
      quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
      maxConcurrent: agent.name === "agy" ? 2 : 1,
      models: [],
    };
  }

  return {
    define: defaultAgent,
    implement: defaultAgent,
    registry,
    fallbackOrder: [
      defaultAgent,
      ...fallbackOrder.filter((a) => a !== defaultAgent),
    ],
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
// biome-ignore lint/suspicious/noExplicitAny: commander action options
export const initAction = async (options: any): Promise<void> => {
  const cwd = process.cwd();
  const trackedPath = path.join(cwd, ".gwrkrc.json");
  if (fs.existsSync(trackedPath) && !readJsonSafe(trackedPath)) {
    throw new CommandError(
      "Existing .gwrkrc.json is invalid JSON. Repair it before initialization.",
    );
  }
  const root = findProjectRoot(cwd);
  if (root && root !== cwd && !options.workspace) {
    throw new CommandError(
      "Run gwrk init at the project root or use --workspace.",
    );
  }
  const isAgent = options.agent || process.env.GWRK_AGENT === "1";
  const isNonInteractive = options.nonInteractive || isAgent;

  // 1. Workspace Append (020)
  if (root && root !== cwd && options.workspace) {
    const configPath = path.join(root, ".gwrkrc.json");
    // biome-ignore lint/suspicious/noExplicitAny: dynamic JSON config mutation
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
      layout: wsProfile.layout,
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    writeScopedStdout(
      `Added workspace '${options.workspace}' at ${relativePath} to ${configPath}\n`,
    );
    return;
  }

  if (options.contextOnly) {
    const configPath = path.join(cwd, ".gwrkrc.json");
    const tracked = readJsonSafe(configPath) ?? {};
    const profile = await detectProfile(cwd);
    const project = tracked.project ?? {
      name: path.basename(cwd),
      type: profile.type,
      stack: profile.stack,
      layout: profile.layout,
    };
    project.design = resolveDesign({
      architecture:
        options.architecture ??
        project.design?.architecture ??
        (typeof project.architecture === "string" &&
        project.architecture !== "unknown"
          ? project.architecture
          : "hexagonal-functional"),
      principles: options.principles
        ? options.principles.split(",").map((value: string) => value.trim())
        : project.design?.principles,
    });
    project.stack = {
      ...project.stack,
      ...(options.language ? { language: options.language } : {}),
      ...(options.framework ? { framework: options.framework } : {}),
    };
    tracked.project = project;
    fs.writeFileSync(configPath, JSON.stringify(tracked, null, 2));
    const decisionsDir = await resolveDecisionsDir(cwd);
    const context = await installArchitectureContext(cwd, {
      projectName: project.name,
      design: project.design,
      language: project.stack.language,
      framework: project.stack.framework,
      decisionsDir: path.relative(cwd, decisionsDir).split(path.sep).join("/"),
    });
    try {
      const { parseCorpus } = await import("../engine/adr-parser.js");
      const { writeIndex } = await import("../engine/adr-index.js");
      await writeIndex(cwd, await parseCorpus(decisionsDir));
    } catch (error) {
      context.status = "incomplete";
      context.conflicts.push(`Decision index: ${(error as Error).message}`);
    }
    writeScopedStdout(
      `${JSON.stringify({ context, architecture: project.design.architecture }, null, 2)}\n`,
    );
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
    writeScopedStdout("\n🦩 First-time gwrk setup on this machine.\n\n");
    writeScopedStdout(
      "  gwrk uses a single server device for harvest, Slack, and the\n" +
        "  autonomous daemon. All other machines are remote — they run\n" +
        "  agents locally and push work to GitHub.\n\n",
    );
    const isServerDevice = await confirm(
      "Is this machine the gwrk server?",
      false,
    );
    deviceRole = isServerDevice ? "server" : "remote";
  }

  // Save device identity (idempotent on id)
  const device = saveDevice(deviceRole);
  if (!existingDevice) {
    writeScopedStdout(
      `Device registered: ${device.hostname} (${deviceRole})\n`,
    );
  } else if (existingDevice.role !== deviceRole) {
    writeScopedStdout(
      `Device role changed: ${existingDevice.role} → ${deviceRole}\n`,
    );
  }

  // ── Layer 2: Project Setup ─────────────────────────────────────────

  // 3. Discovery Phase
  const profile = await detectProfile(cwd);
  const extensions = await detectExtensions();
  const detectedAgents = await detectAgents();

  // Load existing config so re-init is non-destructive for project identity.
  // Agent config is always re-probed — a stale agents block pointing at an
  // uninstalled backend (e.g. gemini after EOL) caused silent misconfiguration.
  const existingTracked = readJsonSafe(path.join(cwd, ".gwrkrc.json")) ?? {};
  const existingLocal =
    readJsonSafe(path.join(cwd, ".gwrkrc.local.json")) ?? {};
  const existingProject = existingTracked.project ?? {};
  const existingSlack = existingLocal.project?.slack ?? existingProject.slack;
  const existingStack =
    existingProject.stack && Object.keys(existingProject.stack).length > 0
      ? existingProject.stack
      : undefined;

  // Determine agent selection (always re-probe, never carry forward stale config)
  const availableAgents = detectedAgents.filter((a) => a.available);
  const availableNames = availableAgents.map((a) => a.name);

  // Seed defaults from existing config if the agent is still available;
  // otherwise fall back to preference order.
  const existingAgents = existingLocal.agents ?? existingTracked.agents;
  const existingDefault = existingAgents?.define;
  const defaultFromExisting =
    existingDefault && availableNames.includes(existingDefault)
      ? existingDefault
      : undefined;
  const autoDefault =
    defaultFromExisting ||
    AGENT_PREFERENCE.find((a) => availableNames.includes(a)) ||
    availableNames[0] ||
    "agy";

  let selectedDefault = autoDefault;
  let selectedFallback = availableNames.filter((a) => a !== selectedDefault);

  // 4. Interactive Wizard
  // biome-ignore lint/suspicious/noExplicitAny: dynamic JSON config construction
  const config: any = {
    project: {
      ...existingProject,
      name: existingProject.name ?? path.basename(cwd),
      type: existingProject.type ?? profile.type,
      stack: existingStack ?? profile.stack,
      layout: existingProject.layout ?? profile.layout,
      architecture: existingProject.architecture ?? "unknown",
      conventions: existingProject.conventions ?? "unknown",
      // Persist the detected toolchain plus the resolved test/source extensions
      // so the language convention (e.g. JS → .test.js) is explicit and durable
      // rather than re-inferred on every run (ADR-005 §11 / 004 FR-025).
      toolchain: existingProject.toolchain ?? {
        ...(profile.toolchain ?? {}),
        testExtension: getTestExtension(profile),
        sourceExtension: getSourceExtension(profile),
      },
    },
    agents: buildAgentConfig(detectedAgents, selectedDefault, selectedFallback),
    extensions: Object.fromEntries(
      (extensions || []).filter((e) => e.detected).map((e) => [e.id, {}]),
    ),
  };

  if (existingSlack) {
    config.project.slack = existingSlack;
  }

  if (!isNonInteractive) {
    if (root === cwd) {
      writeScopedStdout(
        "\n🦩 gwrk is already initialized here. Let's verify your setup.\n\n",
      );
    } else {
      writeScopedStdout("\n🦩 Welcome to gwrk init wizard!\n\n");
    }

    config.project.name = await prompt("Project name", config.project.name);

    if (
      await confirm(
        `Detected profile: ${profile.type} (${profile.stack?.language || "unknown"}). Correct?`,
      )
    ) {
      // Keep detected
    } else {
      config.project.type = await prompt(
        "Project type (e.g. nodejs, rust, python)",
        config.project.type,
      );
      config.project.stack.language = await prompt(
        "Primary language",
        config.project.stack.language,
      );
    }

    config.project.layout = await prompt(
      "Project layout (flat, src-nested, lib-nested, monorepo)",
      config.project.layout,
    );
    const architectureChoice = await prompt(
      "Architecture target (hexagonal-functional, layered, clean, or custom)",
      options.architecture ??
        existingProject.design?.architecture ??
        (typeof config.project.architecture === "string" &&
        config.project.architecture !== "unknown"
          ? config.project.architecture
          : "hexagonal-functional"),
    );
    config.project.design = resolveDesign({
      architecture: architectureChoice,
      principles: existingProject.design?.principles,
    });
    if (typeof config.project.architecture === "string")
      config.project.architecture = architectureChoice;
    const existingConventions = config.project.conventions;
    const conventionsAnswer = await prompt(
      "Conventions (e.g. TDD, ESM, functional)",
      typeof config.project.conventions === "string" &&
        config.project.conventions !== "unknown"
        ? config.project.conventions
        : "TDD",
    );

    config.project.conventions =
      typeof existingConventions === "object" && conventionsAnswer === "TDD"
        ? existingConventions
        : conventionsAnswer;

    if (await confirm("Perform workstation provisioning (SSH, gh auth)?")) {
      const { ssh, gh } = detectWorkstation();
      writeScopedStdout(
        ssh
          ? "✅ SSH keys detected.\n"
          : '⚠️ No SSH keys detected in ~/.ssh/. Generate one with: ssh-keygen -t ed25519 -C "you@example.com"\n',
      );
      writeScopedStdout(
        gh
          ? "✅ GitHub CLI authenticated.\n"
          : "⚠️ GitHub CLI (gh) not authenticated. Run 'gh auth login'.\n",
      );
      writeScopedStdout(
        "ℹ️  Note: If gwrk encounters file permission errors, ensure your Terminal has 'Full Disk Access' in macOS System Settings > Privacy & Security (TCC).\n",
      );
    }

    // Agent selection
    if (detectedAgents.length > 0) {
      writeScopedStdout("\nDetected agent backends:\n");
      for (const a of detectedAgents) {
        const icon = a.available ? "✅" : "❌";
        const status = a.available ? "Available" : "Installed but unavailable";
        writeScopedStdout(`  ${icon} ${a.name.padEnd(12)} ${status}\n`);
      }
      writeScopedStdout("\n");

      if (availableAgents.length > 0) {
        selectedDefault = await prompt(
          `Default agent [${availableNames.join("/")}]`,
          autoDefault,
        );
        // Validate selection
        if (!availableNames.includes(selectedDefault)) {
          writeScopedStdout(
            `⚠️ '${selectedDefault}' is not available. Using ${autoDefault}.\n`,
          );
          selectedDefault = autoDefault;
        }

        const remainingAgents = availableNames.filter(
          (a) => a !== selectedDefault,
        );
        if (remainingAgents.length > 0) {
          const fallbackInput = await prompt(
            "Fallback order (comma-separated)",
            remainingAgents.join(","),
          );
          selectedFallback = fallbackInput
            .split(",")
            .map((s) => s.trim())
            .filter((a) => availableNames.includes(a));
        } else {
          selectedFallback = [];
        }

        config.agents = buildAgentConfig(
          detectedAgents,
          selectedDefault,
          selectedFallback,
        );
      } else {
        writeScopedStdout(
          "⚠️ No available agent backends. Install agy, claude, or codex.\n",
        );
      }
    } else {
      writeScopedStdout(
        "⚠️ No agent backends detected. Install agy, claude, or codex.\n",
      );
    }

    const slackChannel = await prompt(
      "Slack channel for project notifications (leave blank to skip)",
      existingSlack?.channelId,
    );
    if (slackChannel) {
      config.project.slack = { channelId: slackChannel };
    } else {
      // biome-ignore lint/performance/noDelete: remove key before JSON serialization
      delete config.project.slack;
    }
  }

  // 5. Registry Sync (server-only — remote devices don't run the daemon)
  if (deviceRole === "server") {
    writeScopedStdout("Syncing plugin registry...\n");
    await syncRegistry();
  }

  // 6. Slack Setup (server-only)
  if (
    deviceRole === "server" &&
    (!isAgent || (process.env.SLACK_BOT_TOKEN && process.env.SLACK_APP_TOKEN))
  ) {
    try {
      await setupSlack({ ...options, nonInteractive: isNonInteractive });
      if (config.project.slack?.channelId) {
        writeScopedStdout(
          `Provisioning Slack channel ${config.project.slack.channelId}...\n`,
        );
        const channelId = await ensureSlackChannel(
          config.project.slack.channelId,
        );
        config.project.slack.channelId = channelId;
      }
    } catch (e) {
      if (!isNonInteractive) {
        writeScopedStdout("⚠️ Slack setup skipped or failed.\n");
      }
    }
  }

  // 7. Scaffold Directories
  const dirs = ["specs", "docs/architecture", "docs/decisions", ".gwrk/rules"];
  for (const d of dirs) {
    const dirPath = path.join(cwd, d);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  const globalPluginDirs = [
    path.join(os.homedir(), ".gwrk", "plugins", "skills"),
    path.join(os.homedir(), ".gwrk", "plugins", "agents"),
    path.join(os.homedir(), ".gwrk", "plugins", "workflows"),
  ];
  for (const d of globalPluginDirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // Built-in skills load from the installed package. No taxonomy seeding is needed.

  // 8. Write Config — split into project (tracked) and personal (gitignored).
  // Preserve any other tracked top-level keys the user had (extensions,
  // workspaces, server, effort); only project identity is refreshed here and
  // the personal `agents`/`slack` layers are removed from the tracked file.
  const projectConfig: Record<string, unknown> = { ...existingTracked };
  projectConfig.project = {
    ...config.project,
    name: config.project.name,
    type: config.project.type,
    stack: config.project.stack,
    layout: config.project.layout,
    architecture: config.project.architecture,
    conventions: config.project.conventions,
    toolchain: config.project.toolchain,
  };
  // biome-ignore lint/performance/noDelete: remove legacy agents block before JSON serialization
  delete projectConfig.agents;

  for (const name of Object.keys(config.agents.registry ?? {})) {
    if (existingAgents?.registry?.[name])
      config.agents.registry[name] = existingAgents.registry[name];
  }

  const personalConfig: Record<string, unknown> = {
    ...existingLocal,
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

  const selectedArchitecture =
    options.architecture ??
    config.project.design?.architecture ??
    (typeof config.project.architecture === "string" &&
    config.project.architecture !== "unknown"
      ? config.project.architecture
      : "hexagonal-functional");
  config.project.design = resolveDesign({
    architecture: selectedArchitecture,
    principles: options.principles
      ? options.principles.split(",").map((value: string) => value.trim())
      : config.project.design?.principles,
  });
  if (options.language)
    config.project.stack = {
      ...config.project.stack,
      language: options.language,
    };
  if (options.framework)
    config.project.stack = {
      ...config.project.stack,
      framework: options.framework,
    };
  projectConfig.project = { ...config.project };
  (projectConfig.project as Record<string, unknown>).slack = undefined;
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

  const decisionsDir = await resolveDecisionsDir(cwd);
  const context = await installArchitectureContext(cwd, {
    projectName: config.project.name,
    design: config.project.design,
    language: config.project.stack?.language,
    framework: config.project.stack?.framework,
    decisionsDir: path.relative(cwd, decisionsDir).split(path.sep).join("/"),
  });
  const { parseCorpus } = await import("../engine/adr-parser.js");
  const { writeIndex } = await import("../engine/adr-index.js");
  try {
    await writeIndex(cwd, await parseCorpus(decisionsDir));
  } catch (error) {
    context.status = "incomplete";
    context.conflicts.push(`Decision index: ${(error as Error).message}`);
  }

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
      status: context.status === "ready" ? "success" : "incomplete",
      context,
      projectId: config.project.name,
      profile: config.project,
      extensions: config.extensions,
      agents: config.agents,
    };
    writeScopedStdout(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    writeScopedStdout("\n✅ gwrk initialized successfully.\n");
    writeScopedStdout(`Project config written to ${configPath}\n`);
    writeScopedStdout(
      `Agent config written to ${localConfigPath} (gitignored — personal to your machine)\n`,
    );
    writeScopedStdout(
      `Shareable template written to ${exampleConfigPath} (commit this; teammates copy it to .gwrkrc.local.json)\n`,
    );
    writeScopedStdout(
      `Architecture context: ${context.status}. Code conformance: unassessed.\n`,
    );
    if (context.conflicts.length)
      writeScopedStdout(
        `Preserved edited files: ${context.conflicts.join(", ")}\n`,
      );
    writeScopedStdout("Next steps:\n  gwrk assess\n");
    writeScopedStdout("  gwrk define spec my-feature\n");
    writeScopedStdout("  gwrk status\n\n");
  }
};

export const createInitCommand = () =>
  new Command("init")
    .description("Initialize a new gwrk project")
    .option(
      "--context-only",
      "Install project context without machine or agent provisioning",
    )
    .option(
      "--architecture <target>",
      "Desired architecture target without assessing code",
    )
    .option(
      "--principles <list>",
      "Comma-separated functional-core, clean-code, tdd",
    )
    .option("--language <name>", "Primary language for context composition")
    .option("--framework <name>", "Framework for context composition")
    .option("--non-interactive", "Run without interactive prompts")
    .option("--agent", "Agent-optimized init mode")
    .option("--workspace <name>", "Select a workspace profile")
    .option(
      "--remote",
      "Register this machine as a remote device (no daemon, no harvest)",
    )
    .option("--server", "Register this machine as the gwrk server")
    .action(initAction);

export const initCommand = createInitCommand();
