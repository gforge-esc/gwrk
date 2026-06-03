import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as readline from "node:readline";
import { Command } from "commander";
import { registerProject } from "../db/runs.js";
import type { GwrkConfig } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";

import { detectProfile } from "../engine/profile-detector.js";
import { migratePlugins } from "../plugins/migrate.js";
import { seedSkills } from "../plugins/seed.js";
import { banner, color, success } from "../utils/format.js";
import { CommandError, withSignal } from "../utils/signal.js";

const { BOLD, DIM, GREEN, CYAN, YELLOW, RESET } = color;

async function ask(
  rl: readline.Interface,
  question: string,
  defaultValue?: string,
): Promise<string> {
  const q = defaultValue
    ? `  ${question} ${DIM}[${defaultValue}]${RESET} `
    : `  ${question} `;
  return new Promise((resolve) => {
    rl.question(q, (answer) => resolve(answer.trim() || defaultValue || ""));
  });
}

export const initCommand = new Command("init")
  .description("Initialize gwrk in the current directory")
  .option("--github <repo>", "GitHub repository (owner/name)")
  .option("--slack <channel>", "Slack channel")
  .option("--slack-ops <channel>", "Slack ops channel")
  .option("--webhook <url>", "Slack incoming webhook URL for this project")
  .option("--non-interactive", "Run without interactive prompts", false)
  .option("--type <type>", "Project type (nodejs, rust, python, etc.)")
  .option(
    "--stack <stack>",
    "Project stack (language, framework, build system)",
  )
  .option("--layout <layout>", "Project layout (flat, src-nested, monorepo)")
  .option("--architecture <arch>", "Project architecture description")
  .option("--conventions <conv>", "Project coding conventions")
  .action(initAction);

export async function initAction(options: any) {
  await withSignal("init", async () => {
    const projectRoot = process.cwd();
    const startTime = Date.now();
      const isInteractive = !options.nonInteractive && process.stdin.isTTY;

      banner("project init", {
        Project: path.basename(projectRoot),
        Mode: isInteractive ? "Interactive" : "Non-interactive",
      });

      const rl = isInteractive
        ? readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          })
        : null;

      try {
        const gwrkDir = path.join(projectRoot, ".gwrk");
        const rcPath = path.join(projectRoot, ".gwrkrc.json");

        // 1. Profile Detection
        console.log(`\n  ${CYAN}Step 1: Project Profile Detection${RESET}`);
        const detected = await detectProfile(projectRoot);
        const profile = {
          type: options.type || detected.type,
          stack: {
            language: detected.stack?.language,
            framework: detected.stack?.framework,
            buildSystem: detected.stack?.buildSystem,
          },
          layout: options.layout || detected.layout,
          architecture: options.architecture,
          conventions: options.conventions,
        };

        if (isInteractive && rl) {
          console.log(
            `  Detected project type: ${BOLD}${profile.type}${RESET}`,
          );
          console.log(
            `  Detected stack: ${DIM}${JSON.stringify(profile.stack)}${RESET}`,
          );

          const confirm = await ask(
            rl,
            "Confirm or override profile? (y/N)",
            "n",
          );
          if (confirm.toLowerCase() === "y") {
            profile.type = await ask(rl, "Project type", profile.type);
            profile.stack.language = await ask(
              rl,
              "Language",
              profile.stack.language,
            );
            profile.stack.framework = await ask(
              rl,
              "Framework",
              profile.stack.framework,
            );
            profile.stack.buildSystem = await ask(
              rl,
              "Build System",
              profile.stack.buildSystem,
            );
            profile.layout = await ask(rl, "Layout", profile.layout);
            profile.architecture = await ask(
              rl,
              "Architecture",
              profile.architecture,
            );
            profile.conventions = await ask(
              rl,
              "Conventions",
              profile.conventions,
            );
          }
        }

        // 2. Workstation Provisioning (Absorbed from setup.ts)
        console.log(`\n  ${CYAN}Step 2: Workstation Provisioning${RESET}`);
        const { loadSetupState, saveSetupState } = await import(
          "../utils/setup-state.js"
        );
        const state = loadSetupState() || {
          steps: { tcc: false, ssh: false, gh: false, verification: false },
        };

        if (isInteractive && rl) {
          // TCC
          if (!state.steps.tcc) {
            console.log(`\n  ${CYAN}macOS TCC Permissions${RESET}`);
            console.log(
              "  Agents need Full Disk Access to operate without prompts.",
            );
            console.log(
              `  Please open ${BOLD}System Settings → Privacy & Security → Full Disk Access${RESET}`,
            );
            const done = await ask(
              rl,
              "Have you granted Full Disk Access? (y/N)",
            );
            if (done.toLowerCase() === "y") {
              state.steps.tcc = true;
              saveSetupState(state);
            }
          }

          // SSH
          if (!state.steps.ssh) {
            console.log(`\n  ${CYAN}SSH Key Configuration${RESET}`);
            const choice = await ask(
              rl,
              "Configure SSH? A) 1Password, B) Dedicated Key, S) Skip",
              "b",
            );
            if (choice.toLowerCase() === "b") {
              const sshDir = path.join(os.homedir(), ".ssh");
              const keyPath = path.join(sshDir, "gwrk-agent");
              if (!fs.existsSync(sshDir)) fs.mkdirSync(sshDir, { mode: 0o700 });
              if (!fs.existsSync(keyPath)) {
                console.log(`  Generating dedicated key: ${keyPath}`);
                try {
                  const { execSync } = await import("node:child_process");
                  execSync(
                    `ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "gwrk-agent@$(hostname)"`,
                    { stdio: "inherit" },
                  );
                } catch (e) {
                  console.warn(
                    `  Warning: Failed to generate SSH key: ${(e as Error).message}`,
                  );
                }
              }
              state.steps.ssh = true;
              saveSetupState(state);
            } else if (
              choice.toLowerCase() === "a" ||
              choice.toLowerCase() === "s"
            ) {
              state.steps.ssh = true;
              saveSetupState(state);
            }
          }

          // GH Auth
          if (!state.steps.gh) {
            console.log(`\n  ${CYAN}GitHub CLI Authentication${RESET}`);
            try {
              const { execSync } = await import("node:child_process");
              execSync("gh auth status", { stdio: "ignore" });
              state.steps.gh = true;
            } catch {
              console.log("  GitHub CLI is not authenticated.");
              const done = await ask(rl, "Have you authenticated gh? (y/N)");
              if (done.toLowerCase() === "y") {
                state.steps.gh = true;
                saveSetupState(state);
              }
            }
          }
        }

        // 3. Scaffolding & Config Generation
        console.log(`\n  ${CYAN}Step 3: Scaffolding & Configuration${RESET}`);

        let config: GwrkConfig;

        if (fs.existsSync(gwrkDir) && fs.existsSync(rcPath)) {
          console.log("  Project already initialized. Updating profile...");
          config = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
          config.project = {
            ...config.project,
            type: profile.type,
            stack: profile.stack,
            layout: profile.layout,
            architecture: profile.architecture,
            conventions: profile.conventions,
          };
          if (options.github) config.project.githubRepo = options.github;
        } else {
          // Initialize new project
          const dirs = [
            "specs",
            ".gwrk/rules",
            ".gwrk/ontology",
            ".gwrk/perspective",
          ];
          for (const dir of dirs) {
            try {
              fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
            } catch (e: any) {
              if (e.code !== "EEXIST") throw e;
            }
          }
          // Provision global plugins
          const globalPluginBase = path.join(os.homedir(), ".gwrk", "plugins");
          for (const type of ["skills", "agents", "workflows"]) {
            fs.mkdirSync(path.join(globalPluginBase, type), {
              recursive: true,
            });
          }

          await seedSkills();
          await migratePlugins();

          // Seed Rules
          const gwrkRulesDir = path.join(projectRoot, ".gwrk", "rules");
          // @ts-ignore
          const builtInRulesDir = path.join(
            import.meta.dirname,
            "../plugins/builtins/rules",
          );
          if (fs.existsSync(builtInRulesDir)) {
            const rules = fs.readdirSync(builtInRulesDir);
            for (const rule of rules) {
              fs.copyFileSync(
                path.join(builtInRulesDir, rule),
                path.join(gwrkRulesDir, rule),
              );
            }
          }

          // Seed .gitattributes — merge protection for task state (ADR-003)
          const gitattrsPath = path.join(projectRoot, ".gitattributes");
          if (!fs.existsSync(gitattrsPath)) {
            fs.writeFileSync(
              gitattrsPath,
              [
                "# gwrk merge strategies — protect task state across branches",
                "#",
                "# tasks.json: Keep the current branch version on conflict.",
                "# Manual reconciliation required after merge.",
                "specs/**/.gwrk/tasks.json merge=ours",
                "",
                "# Execution manifests: binary merge (both sides' files survive as separate files).",
                "specs/**/.gwrk/runs/*.json merge=binary",
                "",
                "# History (deprecated, will be removed): append-only union merge.",
                "specs/**/.gwrk/history.jsonl merge=union",
                "",
              ].join("\n"),
            );
            console.log(`  ${GREEN}✓${RESET} .gitattributes (merge protection)`);
          }

          const projectName = path.basename(projectRoot);
          config = {
            project: {
              name: projectName,
              githubRepo: options.github,
              type: profile.type,
              stack: profile.stack,
              layout: profile.layout,
              architecture: profile.architecture,
              conventions: profile.conventions,
            },
            agents: {
              define: "gemini",
              implement: "gemini",
            },
            server: {
              port: 18790,
              host: "localhost",
              heartbeatIntervalMs: 5000,
              networkCheckIntervalMs: 30000,
            },
            parallelism: {
              local: {
                maxCpu: 80,
                maxMem: 80,
                minDiskGb: 10,
                maxClones: 2,
              },
              cloud: {
                maxConcurrent: 10,
              },
            },
          };
        }

        // Slack Channel Provisioning
        if (options.slack || options.slackOps) {
          const { ensureSlackChannel } = await import(
            "../server/slack-channel.js"
          );
          const { loadSlackConfig } = await import("../utils/slack-client.js");
          if (loadSlackConfig()) {
            const slack = config.project.slack || {
              channelId: "",
              channelName: "",
            };
            config.project.slack = slack;
            try {
              if (options.slack) {
                console.log(`  Provisioning Slack channel ${options.slack}...`);
                slack.channelId = await ensureSlackChannel(options.slack);
                slack.channelName = options.slack;
              }
              if (options.slackOps) {
                console.log(
                  `  Provisioning Slack ops channel ${options.slackOps}...`,
                );
                slack.opsChannelId = await ensureSlackChannel(options.slackOps);
                slack.opsChannelName = options.slackOps;
              }
            } catch (e) {
              console.warn(
                `  Warning: Slack provisioning failed: ${(e as Error).message}`,
              );
            }
          }
        }

        if (options.webhook) {
          config.project.slack = config.project.slack || {
            channelId: "",
            channelName: "",
          };
          config.project.slack.webhookUrl = options.webhook;
        }

        fs.writeFileSync(rcPath, JSON.stringify(config, null, 2));

        // SQLite Project Registration
        const projectId = crypto
          .createHash("md5")
          .update(projectRoot)
          .digest("hex");
        registerProject({
          id: projectId,
          name: config.project.name,
          path: projectRoot,
          github_repo: config.project.githubRepo,
          slack_channel: config.project.slack?.channelName,
        });

        // Agent/Registry Sync
        const { AgentBackendRegistry } = await import(
          "../plugins/agent-registry.js"
        );
        const { PluginLoader } = await import("../plugins/loader.js");
        const registry = new AgentBackendRegistry(new PluginLoader());
        await registry.syncAllBackends(
          projectRoot,
          "# GWRK Project Context\n\nThis project is managed by gwrk.\n",
        );

        const durationS = Math.round((Date.now() - startTime) / 1000);
        success("init", durationS);
      } finally {
        if (rl) rl.close();
      }
    });
}
