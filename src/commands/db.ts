/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { basename, dirname, join, resolve } from "node:path";
import { Command, Option } from "commander";
import { gwrkRuntimeDir, usesHostedRuntime } from "../adapters/config/paths.js";
import { verifyInstalledRelease } from "../adapters/release/inventory.js";
import { readRepositoryEvidence } from "../adapters/release/repository-evidence.js";
import { acquireInstanceLock, acquireLedgerLock } from "../adapters/server/instance-lock.js";
import {
  createLedgerBackup,
  readAppliedMigrations,
  restoreLedgerBackup,
  verifyLedgerAgainstBackup,
  verifyLedgerBackup,
} from "../adapters/sqlite/ledger-backup.js";
import { restoreOfflineLedger } from "../application/release/backup-restore.js";
import { getDbPath } from "../db/index.js";
import { recordRun } from "../db/runs.js";
import { evaluateRollbackCompatibility } from "../domain/release-packaging.js";
import { loadDevice } from "../utils/device.js";
import { success } from "../utils/format.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { runsCommand } from "./runs.js";
import { statsCommand } from "./stats.js";

import { CommandError, withSignal } from "../utils/signal.js";

export const recordCommand = new Command("record")
  .description("Record a run in the execution ledger")
  .requiredOption("-f, --feature <id>", "Feature ID")
  .option("-p, --phase <id>", "Phase ID")
  .requiredOption("-c, --command <name>", "Command name")
  .option("-w, --workflow <name>", "Workflow name")
  .option("-a, --agent <name>", "Agent backend")
  .option("-x, --exit-code <n>", "Exit code", "0")
  .option("-d, --duration <n>", "Duration in seconds", "0")
  .option("-v, --verdict <v>", "Review verdict (GO/NO-GO)")
  .option("-g, --gate <g>", "Gate result (PASS/FAIL)")
  .option("-l, --log <path>", "Path to log file")
  .action(async (opts) => {
    await withSignal("record", async () => {
      const runId = recordRun({
        feature_id: opts.feature,
        phase_id: opts.phase,
        command: opts.command,
        workflow: opts.workflow,
        agent_backend: opts.agent,
        exit_code: Number(opts.exitCode),
        duration_s: Number(opts.duration),
        review_verdict: opts.verdict,
        gate_result: opts.gate,
        log_file: opts.log,
      });
      success("record", Number(opts.duration), runId);
    });
  });

const backupPort = {
  createBackup: createLedgerBackup,
  verifyBackup: verifyLedgerBackup,
  restoreBackup: restoreLedgerBackup,
};

function ledgerOutput(command: Command) {
  const format = command.opts<{ format?: string }>().format;
  return format ? createOutput(format) : resolveFormat(command);
}

const backupCommand = new Command("backup")
  .description(
    "Create and verify an online execution ledger backup (generator)",
  )
  .addOption(
    new Option("--format <type>", "Output format (json)").choices(["json"]),
  )
  .allowExcessArguments(false)
  .requiredOption("--out <dir>", "New backup directory")
  .option(
    "--project-root <dir>",
    "Include repository evidence for this enrolled checkout",
  )
  .action(
    async (opts: { out: string; projectRoot?: string }, command: Command) => {
      await withSignal("db backup", async () => {
        const output = ledgerOutput(command);
        const projectRoot = opts.projectRoot && resolve(opts.projectRoot);
        const destination = resolve(opts.out);
        const manifest = await backupPort.createBackup({
          dbPath: getDbPath(),
          destination,
          createdAt: new Date().toISOString(),
          gwrkVersion: command.parent?.parent?.version() ?? "unknown",
          metadata: { device: loadDevice() },
          collectRepositories(projects) {
            const selected = projectRoot
              ? projects.filter(({ path }) => resolve(path) === projectRoot)
              : projects;
            if (projectRoot && selected.length === 0) {
              throw new CommandError(
                "Project root is not enrolled in this ledger. Run 'gwrk init' in that checkout.",
                1,
              );
            }
            return selected.map(({ id, path }) =>
              readRepositoryEvidence(id, path),
            );
          },
        });
        output.write(
          output.isJson
            ? { destination, manifest }
            : `Verified ledger backup at ${destination}\n`,
        );
      });
    },
  );

const restoreCommand = new Command("restore")
  .description("Verify a backup and restore an offline Linux ledger (mutator)")
  .addOption(
    new Option("--format <type>", "Output format (json)").choices(["json"]),
  )
  .allowExcessArguments(false)
  .requiredOption("--from <dir>", "Verified backup directory")
  .requiredOption("--state-dir <dir>", "Target state directory")
  .option("--force", "Replace existing ledger and device files", false)
  .action(
    async (
      opts: { from: string; stateDir: string; force: boolean },
      command: Command,
    ) => {
      await withSignal("db restore", async () => {
        const output = ledgerOutput(command);
        if (!usesHostedRuntime()) {
          throw new CommandError(
            "Set GWRK_RUNTIME_DIR to the Linux server's runtime directory before restoring.",
            1,
          );
        }
        const stateDirectory = resolve(opts.stateDir);
        const dbPath = getDbPath();
        if (
          opts.force &&
          (stateDirectory !== resolve(dirname(dbPath)) ||
            basename(dbPath) !== "gwrk.db")
        ) {
          throw new CommandError(
            "Point GWRK_HOME or GWRK_DIR at the target state directory before using --force.",
            1,
          );
        }
        const runtimeDirectory = gwrkRuntimeDir();
        const restored = await restoreOfflineLedger(
          backupPort,
          {
            acquireInstanceLock,
            acquireLedgerLock,
          },
          {
            source: resolve(opts.from),
            stateDirectory,
            runtimeDirectory,
            dbPath: join(stateDirectory, "gwrk.db"),
            force: opts.force,
            pid: process.pid,
          },
        );
        output.write(
          output.isJson
            ? { stateDirectory, manifest: restored.manifest }
            : `Restored ledger at ${stateDirectory}\n`,
        );
      });
    },
  );

const rollbackCheckCommand = new Command("rollback-check")
  .description("Verify installed releases against the ledger migration history")
  .option("--format <type>", "Output format (json)")
  .addOption(new Option("--require-ledger-digests").hideHelp())
  .requiredOption("--current <dir>", "Current release directory")
  .requiredOption("--target <dir>", "Target release directory")
  .option(
    "--against <dir>",
    "Verify persisted work against a pre-rollback backup",
  )
  .action(
    async (
      opts: { current: string; target: string; against?: string },
      command: Command,
    ) => {
      await withSignal("db rollback-check", async () => {
        const output = ledgerOutput(command);
        const [, target] = await Promise.all([
          verifyInstalledRelease(resolve(opts.current)),
          verifyInstalledRelease(resolve(opts.target)),
        ]);
        const migrations = readAppliedMigrations(getDbPath());
        const appliedDigests = new Map(
          migrations.map(({ name, sha256 }) => [name, sha256]),
        );
        const result = evaluateRollbackCompatibility(
          [...appliedDigests.keys()],
          { migrations },
          target,
        );
        if (!result.allowed) {
          const targetNames = new Set(
            target.migrations.map(({ name }) => name),
          );
          const reasons = result.blockingMigrations.map((name) => {
            if (!appliedDigests.has(name))
              return `Unapplied target migration: ${name}`;
            if (!appliedDigests.get(name))
              return `Unknown applied migration digest: ${name}`;
            if (!targetNames.has(name))
              return `Target is missing applied migration: ${name}`;
            return `Mismatched applied migration digest: ${name}`;
          });
          throw new CommandError(
            `Rollback blocked by migrations: ${reasons.join(". ")}.`,
            1,
          );
        }
        if (opts.against) {
          await verifyLedgerAgainstBackup(getDbPath(), resolve(opts.against));
        }
        output.write(
          output.isJson
            ? result
            : `Ledger is compatible with gwrk ${result.targetVersion}\n`,
        );
      });
    },
  );

export const dbCommand = new Command("db")
  .description("Query and maintain the local execution ledger")
  .addHelpText(
    "after",
    `
Examples:
  gwrk db runs
  gwrk db runs 001
  gwrk db stats
`,
  )
  .addCommand(backupCommand)
  .addCommand(restoreCommand)
  .addCommand(rollbackCheckCommand)
  .addCommand(runsCommand)
  .addCommand(statsCommand)
  .addCommand(recordCommand, { hidden: true });
