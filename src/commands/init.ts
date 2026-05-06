import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { registerProject } from "../db/runs.js";
import type { GwrkConfig } from "../utils/config.js";
import { execCommand } from "../utils/exec.js";

import { seedSkills } from "../plugins/seed.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const initCommand = new Command("init")
  .description("Initialize gwrk in the current directory")
  .option("--github <repo>", "GitHub repository (owner/name)")
  .option("--slack <channel>", "Slack channel")
  .option("--slack-ops <channel>", "Slack ops channel")
  .option("--webhook <url>", "Slack incoming webhook URL for this project")
  .action(async (options) => {
    await withSignal("init", async () => {
      const projectRoot = process.cwd();
      const gwrkDir = path.join(projectRoot, ".gwrk");
      const rcPath = path.join(projectRoot, ".gwrkrc.json");

      // Already initialized — handle additive flags, then exit
      if (fs.existsSync(gwrkDir) && fs.existsSync(rcPath)) {
        let didWork = false;

        if (options.slack || options.slackOps) {
          const { ensureSlackChannel } = await import(
            "../server/slack-channel.js"
          );
          const { loadSlackConfig } = await import("../utils/slack-client.js");

          const hasTokens = loadSlackConfig();
          if (!hasTokens) {
            throw new CommandError(
              "Slack not configured. Run gwrk setup slack first.",
              1,
            );
          }

          // Update .gwrkrc.json with Slack config
          const existing = fs.existsSync(rcPath)
            ? JSON.parse(fs.readFileSync(rcPath, "utf-8"))
            : {};
          existing.project = existing.project || {};
          existing.project.slack = existing.project.slack || {};

          if (options.slack) {
            try {
              console.log(`Provisioning Slack channel ${options.slack}...`);
              const channelId = await ensureSlackChannel(options.slack);
              existing.project.slack.channelId = channelId;
              existing.project.slack.channelName = options.slack;
              console.log(
                `Provisioned Slack channel: ${options.slack} (${channelId})`,
              );
            } catch (error) {
              console.warn(
                `Warning: Failed to provision Slack channel: ${(error as Error).message}`,
              );
            }
          }

          if (options.slackOps) {
            try {
              console.log(
                `Provisioning Slack ops channel ${options.slackOps}...`,
              );
              const opsChannelId = await ensureSlackChannel(options.slackOps);
              existing.project.slack.opsChannelId = opsChannelId;
              existing.project.slack.opsChannelName = options.slackOps;
              console.log(
                `Provisioned Slack ops channel: ${options.slackOps} (${opsChannelId})`,
              );
            } catch (error) {
              console.warn(
                `Warning: Failed to provision Slack ops channel: ${(error as Error).message}`,
              );
            }
          }

          fs.writeFileSync(rcPath, JSON.stringify(existing, null, 2));
          didWork = true;
        }

        if (options.webhook) {
          const existing = JSON.parse(fs.readFileSync(rcPath, "utf-8"));
          existing.project = existing.project || {};
          existing.project.slack = existing.project.slack || {};
          existing.project.slack.webhookUrl = options.webhook;
          fs.writeFileSync(rcPath, JSON.stringify(existing, null, 2));
          console.log(`Webhook URL saved to .gwrkrc.json`);
          didWork = true;
        }

        if (!didWork) {
          console.log("gwrk already initialized");
        }
        return;
      }

      const dirs = [".specify/templates", "specs"];

      for (const dir of dirs) {
        fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
      }

      // Provision global plugins (US-014)
      const globalPluginBase = path.join(os.homedir(), ".gwrk", "plugins");
      const pluginTypes = ["skills", "agents", "workflows"];
      for (const type of pluginTypes) {
        fs.mkdirSync(path.join(globalPluginBase, type), { recursive: true });
      }

      // Seed Skills (FR-012)
      await seedSkills();

      // Seed Workflows (FR-L25-005)
      // @ts-ignore
      const builtInWorkflowsDir = path.join(
        import.meta.dirname,
        "../plugins/builtins/workflows",
      );
      const workflowDestDir = path.join(globalPluginBase, "workflows");

      try {
        const workflows = fs.readdirSync(builtInWorkflowsDir);
        for (const wf of workflows) {
          const src = path.join(builtInWorkflowsDir, wf);
          const dest = path.join(workflowDestDir, wf);
          if (fs.statSync(src).isDirectory()) {
            fs.mkdirSync(dest, { recursive: true });
            const files = fs.readdirSync(src);
            for (const file of files) {
              fs.copyFileSync(path.join(src, file), path.join(dest, file));
            }
          }
        }
      } catch (e) {
        console.warn(
          `Warning: Could not seed workflows: ${(e as Error).message}`,
        );
      }

      const projectName = path.basename(projectRoot);
      const config: GwrkConfig = {
        project: {
          name: projectName,
          githubRepo: options.github,
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

      // Slack Channel Provisioning
      if (options.slack || options.slackOps) {
        const { ensureSlackChannel } = await import(
          "../server/slack-channel.js"
        );
        const { loadSlackConfig } = await import("../utils/slack-client.js");

        const hasTokens = loadSlackConfig();
        if (hasTokens) {
          const slack = config.project.slack ?? {
            channelId: "",
            channelName: "",
          };
          config.project.slack = slack;
          try {
            if (options.slack) {
              console.log(`Creating Slack channel ${options.slack}...`);
              const channelId = await ensureSlackChannel(options.slack);
              slack.channelId = channelId;
              slack.channelName = options.slack;
              console.log(
                `Successfully provisioned Slack channel: ${options.slack} (${channelId})`,
              );
            }
            if (options.slackOps) {
              console.log(`Creating Slack ops channel ${options.slackOps}...`);
              const opsChannelId = await ensureSlackChannel(options.slackOps);
              slack.opsChannelId = opsChannelId;
              slack.opsChannelName = options.slackOps;
              console.log(
                `Successfully provisioned Slack ops channel: ${options.slackOps} (${opsChannelId})`,
              );
            }
          } catch (error) {
            console.warn(
              `Warning: Failed to provision Slack channel: ${(error as Error).message}`,
            );
          }
        } else {
          console.warn(
            "Warning: Slack not configured (no tokens found). Run gwrk setup slack first to enable Slack features.",
          );
        }
      }

      // Webhook URL
      if (options.webhook) {
        const slack = config.project.slack ?? {
          channelId: "",
          channelName: "",
        };
        config.project.slack = slack;
        slack.webhookUrl = options.webhook;
        console.log(`Webhook URL saved to .gwrkrc.json`);
      }

      fs.writeFileSync(
        path.join(projectRoot, ".gwrkrc.json"),
        JSON.stringify(config, null, 2),
      );

      // SQLite Project Registration
      const projectId = crypto
        .createHash("md5")
        .update(projectRoot)
        .digest("hex");
      registerProject({
        id: projectId,
        name: projectName,
        path: projectRoot,
        github_repo: options.github,
        slack_channel: options.slack,
      });

      // GitHub Repo Creation (if requested and gh is available)
      if (options.github) {
        const ghCheck = await execCommand("which", ["gh"]);
        if (ghCheck.exitCode === 0) {
          // Check if remote already exists
          const remoteRes = await execCommand(
            "git",
            ["remote", "get-url", "origin"],
            undefined,
            { cwd: projectRoot },
          );
          if (remoteRes.exitCode !== 0) {
            console.log(
              `Creating private GitHub repository ${options.github}...`,
            );
            const ghRes = await execCommand(
              "gh",
              ["repo", "create", options.github, "--private", "--source", "."],
              undefined,
              { cwd: projectRoot },
            );
            if (ghRes.exitCode === 0) {
              console.log(
                `Successfully created and linked GitHub repository: ${options.github}`,
              );
            } else {
              console.warn(
                `Warning: Failed to create GitHub repository: ${ghRes.stderr.trim()}`,
              );
            }
          }
        }
      }

      // CLI Detection & Provisioning (Plugin-aware)
      const gwrkLocalDir = path.join(projectRoot, ".gwrk");
      fs.mkdirSync(gwrkLocalDir, { recursive: true });

      const contextPath = path.join(gwrkLocalDir, "agent-context.md");
      const defaultGovernance =
        "# GWRK Project Context\n\nThis project is managed by gwrk.\nWorkflows: ~/.gwrk/plugins/workflows/\nSkills: ~/.gwrk/plugins/skills/\n";
      fs.writeFileSync(contextPath, defaultGovernance);

      // Install git hooks from scripts/hooks/ if available
      const hooksSource = path.join(projectRoot, "scripts", "hooks");
      const hooksTarget = path.join(projectRoot, ".git", "hooks");
      if (
        fs.existsSync(hooksSource) &&
        fs.existsSync(path.join(projectRoot, ".git"))
      ) {
        const hookFiles = fs.readdirSync(hooksSource);
        for (const hook of hookFiles) {
          const src = path.join(hooksSource, hook);
          const dest = path.join(hooksTarget, hook);
          fs.copyFileSync(src, dest);
          fs.chmodSync(dest, 0o755);
        }
        if (hookFiles.length > 0) {
          console.log(
            `Installed ${hookFiles.length} git hook(s) from scripts/hooks/`,
          );
        }
      }

      const { AgentBackendRegistry } = await import(
        "../plugins/agent-registry.js"
      );
      const { PluginLoader } = await import("../plugins/loader.js");
      const registry = new AgentBackendRegistry(new PluginLoader());

      await registry.syncAllBackends(projectRoot, defaultGovernance);

      console.log("Successfully initialized gwrk project");
    });
  });
