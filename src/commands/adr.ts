/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import {
  allocateNumber,
  findProjectRoot,
  renderTemplate,
  resolveDecisionsDir,
  scaffold,
} from "../engine/adr-scaffold.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { loadConfig } from "../utils/config.js";
import { resolveModelForTask } from "../utils/resolve-model.js";
import { CommandError, withSignal } from "../utils/signal.js";

/**
 * 029 Decision Records — `gwrk define adr` (FR-001, FR-008).
 *
 * Contract: `specs/029-decision-records/contracts/adr-command.md` §1-2.
 *
 * Handler-level per `research.ts`: the handler returns the string the action
 * logs, so `console.log` stays in the action and the handler stays unit-testable
 * (TR-003).
 *
 * The action wraps its work in `withSignal` so the `[exit:N | Xs]` line reaches
 * stderr (ADR-004). D12 records that `define research` omits this; FR-001
 * forbids copying that omission.
 *
 * Neither `--refs` nor `--dry-run` is declared (TC-013, FR-008). `--refs` is
 * meaningless for a record authored from a title, and the dry-run affordance is
 * `--print`, so the discovered-collision baseline in
 * `cli.option-collisions.test.ts` stays at nine with no allowlist entry.
 */

export interface AdrArgs {
  /** The record's title. Absent for `--print`. */
  target?: string;
  /** Print the template to stdout and write nothing. */
  print?: boolean;
  /** Draft the scaffolded record with the `gwrk-adr-record` workflow. */
  run?: boolean;
  /** Where the project-root walk starts. Defaults to the working directory. */
  cwd?: string;
}

/** Stands in for the title in a `--print` dump, which names no record. */
const TITLE_PLACEHOLDER = "<title>";

/** The one workflow this feature adds. Dispatched only under `--run` (SC-010). */
const RECORD_WORKFLOW = "gwrk-adr-record";

export async function adrCommandHandler(args: AdrArgs): Promise<string> {
  const cwd = args.cwd ?? process.cwd();

  // `--print` is a query (contract §2): the template to stdout, nothing
  // written. It still resolves the project so the number it prints is the
  // number the next write would take, rather than a fiction.
  if (args.print) {
    const projectRoot = await findProjectRoot(cwd);
    const decisionsDir = await resolveDecisionsDir(projectRoot);
    const number = await allocateNumber(decisionsDir);

    return renderTemplate({
      number,
      title: args.target?.trim() || TITLE_PLACEHOLDER,
      date: new Date().toISOString().slice(0, 10),
    });
  }

  const result = await scaffold(args.target ?? "", { cwd });

  // Without `--run` the record stands as scaffolded and no runtime is
  // constructed (contract §3).
  if (!args.run) {
    return result.filePath;
  }

  const title = (args.target ?? "").trim();
  return `${result.filePath}\n${await draftRecord(result, title, cwd)}`;
}

/**
 * Dispatches `gwrk-adr-record` for a record that has already been scaffolded
 * (FR-007, contract §3). Returns the workflow's summary line.
 *
 * All dispatch goes through `WorkflowRuntime.executeWorkflow`, never a raw
 * spawn (ADR-007).
 */
async function draftRecord(
  result: { filePath: string; id: string },
  title: string,
  cwd: string,
): Promise<string> {
  // The backend is resolved from config, not defaulted here (ADR-006). Checked
  // before the runtime is constructed so a missing backend costs no dispatch.
  const config = loadConfig(cwd);
  const backend = config.agents?.define;
  if (!backend) {
    throw new CommandError(
      "No agent backend available. Run: gwrk plugin list agents",
    );
  }
  const model = resolveModelForTask("define", backend, cwd);

  const projectRoot = await findProjectRoot(cwd);

  // No substitution engine exists (TC-008), so the record's identity arrives as
  // appended text. `research.ts` appends `<research_context>` the same way.
  const workflowInput = [
    `Draft the architecture decision record titled "${title}".`,
    ``,
    `<decision_context>`,
    `Title: ${title}`,
    `Id: ${result.id}`,
    `Record: ${result.filePath}`,
    `</decision_context>`,
  ].join("\n");

  // `projectRoot` is passed deliberately. `define research --run` omits it and
  // so falls back to a default PluginLoader with no projectDir, which makes
  // project-local workflow overrides invisible.
  const runtime = new WorkflowRuntime();
  let workflowResult;
  try {
    workflowResult = await runtime.executeWorkflow(
      RECORD_WORKFLOW,
      workflowInput,
      { agent: backend, model, projectRoot },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    // The builtin ships through the build, so an unresolvable workflow means
    // `dist/` is stale rather than that the name is wrong (TC-012).
    if (/not found/i.test(message)) {
      throw new CommandError(
        `Workflow not found: ${RECORD_WORKFLOW}. Run: npm run build`,
      );
    }
    throw error;
  }

  if (
    typeof workflowResult?.summary !== "string" ||
    !Array.isArray(workflowResult.intents)
  ) {
    throw new CommandError(
      `${RECORD_WORKFLOW} returned no valid {summary, intents}`,
    );
  }

  return workflowResult.summary;
}

/**
 * commander definition for `gwrk define adr`.
 */
export const adrCommand = new Command("adr")
  // The `Examples:` block lives in the description, not in an
  // `addHelpText("after", …)` hook as `research.ts` uses, because TR-009 reads
  // it back through `helpInformation()` — and Commander renders after-hooks in
  // `outputHelp()` only, so a hook is invisible there. `summary()` keeps the
  // parent `define --help` subcommand list to one line.
  .summary("Author an architecture decision record (ADR-NNN)")
  .description(`Author an architecture decision record (ADR-NNN)

The number is allocated max+1 over docs/decisions/, and the command works from
any subdirectory of the project. Records are written with Status: Proposed for
a human to ratify.

Examples:

  Record a decision the corpus numbers for you:
    gwrk define adr "Decision Records"

  Preview the template without writing anything:
    gwrk define adr --print

  Scaffold the record and draft it with an agent:
    gwrk define adr "Decision Records" --run
`)
  .argument("[title]", "Title of the decision (e.g. 'Decision Records')")
  .option("--print", "Print the template to stdout without writing a record")
  .option("--run", "Draft the scaffolded record with the gwrk-adr-record workflow")
  .action(async (title: string | undefined, opts: { print?: boolean; run?: boolean }) => {
    await withSignal("define adr", async () => {
      const output = await adrCommandHandler({
        target: title,
        print: opts.print,
        run: opts.run,
      });
      console.log(output);
    });
  });
