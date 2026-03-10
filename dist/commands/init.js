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
    .action(async (options) => {
    const projectRoot = process.cwd();
    const agentDir = path.join(projectRoot, ".agent");
    if (fs.existsSync(agentDir)) {
        console.log("gwrk already initialized");
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
    const config = {
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
    if (options.slack) {
        const { ensureSlackChannel } = await import("../server/slack-channel.js");
        const { loadSlackConfig } = await import("../utils/slack-client.js");
        const hasTokens = loadSlackConfig();
        if (hasTokens) {
            try {
                console.log(`Creating Slack channel ${options.slack}...`);
                const channelId = await ensureSlackChannel(options.slack);
                config.project.slack = {
                    channelId,
                    channelName: options.slack,
                };
                console.log(`Successfully provisioned Slack channel: ${options.slack} (${channelId})`);
            }
            catch (error) {
                console.warn(`Warning: Failed to provision Slack channel: ${error.message}`);
            }
        }
        else {
            console.warn("Warning: Slack not configured (no tokens found). Run gwrk setup slack first to enable Slack features.");
        }
    }
    fs.writeFileSync(path.join(projectRoot, ".gwrkrc.json"), JSON.stringify(config, null, 2));
    // Placeholder for "copying template files"
    const workflows = ["specify.md", "plan.md"];
    for (const wf of workflows) {
        fs.writeFileSync(path.join(projectRoot, ".agent/workflows", wf), `# Workflow: ${wf}\n\nPlaceholder content for ${wf}.`);
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
            const remoteRes = await execCommand("git", ["remote", "get-url", "origin"], undefined, { cwd: projectRoot });
            if (remoteRes.exitCode !== 0) {
                console.log(`Creating private GitHub repository ${options.github}...`);
                const ghRes = await execCommand("gh", ["repo", "create", options.github, "--private", "--source", "."], undefined, { cwd: projectRoot });
                if (ghRes.exitCode === 0) {
                    console.log(`Successfully created and linked GitHub repository: ${options.github}`);
                }
                else {
                    console.warn(`Warning: Failed to create GitHub repository: ${ghRes.stderr.trim()}`);
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
            fs.writeFileSync(path.join(projectRoot, cli.file), `# ${cli.name.toUpperCase()} Project Context\n\nThis project is managed by gwrk.\nRules: .agent/rules/\nWorkflows: .agent/workflows/\n`);
            console.log(`Detected ${cli.name}, provisioned ${cli.file}`);
        }
    }
    console.log("Successfully initialized gwrk project");
});
