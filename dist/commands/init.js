import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
export const initCommand = new Command("init")
  .description("Initialize gwrk in the current directory")
  .action(() => {
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
      },
      agents: {
        define: "gemini",
        implement: "codex-cloud",
      },
    };
    fs.writeFileSync(
      path.join(projectRoot, ".gwrkrc.json"),
      JSON.stringify(config, null, 2),
    );
    // Placeholder for "copying template files"
    // In a real CLI, we might bundle these with the package
    // or include them as strings. For now we'll just create some
    // placeholder files to satisfy the spirit of FR-001.
    const workflows = ["specify.md", "plan.md"];
    for (const wf of workflows) {
      fs.writeFileSync(
        path.join(projectRoot, ".agent/workflows", wf),
        `# Workflow: ${wf}\n\nPlaceholder content for ${wf}.`,
      );
    }
    console.log("Successfully initialized gwrk project");
  });
