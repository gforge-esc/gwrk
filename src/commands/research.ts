/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import path from "node:path";
import * as fsSync from "node:fs";
import * as fsPromises from "node:fs/promises";
import { ResearchScaffolder } from "../engine/research-scaffold.js";
import { Command } from "commander";
import { success, info, startTimer, stopTimer } from "../utils/format.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { resolveModelForTask } from "../utils/resolve-model.js";

/**
 * FR-R006-001: Command handler for 'gwrk define research <initiative>'
 * FR-R006-002: Methodology dispatch with --run
 */

export interface ResearchArgs {
  initiative: string;
  methodology?: string;
  run?: boolean;
  refs?: string;
}

/**
 * Detect whether the initiative argument is an R0XX prefix
 * (e.g., "R011") or a name (e.g., "obsidian-vault").
 */
function isPrefix(initiative: string): boolean {
  return /^R\d{3}$/i.test(initiative);
}

/**
 * Extract the `methodology` field from a brief.md YAML frontmatter block.
 * Lets `--run R0XX` honor the methodology the brief was scaffolded with
 * instead of silently defaulting to "technical".
 */
function methodologyFromBrief(briefContent: string): string | undefined {
  const fm = briefContent.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) return undefined;
  const line = fm[1].match(/^methodology:\s*(.+)$/m);
  return line ? line[1].trim() : undefined;
}

export async function researchCommandHandler(args: ResearchArgs): Promise<string> {
  if (!args.initiative) {
    throw new Error("Initiative name is required");
  }

  const startTime = Date.now();
  const scaffolder = new ResearchScaffolder();

  // Resolve the research directory:
  // - If R0XX prefix → find existing dir (don't scaffold)
  // - If name → scaffold (idempotent — returns existing if slug matches)
  let result;
  if (isPrefix(args.initiative)) {
    result = await scaffolder.resolveByPrefix(args.initiative);
  } else {
    result = await scaffolder.scaffold(args.initiative, {
      methodology: args.methodology,
    });
  }

  let output = `Scaffolded research initiative at ${result.directory}`;

  if (args.run) {
    const timer = startTimer();
    try {
      // Read the brief.md content to pass to the workflow
      const briefPath = path.resolve(result.directory, "brief.md");
      const briefContent = await fsPromises.readFile(briefPath, "utf-8");

      // Determine methodology: explicit flag > brief frontmatter > default.
      const methodology =
        args.methodology || methodologyFromBrief(briefContent) || "technical";
      const workflowName = `gwrk-research-${methodology}`;

      // Resolve the configured agent + model for define-pillar work.
      // Without this the dispatcher falls back to its hardcoded "gemini"
      // default and fails on projects configured for another backend.
      const config = loadConfig(process.cwd());
      const backend = config.agents.define;
      const model = resolveModelForTask("define", backend, process.cwd());

      info(
        `Executing methodology workflow: ${workflowName} (agent: ${backend}${model ? `, model: ${model}` : ""})...`,
      );

      // Build workflow input: refs (if provided) + brief content + directory context
      let workflowInput = briefContent;

      // Inject --refs as authoritative source material (same pattern as specify.ts)
      if (args.refs) {
        const resolvedRefs = path.resolve(args.refs);
        if (!fsSync.existsSync(resolvedRefs)) {
          throw new Error(
            `Reference file not found: ${args.refs}\nResolved to: ${resolvedRefs}`,
          );
        }
        const refsContent = fsSync.readFileSync(resolvedRefs, "utf-8");
        workflowInput = [
          `<reference_document source="${args.refs}" authority="primary">`,
          refsContent,
          `</reference_document>`,
          ``,
          workflowInput,
        ].join("\n");
      }

      // Append directory context so the agent knows where to write draft.md
      workflowInput += `\n\n<research_context>\nDirectory: ${result.directory}\nMethodology: ${methodology}\n</research_context>`;

      const runtime = new WorkflowRuntime();
      const workflowResult = await runtime.executeWorkflow(
        workflowName,
        workflowInput,
        { agent: backend, model },
      );

      const durationS = Math.round((Date.now() - startTime) / 1000);
      stopTimer(timer);

      // Show the log path relative to cwd
      const relLog = path.relative(process.cwd(), workflowResult.logPath || "");
      success(workflowName, durationS, undefined, workflowResult.logPath);

      // Show what files were created (actionable, not prose)
      output = `Research: ${result.directory}\nLog: ${relLog}`;
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
  .addHelpText(
    "after",
    `
Examples:

  Scaffold a new research initiative:
    gwrk define research "polyglot-monorepo"

  Scaffold with a specific methodology:
    gwrk define research "user-onboarding" --methodology jtbd

  Run research on an existing initiative (reads brief.md):
    gwrk define research R011 --run

  Scaffold and immediately run the research workflow:
    gwrk define research "agent-routing" --run

  Run with additional reference material:
    gwrk define research R011 --run --refs docs/research/R011/references/notes.md

  Available methodologies: technical (default), jtbd, ontology
`,
  )
  .argument("<initiative>", "Research initiative name or R0XX prefix (e.g. 'polyglot-monorepo' or 'R011')")
  .option("--methodology <type>", "Research methodology: technical, jtbd, ontology (default: brief frontmatter, else technical)")
  .option("--run", "Execute the methodology plugin (reads brief.md as input)")
  .option("--refs <path>", "Path to additional reference docs")
  .action(async (initiative: string, opts: { methodology: string, run?: boolean, refs?: string }) => {
    try {
      const output = await researchCommandHandler({
        initiative,
        methodology: opts.methodology,
        run: opts.run,
        refs: opts.refs,
      });
      console.log(output);
    } catch (error: any) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  });

