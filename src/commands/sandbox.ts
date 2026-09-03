/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { SandboxManager } from "../server/sandbox.js";
import { loadConfig } from "../utils/config.js";
import { color } from "../utils/format.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";

const { BOLD, DIM, GREEN, YELLOW, RESET } = color;

export const sandboxCommand = new Command("sandbox").description(
  "Inspect and reap worktree sandboxes created by ship",
);

sandboxCommand
  .command("list")
  .description("List recorded sandboxes and whether each is orphaned")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("sandbox list", async () => {
      const records = new SandboxManager(process.cwd()).listRecords();
      const out = options.json ? createOutput("json") : resolveFormat(command);

      if (out.isJson) {
        out.write(records);
        return;
      }

      if (records.length === 0) {
        console.log("No sandboxes recorded.");
        return;
      }

      console.log(`${BOLD}Sandboxes${RESET}\n`);
      for (const r of records) {
        const tag = r.orphaned
          ? `${YELLOW}orphaned${RESET}`
          : `${GREEN}live${RESET}`;
        console.log(`  ${r.id}  ${tag}${DIM}  ${r.createdAt}${RESET}`);
      }
      const orphans = records.filter((r) => r.orphaned).length;
      if (orphans > 0) {
        console.log(
          `\n${DIM}${orphans} orphaned — run 'gwrk sandbox prune' to release them.${RESET}`,
        );
      }
    });
  });

sandboxCommand
  .command("prune")
  .description(
    "Release sandboxes whose worktree is gone, via worktree.teardown",
  )
  .option("--dry-run", "Report what would be pruned without acting")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("sandbox prune", async () => {
      const cwd = process.cwd();
      const config = loadConfig(cwd);
      const teardown = config.worktree?.teardown;
      const out = options.json ? createOutput("json") : resolveFormat(command);

      const result = await new SandboxManager(cwd).pruneOrphans({
        teardown,
        dryRun: !!options.dryRun,
      });

      if (out.isJson) {
        out.write({ ...result, teardown: teardown ?? null });
        return;
      }

      // Without a teardown command gwrk can forget the record but cannot
      // release anything the project started. Say so rather than reporting a
      // clean sweep that freed nothing.
      if (!teardown && (result.pruned.length > 0 || result.failed.length > 0)) {
        console.log(
          `${YELLOW}⚠${RESET} No ${BOLD}worktree.teardown${RESET} configured — records will be dropped, but nothing the project started is released.`,
        );
        console.log(
          `${DIM}  Add it to .gwrkrc.json, e.g. { "worktree": { "teardown": "make worktree:down" } },${RESET}`,
        );
        console.log(
          `${DIM}  and have it target the sandbox via $GWRK_SANDBOX_ID (the worktree is already gone).${RESET}\n`,
        );
      }

      if (options.dryRun) {
        console.log(
          `${BOLD}Would prune ${result.pruned.length}${RESET}${DIM} (keeping ${result.kept.length} live)${RESET}`,
        );
      } else {
        console.log(
          `${GREEN}✓${RESET} pruned ${result.pruned.length}${DIM}, kept ${result.kept.length} live${RESET}`,
        );
      }
      for (const id of result.pruned) console.log(`    ${id}`);
      if (result.failed.length > 0) {
        console.log(
          `${YELLOW}⚠${RESET} ${result.failed.length} teardown(s) failed — records kept for retry:`,
        );
        for (const id of result.failed) console.log(`    ${id}`);
      }
    });
  });
