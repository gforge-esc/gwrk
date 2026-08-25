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
import { withSignal } from "../utils/signal.js";

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
  /** Where the project-root walk starts. Defaults to the working directory. */
  cwd?: string;
}

/** Stands in for the title in a `--print` dump, which names no record. */
const TITLE_PLACEHOLDER = "<title>";

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
  return result.filePath;
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
`)
  .argument("[title]", "Title of the decision (e.g. 'Decision Records')")
  .option("--print", "Print the template to stdout without writing a record")
  .action(async (title: string | undefined, opts: { print?: boolean }) => {
    await withSignal("define adr", async () => {
      const output = await adrCommandHandler({
        target: title,
        print: opts.print,
      });
      console.log(output);
    });
  });
