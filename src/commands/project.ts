import { Command } from "commander";
import { discoverProject } from "../engine/discover.js";
import { type CommandMeta, applyMeta } from "../utils/help.js";
import { resolveFormat } from "../utils/output.js";
import { withSignal } from "../utils/signal.js";

export const projectCommand = new Command("project").description(
  "Query project state",
);

applyMeta(projectCommand, {
  type: "query",
  supportsJson: true,
  exitCodes: {
    0: "Success",
    1: "Not a gwrk project or git missing",
    2: "Usage error",
  },
});

const discoverCmd = projectCommand
  .command("discover")
  .description("Return structured summary of project state")
  .action(async (options, command) => {
    await withSignal("project discover", async () => {
      const out = resolveFormat(command);

      const discovery = await discoverProject(process.cwd());

      if (out.isJson) {
        out.write(discovery);
      } else {
        out.write(`Project: ${discovery.project.name}\n`);
        out.write(`Root: ${discovery.project.root}\n`);
        out.write(
          `Git: branch=${discovery.project.git.branch}, clean=${discovery.project.git.clean}, last=${discovery.project.git.lastCommit}\n\n`,
        );

        out.write("\nSpecs:\n");
        for (const spec of discovery.specs) {
          out.write(
            `- ${spec.id}: ${spec.name} [${spec.status}] (${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen} tasks)\n`,
          );
        }

        out.write(
          `\nGates: ${discovery.gates.total} total, ${discovery.gates.passing} passing, ${discovery.gates.failing} failing\n`,
        );
      }
    });
  });

applyMeta(discoverCmd, {
  type: "query",
  supportsJson: true,
  outputs: "ProjectDiscovery (DM-001)",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});

const specsCmd = projectCommand
  .command("specs")
  .description("List all specifications with status")
  .action(async (options, command) => {
    await withSignal("project specs", async () => {
      const out = resolveFormat(command);

      const discovery = await discoverProject(process.cwd());

      if (out.isJson) {
        out.write(discovery.specs);
      } else {
        out.write("ID   | Status   | Tasks | Name\n");
        out.write("-----|----------|-------|-----\n");
        for (const spec of discovery.specs) {
          const tasks = `${spec.tasksComplete}/${spec.tasksComplete + spec.tasksOpen}`;
          out.write(
            `${spec.id.padEnd(4)} | ${spec.status.padEnd(8)} | ${tasks.padEnd(5)} | ${spec.name}\n`,
          );
        }
      }
    });
  });

applyMeta(specsCmd, {
  type: "query",
  supportsJson: true,
  outputs: "SpecSummary[]",
  exitCodes: {
    0: "Success",
    1: "Error",
  },
});

