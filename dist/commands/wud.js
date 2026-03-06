import { Command } from "commander";
import { shipCommand } from "./ship.js";
export const wudCommand = new Command("wud")
    .description("Work Until Done — autonomous implement→review→PR loop")
    .argument("<feature>", "Feature ID")
    .argument("<phase>", "Phase number")
    .option("--dry-run", "Dry run mode")
    .option("--max-iterations <n>", "Max iterations", "3")
    .option("--ci-timeout <m>", "CI timeout in minutes", "30")
    .action(async (feature, phase, opts) => {
    // Delegate to gwrk ship done
    const args = [
        process.argv[0],
        "ship",
        "done",
        feature,
        phase,
        "--max-iterations",
        opts.maxIterations,
        ...(opts.dryRun ? ["--dry-run"] : []),
    ];
    await shipCommand.parseAsync(args);
});
