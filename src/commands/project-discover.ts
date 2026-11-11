/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { Command } from "commander";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import { discoverProject } from "../engine/discover.js";
import { withSignal } from "../utils/signal.js";

/**
 * FR-004: `gwrk project discover`
 * Assembles full project state from repository contents.
 * Primary agent-native surface: `gwrk project discover --format json`
 */
export const createProjectDiscoverCommand = () =>
  new Command("discover")
    .description("Discover project structure, specs, gates, and config")
    .option("--format <type>", "Output format (text, json)", "text")
    .action(async (options) => {
      await withSignal("project discover", async () => {
        const result = await discoverProject(process.cwd());

        if (options.format === "json") {
          writeScopedStdout(`${JSON.stringify(result, null, 2)}\n`);
          return;
        }

        // Text output
        writeScopedStdout(`Project: ${result.project.name}\n`);
        writeScopedStdout(`Root: ${result.project.root}\n`);
        writeScopedStdout(
          `Git: ${result.project.git.branch} (${result.project.git.clean ? "clean" : "dirty"}) — ${result.project.git.lastCommit}\n`,
        );
        writeScopedStdout("\n");

        writeScopedStdout(`Specs (${result.specs.length}):\n`);
        for (const s of result.specs) {
          const tasks = s.hasTasks
            ? ` [${s.tasksComplete}/${s.tasksComplete + s.tasksOpen} tasks]`
            : "";
          writeScopedStdout(`  ${s.id} ${s.name} — ${s.status}${tasks}\n`);
        }
        writeScopedStdout("\n");

        writeScopedStdout(`Gates: ${result.gates.total} total\n`);
        writeScopedStdout(
          `Config: slack=${result.config.hasSlack} server=${result.config.hasServer}\n`,
        );
        if (result.config.agents.length > 0) {
          writeScopedStdout(`Agents: ${result.config.agents.join(", ")}\n`);
        }
      });
    });

export const projectDiscoverCommand = createProjectDiscoverCommand();
