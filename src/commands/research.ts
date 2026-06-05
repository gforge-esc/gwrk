import { ResearchScaffolder } from "../engine/research-scaffold.js";
import { Command } from "commander";
import { success, info, startTimer, stopTimer } from "../utils/format.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";

/**
 * FR-R006-001: Command handler for 'gwrk define research <initiative>'
 * FR-R006-002: Methodology dispatch with --run
 */

export interface ResearchArgs {
  initiative: string;
  methodology?: string;
  run?: boolean;
}

export async function researchCommandHandler(args: ResearchArgs): Promise<string> {
  if (!args.initiative) {
    throw new Error("Initiative name is required");
  }

  const startTime = Date.now();
  const scaffolder = new ResearchScaffolder();
  const result = await scaffolder.scaffold(args.initiative, {
    methodology: args.methodology
  });

  let output = `Scaffolded research initiative at ${result.directory}`;

  if (args.run) {
    const timer = startTimer();
    try {
      const methodology = args.methodology || "technical";
      const workflowName = `gwrk-research-${methodology}`;
      console.log(info(`Executing methodology workflow: ${workflowName}...`));

      const runtime = new WorkflowRuntime();
      const workflowResult = await runtime.executeWorkflow(
        workflowName,
        `Execute research for initiative: ${args.initiative}\nDirectory: ${result.directory}\nMethodology: ${methodology}`
      );

      const durationS = Math.round((Date.now() - startTime) / 1000);
      stopTimer(timer);
      
      // Use success() which prints its own box to console
      success(workflowName, durationS, undefined, workflowResult.logPath);
      output += `\nSummary: ${workflowResult.summary}`;
    } catch (error) {
      stopTimer(timer);
      throw error;
    }
  }

  return output;
}

/**
 * commander definition for 'gwrk define research'
 */
export const researchCommand = new Command("research")
  .description("Scaffold research directories and briefs (R0XX)")
  .argument("<initiative>", "Research initiative name")
  .option("--methodology <type>", "Research methodology: technical, jtbd, ontology", "technical")
  .option("--run", "Execute the methodology plugin immediately after scaffolding")
  .action(async (initiative: string, opts: { methodology: string, run?: boolean }) => {
    try {
      const output = await researchCommandHandler({
        initiative,
        methodology: opts.methodology,
        run: opts.run
      });
      console.log(output);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });
