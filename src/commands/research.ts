import { ResearchScaffolder } from "../engine/research-scaffold.js";
import { Command } from "commander";
import { success } from "../utils/format.js";

/**
 * FR-R006-001: Command handler for 'gwrk define research <initiative>'
 */

export interface ResearchArgs {
  initiative: string;
  methodology?: string;
}

export async function researchCommandHandler(args: ResearchArgs): Promise<string> {
  if (!args.initiative) {
    throw new Error("Initiative name is required");
  }

  const scaffolder = new ResearchScaffolder();
  const result = await scaffolder.scaffold(args.initiative, {
    methodology: args.methodology
  });

  return `Scaffolded research initiative at ${result.directory}`;
}

/**
 * commander definition for 'gwrk define research'
 */
export const researchCommand = new Command("research")
  .description("Scaffold research directories and briefs (R0XX)")
  .argument("<initiative>", "Research initiative name")
  .option("--methodology <type>", "Research methodology (technical, jtbd, etc.)", "technical")
  .action(async (initiative: string, opts: { methodology: string }) => {
    try {
      const output = await researchCommandHandler({
        initiative,
        methodology: opts.methodology
      });
      console.log(output);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });
