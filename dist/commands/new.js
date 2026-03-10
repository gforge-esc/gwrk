import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { execCommand } from "../utils/exec.js";
import { initCommand } from "./init.js";
export const newCommand = new Command("new")
    .description("Create a new gwrk project from scratch")
    .argument("<name>", "Name of the new project")
    .option("--github <repo>", "GitHub repository (owner/name)")
    .option("--slack <channel>", "Slack channel")
    .action(async (name, options) => {
    const projectPath = path.resolve(process.cwd(), name);
    if (fs.existsSync(projectPath)) {
        console.error(`Directory ${name} already exists`);
        process.exit(1);
    }
    console.log(`Creating project ${name} at ${projectPath}...`);
    fs.mkdirSync(projectPath, { recursive: true });
    // git init
    const gitRes = await execCommand("git", ["init"], undefined, { cwd: projectPath });
    if (gitRes.exitCode !== 0) {
        console.error("Failed to initialize git repository");
        process.exit(1);
    }
    // Delegate to init
    // We change the current working directory to the new project path
    process.chdir(projectPath);
    // We call initCommand.parseAsync with the options
    const initArgs = [];
    if (options.github)
        initArgs.push("--github", options.github);
    if (options.slack)
        initArgs.push("--slack", options.slack);
    await initCommand.parseAsync(initArgs, { from: "user" });
});
