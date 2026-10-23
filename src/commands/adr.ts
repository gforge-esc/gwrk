/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import { Command } from "commander";
import { amendAtSection, appendSection, decide } from "../engine/adr-amend.js";
import { checkCitations } from "../engine/adr-check.js";
import { checkIndex, writeIndex } from "../engine/adr-index.js";
import { type AdrRecord, parseCorpus } from "../engine/adr-parser.js";
import {
  allocateNumber,
  findProjectRoot,
  renderTemplate,
  resolveDecisionsDir,
  scaffold,
  todayLocal,
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
  /** A title ("Decision Records") or an ADR-NNN id. Absent for --reindex / --check / --audit. */
  target?: string;
  /** Print the template to stdout and write nothing. */
  print?: boolean;
  /** Draft the scaffolded record with the `gwrk-adr-record` workflow. */
  run?: boolean;
  /** Regenerate `.gwrk/decisions/index.md` from `docs/decisions/`. */
  reindex?: boolean;
  /** Verify the index or citations against `docs/decisions/`. */
  check?: boolean;
  /** Amend an existing record in place. */
  amend?: boolean;
  /** Dotted section address for `--amend`. */
  at?: string;
  /** Append a new top-level section numbered max+1 before `## Amendments`. */
  appendSection?: boolean;
  /** Flip a `Proposed` record to `Decided` and stamp today's date. */
  decide?: boolean;
  /** Audit the corpus with `gwrk-constitution`. */
  audit?: boolean;
  /** Optional agent override for dispatching modes. */
  agent?: string;
  /** Optional model override for dispatching modes. */
  model?: string;
  /** Output format for verifier invocations (`text` or `json`). */
  format?: "text" | "json";
  /** Amending feature or record id for `--amend` / `--append-section`. */
  amendingId?: string;
  /** Title for an appended section under `--append-section`. */
  title?: string;
  /** Body text for `--amend` or `--append-section`. */
  body?: string;
  /** Where the project-root walk starts. Defaults to the working directory. */
  cwd?: string;
}

/** Stands in for the title in a `--print` dump, which names no record. */
const TITLE_PLACEHOLDER = "<title>";

/** The one workflow this feature adds. Dispatched only under `--run` (SC-010). */
const RECORD_WORKFLOW = "gwrk-adr-record";

/** Shipped builtin workflow wired behind `--audit` (FR-027). */
const AUDIT_WORKFLOW = "gwrk-constitution";

async function reindexProject(cwd: string): Promise<string> {
  const projectRoot = await findProjectRoot(cwd);
  const decisionsDir = await resolveDecisionsDir(projectRoot);
  const records = await parseCorpus(decisionsDir);
  return writeIndex(projectRoot, records);
}

function normalizeAdrId(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{3}$/.test(trimmed)) return `ADR-${trimmed}`;
  if (/^adr-\d{3}$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

async function resolveTargetRecord(
  cwd: string,
  target: string | undefined,
): Promise<{ projectRoot: string; decisionsDir: string; record: AdrRecord }> {
  const projectRoot = await findProjectRoot(cwd);
  const decisionsDir = await resolveDecisionsDir(projectRoot);
  const records = await parseCorpus(decisionsDir);
  const id = normalizeAdrId(target ?? "");
  const record = records.find(
    (entry) => entry.id === id || entry.number === (target ?? "").trim(),
  );
  if (!record) {
    throw new CommandError(`${id || "ADR"} not found in docs/decisions/`, 1);
  }
  return { projectRoot, decisionsDir, record };
}

export async function adrCommandHandler(args: AdrArgs): Promise<string> {
  const cwd = args.cwd ?? process.cwd();

  if (args.reindex && args.check) {
    const projectRoot = await findProjectRoot(cwd);
    const decisionsDir = await resolveDecisionsDir(projectRoot);
    const records = await parseCorpus(decisionsDir);
    const check = await checkIndex(projectRoot, records);
    if (!check.ok) {
      if (args.format === "json") {
        throw new CommandError(
          JSON.stringify({
            ok: false,
            findings: [
              {
                file: ".gwrk/decisions/index.md",
                line: 1,
                assertion: 3,
                message: check.message ?? "Decision index is stale.",
              },
            ],
          }),
          1,
        );
      }
      throw new CommandError(
        check.message ??
          "Decision index is stale. Run: gwrk define adr --reindex",
        1,
      );
    }
    if (args.format === "json") {
      return JSON.stringify({ ok: true, findings: [] });
    }
    return "Decision index is up to date.";
  }

  if (args.reindex) {
    return reindexProject(cwd);
  }

  if (args.audit) {
    return auditCorpus(cwd, args);
  }

  if (args.check) {
    const projectRoot = await findProjectRoot(cwd);
    const decisionsDir = await resolveDecisionsDir(projectRoot);
    const records = await parseCorpus(decisionsDir);
    const findings = await checkCitations(projectRoot, records);
    if (findings.length > 0) {
      if (args.format === "json") {
        throw new CommandError(JSON.stringify({ ok: false, findings }), 1);
      }
      const lines = findings.map((f) =>
        f.assertion === 3 ? f.message : `${f.file}:${f.line}: ${f.message}`,
      );
      throw new CommandError(lines.join("\n"), 1);
    }
    if (args.format === "json") {
      return JSON.stringify({ ok: true, findings: [] });
    }
    return "All ADR citations and decision index verified.";
  }

  if (args.decide) {
    const { record } = await resolveTargetRecord(cwd, args.target);
    let result: ReturnType<typeof decide>;
    try {
      result = decide(record, todayLocal());
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CommandError(message, 1);
    }
    await fs.writeFile(result.filePath, result.content, "utf-8");
    await reindexProject(cwd);
    return result.filePath;
  }

  if (args.amend || args.appendSection) {
    if (args.amend && !args.at && !args.appendSection) {
      throw new CommandError(
        "--amend requires --at <section> or --append-section",
        1,
      );
    }
    const { record } = await resolveTargetRecord(cwd, args.target);
    let result: ReturnType<typeof amendAtSection>;
    try {
      if (args.appendSection) {
        result = appendSection(record, {
          amendingId: args.amendingId ?? "amend",
          title: args.title ?? "Amendment",
          body: args.body ?? "",
        });
      } else {
        result = amendAtSection(record, args.at ?? "", {
          amendingId: args.amendingId ?? "amend",
          body: args.body ?? "",
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CommandError(message, 1);
    }
    await fs.writeFile(result.filePath, result.content, "utf-8");
    await reindexProject(cwd);
    return result.filePath;
  }

  // `--print` is a query (contract §2): the template to stdout, nothing
  // written. It still resolves the project so the number it prints is the
  // number the next write would take, rather than a fiction. The date comes
  // from the same `todayLocal` the write path uses, for the same reason: a
  // preview that disagrees with the next write is a fiction too (AMBER-5).
  if (args.print) {
    const projectRoot = await findProjectRoot(cwd);
    const decisionsDir = await resolveDecisionsDir(projectRoot);
    const number = await allocateNumber(decisionsDir);

    return renderTemplate({
      number,
      title: args.target?.trim() || TITLE_PLACEHOLDER,
      date: todayLocal(),
    });
  }

  const result = await scaffold(args.target ?? "", { cwd });
  await reindexProject(cwd);

  // Without `--run` the record stands as scaffolded and no runtime is
  // constructed (contract §3).
  if (!args.run) {
    return result.filePath;
  }

  const title = (args.target ?? "").trim();
  const summary = await draftRecord(result, title, cwd);
  await reindexProject(cwd);
  return `${result.filePath}\n${summary}`;
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
  // The root walk comes first. `loadConfig` joins its argument with
  // `.gwrkrc.json` and never walks parents, so handing it `cwd` would break
  // `--run` from every subdirectory (FR-002, US-001 AC-3, SC-001). The walk
  // also owns the not-a-project error, which must precede any config read.
  const projectRoot = await findProjectRoot(cwd);

  // The backend is resolved from config, not defaulted here (ADR-006). Checked
  // before the runtime is constructed so a missing backend costs no dispatch.
  const config = loadConfig(projectRoot);
  const agents = config.agents;
  const backend = agents?.define;

  // The guard tests the registry, not the name. `agents.define` carries
  // `.default("agy")` in the schema, so a config with no `agents` block still
  // parses to a backend name and a name-only guard never fires. What dispatch
  // needs is a registry entry `loadRegistry` can resolve. Without one,
  // `resolveModelForTask` below reaches `loadRegistry`, which reports the
  // problem with `process.exit(1)`. That is past every catch, and past the
  // `[exit:N | Xs]` line FR-001 mandates (contract §3).
  if (!backend || !agents?.registry?.[backend] || !agents.fallbackOrder) {
    throw new CommandError(
      "No agent backend available. Run: gwrk plugin list agents",
    );
  }
  // Same root, same reason: `resolveModelForTask` swallows its registry read
  // error, so a subdirectory would silently drop a project-local model.
  const model = resolveModelForTask("define", backend, projectRoot);

  // No substitution engine exists (TC-008), so the record's identity arrives as
  // appended text. `research.ts` appends `<research_context>` the same way.
  const workflowInput = [
    `Draft the architecture decision record titled "${title}".`,
    "",
    "<decision_context>",
    `Title: ${title}`,
    `Id: ${result.id}`,
    `Record: ${result.filePath}`,
    "</decision_context>",
  ].join("\n");

  // `projectRoot` is passed deliberately. `define research --run` omits it and
  // so falls back to a default PluginLoader with no projectDir, which makes
  // project-local workflow overrides invisible.
  const runtime = new WorkflowRuntime();
  let workflowResult: Awaited<ReturnType<WorkflowRuntime["executeWorkflow"]>>;
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
 * Dispatches `gwrk-constitution` for `--audit` with an appended
 * `<decision_context>` block naming `docs/decisions/` and `.gwrk/decisions/index.md`
 * (FR-027, contract §3).
 */
async function auditCorpus(cwd: string, args: AdrArgs): Promise<string> {
  const projectRoot = await findProjectRoot(cwd);
  const decisionsDir = await resolveDecisionsDir(projectRoot);

  const config = loadConfig(projectRoot);
  const agents = config.agents;
  const backend = args.agent ?? agents?.define;

  if (!backend || !agents?.registry?.[backend] || !agents.fallbackOrder) {
    throw new CommandError(
      "No agent backend available. Run: gwrk plugin list agents",
    );
  }
  const model =
    args.model ?? resolveModelForTask("define", backend, projectRoot);

  const workflowInput = [
    "Audit the architecture decision corpus against the codebase.",
    "",
    "<decision_context>",
    `Corpus: ${decisionsDir} (docs/decisions/)`,
    "Index: .gwrk/decisions/index.md",
    "</decision_context>",
  ].join("\n");

  const runtime = new WorkflowRuntime();
  let workflowResult: Awaited<ReturnType<WorkflowRuntime["executeWorkflow"]>>;
  try {
    workflowResult = await runtime.executeWorkflow(
      AUDIT_WORKFLOW,
      workflowInput,
      { agent: backend, model, projectRoot },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not found/i.test(message)) {
      throw new CommandError(
        `Workflow not found: ${AUDIT_WORKFLOW}. Run: npm run build`,
      );
    }
    throw error;
  }

  if (
    typeof workflowResult?.summary !== "string" ||
    !Array.isArray(workflowResult.intents)
  ) {
    throw new CommandError(
      `${AUDIT_WORKFLOW} returned no valid {summary, intents}`,
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
  .option(
    "--run",
    "Draft the scaffolded record with the gwrk-adr-record workflow",
  )
  .option(
    "--reindex",
    "Regenerate .gwrk/decisions/index.md from docs/decisions/",
  )
  .option("--check", "Verify the decision index and corpus citations")
  .option("--amend", "Amend an existing architecture decision record")
  .option("--at <section>", "Dotted section address for --amend (e.g. '2.1')")
  .option(
    "--append-section",
    "Append a new numbered top-level section before ## Amendments",
  )
  .option("--decide", "Flip a Proposed record to Decided and stamp the date")
  .option(
    "--audit",
    "Audit the decision corpus with the gwrk-constitution workflow",
  )
  .option(
    "--format <format>",
    "Output format for verifier invocations (text or json)",
  )
  .action(
    async (
      title: string | undefined,
      opts: {
        print?: boolean;
        run?: boolean;
        reindex?: boolean;
        check?: boolean;
        amend?: boolean;
        at?: string;
        appendSection?: boolean;
        decide?: boolean;
        audit?: boolean;
        format?: "text" | "json";
      },
    ) => {
      await withSignal("define adr", async () => {
        const output = await adrCommandHandler({
          target: title,
          print: opts.print,
          run: opts.run,
          reindex: opts.reindex,
          check: opts.check,
          amend: opts.amend,
          at: opts.at,
          appendSection: opts.appendSection,
          decide: opts.decide,
          audit: opts.audit,
          format: opts.format,
        });
        console.log(output);
      });
    },
  );
