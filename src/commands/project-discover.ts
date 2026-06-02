import { Command } from "commander";
import { discoverProject } from "../engine/discover.js";
import { withSignal } from "../utils/signal.js";

/**
 * FR-004: `gwrk project discover`
 * Assembles full project state from repository contents.
 * Primary agent-native surface: `gwrk project discover --format json`
 */
export const projectDiscoverCommand = new Command("discover")
  .description("Discover project structure, specs, gates, and config")
  .option("--format <type>", "Output format (text, json)", "text")
  .action(async (options) => {
    await withSignal("project discover", async () => {
      const result = await discoverProject(process.cwd());

      if (options.format === "json") {
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      // Text output
      process.stdout.write(`Project: ${result.project.name}\n`);
      process.stdout.write(`Root: ${result.project.root}\n`);
      process.stdout.write(
        `Git: ${result.project.git.branch} (${result.project.git.clean ? "clean" : "dirty"}) — ${result.project.git.lastCommit}\n`,
      );
      process.stdout.write(`\n`);

      process.stdout.write(`Specs (${result.specs.length}):\n`);
      for (const s of result.specs) {
        const tasks =
          s.hasTasks
            ? ` [${s.tasksComplete}/${s.tasksComplete + s.tasksOpen} tasks]`
            : "";
        process.stdout.write(`  ${s.id} ${s.name} — ${s.status}${tasks}\n`);
      }
      process.stdout.write(`\n`);

      process.stdout.write(`Gates: ${result.gates.total} total\n`);
      process.stdout.write(
        `Config: slack=${result.config.hasSlack} server=${result.config.hasServer}\n`,
      );
      if (result.config.agents.length > 0) {
        process.stdout.write(
          `Agents: ${result.config.agents.join(", ")}\n`,
        );
      }
    });
  });
