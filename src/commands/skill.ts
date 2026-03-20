import fs from "node:fs";
import { Command } from "commander";
import { executeSkill } from "../plugins/skill-runtime.js";
import { PluginLoader } from "../plugins/loader.js";
import { color } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";

const { BOLD, DIM, CYAN, GREEN, YELLOW, RED, RESET } = color;

/**
 * FR-006: gwrk skill <name> command handler.
 */
export const skillCommand = new Command("skill")
  .description("Invoke a reasoning skill")
  .argument("<name>", "Name of the skill to invoke")
  .option("--format <type>", "Output format (json)")
  .option("--agent", "Enable Agent-Native Mode (ANSI-stripped)", false)
  .addHelpText(
    "after",
    `
Examples:
  echo "brief.md" | gwrk skill narrative
  gwrk skill signal-cut < input.md --format json
  gwrk skill truth-extract --product gwrk

Type: reasoning (invokes LLM)
Format: inherits global --format and --agent flags
Exit codes:
  0: Success
  1: Skill not found, dependency missing, or execution failed
  2: Usage error
`,
  )
  .action(async (name, options, command) => {
    await withSignal("skill", async () => {
      // Read stdin
      let input = "";
      if (!process.stdin.isTTY) {
        input = fs.readFileSync(0, "utf-8");
      }

      const loader = new PluginLoader();
      
      try {
        const result = await executeSkill(name, { 
          input, 
          format: options.format, 
          agent: options.agent,
          ...options // Pass extra flags from command line
        });

        // stdout is the skill result
        process.stdout.write(result.stdout);
        
        // stderr already has the signal from executeSkill
        // but we might need to be careful not to double-signal
        // withSignal also adds a signal if we don't handle it.
        // Actually executeSkill adds [exit:N | Xs] to result.stderr.
        // Let's just print result.stderr.
        process.stderr.write(result.stderr);

      } catch (err: any) {
        if (err.stderr) {
          process.stderr.write(err.stderr);
        }
        if (err.message && !options.agent) {
          console.error(`${RED}Error:${RESET} ${err.message}`);
        }
        process.exit(err.exitCode || 1);
      }
    });
  });
