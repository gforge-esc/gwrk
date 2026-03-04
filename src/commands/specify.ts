import { Command } from "commander";
import { dispatchAgent } from "../utils/agent.js";
import { loadConfig } from "../utils/config.js";

export const specifyCommand = new Command("specify")
  .description("Define a new feature specification")
  .argument("<prompt>", "The feature description or prompt")
  .action(async (prompt) => {
    const config = loadConfig(process.cwd());
    const result = await dispatchAgent({
      backend: config.agents.define,
      workflowPath: ".agent/workflows/specify.md",
      prompt,
    });

    if (result.exitCode !== 0) {
      if (result.stderr) console.error(result.stderr);
      process.exit(result.exitCode);
    }

    if (result.stdout) console.log(result.stdout);
  });
