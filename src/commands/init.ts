import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { registerProject } from "../db/runs.js";
import { execCommand } from "../utils/exec.js";

export const initCommand = new Command("init")
  .description("Initialize gwrk in the current directory")
  .option("--github <repo>", "GitHub repository (owner/name)")
  .option("--slack <channel>", "Slack channel")
  .option("--slack-ops <channel>", "Slack ops channel")
  .action(async (options) => {
    const projectRoot = process.cwd();
    const agentDir = path.join(projectRoot, ".agent");
    const rcPath = path.join(projectRoot, ".gwrkrc.json");

    // Already initialized — handle additive flags, then exit
    if (fs.existsSync(agentDir)) {
      let didWork = false;

      if (options.slack || options.slackOps) {
        const { ensureSlackChannel } = await import(
          "../server/slack-channel.js"
        );
        const { loadSlackConfig } = await import("../utils/slack-client.js");

        const hasTokens = loadSlackConfig();
        if (!hasTokens) {
          console.error("Slack not configured. Run gwrk setup slack first.");
          process.exit(1);
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
            console.log(`Provisioning Slack ops channel ${options.slackOps}...`);
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

      if (!didWork) {
        console.log("gwrk already initialized");
      }
      process.exit(0);
    }

    const dirs = [
      ".agent/workflows",
      ".agent/rules",
      ".specify/templates",
      "specs",
    ];

    for (const dir of dirs) {
      fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
    }

    const projectName = path.basename(projectRoot);
    const config: any = {
      project: {
        name: projectName,
        githubRepo: options.github,
      },
      agents: {
        define: "gemini",
        implement: "codex-cloud",
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
      const { ensureSlackChannel } = await import("../server/slack-channel.js");
      const { loadSlackConfig } = await import("../utils/slack-client.js");

      const hasTokens = loadSlackConfig();
      if (hasTokens) {
        config.project.slack = config.project.slack || {};
        try {
          if (options.slack) {
            console.log(`Creating Slack channel ${options.slack}...`);
            const channelId = await ensureSlackChannel(options.slack);
            config.project.slack.channelId = channelId;
            config.project.slack.channelName = options.slack;
            console.log(
              `Successfully provisioned Slack channel: ${options.slack} (${channelId})`,
            );
          }
          if (options.slackOps) {
            console.log(`Creating Slack ops channel ${options.slackOps}...`);
            const opsChannelId = await ensureSlackChannel(options.slackOps);
            config.project.slack.opsChannelId = opsChannelId;
            config.project.slack.opsChannelName = options.slackOps;
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

    fs.writeFileSync(
      path.join(projectRoot, ".gwrkrc.json"),
      JSON.stringify(config, null, 2),
    );

    // Placeholder for "copying template files"
    const workflows = ["specify.md", "plan.md"];
    for (const wf of workflows) {
      fs.writeFileSync(
        path.join(projectRoot, ".agent/workflows", wf),
        `# Workflow: ${wf}\n\nPlaceholder content for ${wf}.`,
      );
    }

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

    // CLI Detection & Provisioning
    const clis = [
      { name: "gemini", file: "GEMINI.md" },
      { name: "claude", file: "CLAUDE.md" },
      { name: "codex", file: "AGENTS.md" },
    ];

    for (const cli of clis) {
      const res = await execCommand("which", [cli.name]);
      if (res.exitCode === 0) {
        fs.writeFileSync(
          path.join(projectRoot, cli.file),
          `# ${cli.name.toUpperCase()} Project Context\n\nThis project is managed by gwrk.\nRules: .agent/rules/\nWorkflows: .agent/workflows/\n`,
        );
        console.log(`Detected ${cli.name}, provisioned ${cli.file}`);
      }
    }

    console.log("Successfully initialized gwrk project");
  });
