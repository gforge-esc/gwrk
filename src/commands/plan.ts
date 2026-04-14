import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { PlanStore } from "../engine/plan-store.js";
import { color } from "../utils/format.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";

export const planCommand = new Command("plan")
  .description(
    "Build Plan Orchestrator (DAG) — query and manage the project spine",
  )
  .addHelpText(
    "after",
    `
Subcommands:
  status         View per-phase project status
  next           Show ready work items (all deps satisfied)
  critical       Show the critical path
  waves          Show parallel execution waves
  verify         Detect drift between plan and actual state
  seed           Seed graph from 000-build-plan.md
  init           Bootstrap graph by scanning specs/ directory
  render         Regenerate 000-build-plan.md from graph
  add/remove     Manage features/phases
  dep add/remove Manage dependency edges
  set            Manual status/SP overrides
  viz            Open interactive graph visualization
  review         Review agent proposals
`,
  );

/** Guard against empty graph for subcommands that require data */
function guardEmpty(store: PlanStore) {
  if (store.isEmpty()) {
    const msg = "No build plan data. Run 'gwrk plan seed' or 'gwrk plan init'.";
    console.error(msg);
    throw new CommandError(msg, 1);
  }
}

planCommand
  .command("status")
  .description("View project status from the build plan graph")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("plan status", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      const out = options.json ? createOutput("json") : resolveFormat(command);
      const status = store.getPlanStatus();

      if (out.isJson) {
        out.write(status);
        return;
      }

      const { BOLD, CYAN, GREEN, YELLOW, RED, DIM, RESET } = color;
      console.log(`${BOLD}Build Plan Status${RESET}\n`);

      for (const f of status.features) {
        let statusColor = RESET;
        if (f.status === "DONE") statusColor = GREEN;
        else if (f.status === "SHIPPED") statusColor = GREEN;
        else if (f.status === "IN_PROGRESS") statusColor = YELLOW;
        else if (f.status === "SPECIFIED" || f.status === "DEFINED")
          statusColor = CYAN;

        console.log(
          `${BOLD}${statusColor}${f.id.padEnd(10)}${RESET} ${BOLD}${f.name}${RESET} [${statusColor}${f.status}${RESET}]`,
        );

        for (const p of f.phases) {
          let pColor = DIM;
          if (p.status === "DONE" || p.status === "SHIPPED") pColor = GREEN;
          else if (p.status === "IN_PROGRESS") pColor = YELLOW;

          console.log(
            `  ${pColor}↳ ${p.id.padEnd(12)}${RESET} ${p.name.padEnd(35)} ${pColor}${p.status}${RESET} ${DIM}(${p.sp_estimate} SP)${RESET}`,
          );
        }
        console.log("");
      }
    });
  });

planCommand
  .command("seed")
  .description("Seed the build plan graph from 000-build-plan.md")
  .option("--dry-run", "Show what would be seeded without writing to DB")
  .action(async (options) => {
    await withSignal("plan seed", async () => {
      const projectRoot = process.cwd();
      const planPath = path.join(projectRoot, "specs", "000-build-plan.md");
      const store = new PlanStore();

      if (options.dryRun) {
        const { parsePlan } = await import("../utils/parser-plan.js");
        const payload = parsePlan(planPath);
        console.log("Dry Run: Seed Payload extracted from 000-build-plan.md");
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      store.seedFromFile(planPath);
      console.log(
        "Successfully seeded build plan graph from 000-build-plan.md",
      );
    });
  });

planCommand
  .command("init")
  .description("Initialize the build plan graph by scanning specs/ directory")
  .option("--dry-run", "Show discovered features without writing to DB")
  .action(async (options) => {
    await withSignal("plan init", async () => {
      const projectRoot = process.cwd();
      const specsDir = path.join(projectRoot, "specs");
      const store = new PlanStore();

      if (options.dryRun) {
        const readiness = store.scanReadiness(specsDir);
        console.log("Dry Run: Discovered features from specs/");
        console.log(JSON.stringify(readiness, null, 2));
        return;
      }

      const { added, skipped } = store.initFromSpecs(specsDir);
      console.log(
        `Initialized build plan graph. Added: ${added.length}, Skipped (existing): ${skipped.length}`,
      );
      if (added.length > 0) console.log(`  Added: ${added.join(", ")}`);
    });
  });

// --- Phase 2+ Subcommands (Placeholders with guards) ---

planCommand
  .command("next")
  .description("Show items ready to work on (dependencies satisfied)")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("plan next", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      const solver = await store.getSolver();
      const ready = solver.getReadyQueue();
      const out = options.json ? createOutput("json") : resolveFormat(command);

      if (out.isJson) {
        out.write(ready);
        return;
      }

      if (ready.length === 0) {
        console.log("All build plan items complete.");
        return;
      }

      const { BOLD, GREEN, DIM, RESET } = color;
      console.log(`${BOLD}Ready Work Items${RESET}\n`);
      for (const p of ready) {
        console.log(
          `${BOLD}${GREEN}${p.id.padEnd(12)}${RESET} ${p.name.padEnd(35)} ${DIM}(${p.sp_estimate} SP)${RESET}`,
        );
      }
    });
  });

planCommand
  .command("critical")
  .description("Show the critical path through the build plan")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("plan critical", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      const solver = await store.getSolver();
      const { path, warnings } = solver.getCriticalPath();
      const out = options.json ? createOutput("json") : resolveFormat(command);

      if (out.isJson) {
        out.write({ path, warnings });
        return;
      }

      const { BOLD, RED, YELLOW, RESET, DIM } = color;
      console.log(`${BOLD}Critical Path${RESET}\n`);

      if (warnings.length > 0) {
        for (const w of warnings) {
          console.warn(`${YELLOW}${w}${RESET}`);
        }
        console.log("");
      }

      console.log(
        path
          .map(
            (p) =>
              `${BOLD}${RED}${p.id}${RESET} ${DIM}(${p.sp_estimate} SP)${RESET}`,
          )
          .join(" → "),
      );
    });
  });

planCommand
  .command("waves")
  .description("Show mathematically computed parallel execution waves")
  .option("--json", "Output in JSON format")
  .action(async (options, command) => {
    await withSignal("plan waves", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      const solver = await store.getSolver();
      const waves = solver.getTopologicalWaves();
      const out = options.json ? createOutput("json") : resolveFormat(command);

      if (out.isJson) {
        out.write(waves);
        return;
      }

      const { BOLD, CYAN, RESET, DIM } = color;
      console.log(`${BOLD}Parallel Execution Waves${RESET}\n`);

      waves.forEach((wave, i) => {
        console.log(`${BOLD}${CYAN}Wave ${i + 1}${RESET}`);
        for (const p of wave) {
          console.log(
            `  ${p.id.padEnd(12)} ${p.name.padEnd(35)} ${DIM}(${p.sp_estimate} SP)${RESET}`,
          );
        }
        console.log("");
      });
    });
  });

planCommand
  .command("verify")
  .description("Detect drift between plan and actual state")
  .action(async () => {
    await withSignal("plan verify", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan verify' is not yet implemented (Phase 4).",
        1,
      );
    });
  });

planCommand
  .command("render")
  .description("Regenerate 000-build-plan.md from the graph state")
  .option("--stdout", "Print to stdout instead of writing to file")
  .action(async (options) => {
    await withSignal("plan render", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      const md = store.render();

      if (options.stdout) {
        console.log(md);
        return;
      }

      const projectRoot = process.cwd();
      const planPath = path.join(projectRoot, "specs", "000-build-plan.md");
      fs.writeFileSync(planPath, md, "utf-8");
      console.log(`Successfully regenerated ${planPath} from graph state.`);
    });
  });

planCommand
  .command("add <type> <id> [name]")
  .description("Add a feature or phase to the build plan")
  .action(async () => {
    await withSignal("plan add", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan add' is not yet implemented (Phase 3).",
        1,
      );
    });
  });

planCommand
  .command("remove <id>")
  .description("Remove a feature or phase from the build plan")
  .action(async () => {
    await withSignal("plan remove", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan remove' is not yet implemented (Phase 3).",
        1,
      );
    });
  });

planCommand
  .command("dep <action> <from> <to>")
  .description("Manage dependency edges (add/remove)")
  .action(async () => {
    await withSignal("plan dep", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan dep' is not yet implemented (Phase 3).",
        1,
      );
    });
  });

planCommand
  .command("set <id>")
  .description("Manually override status, SP, or health")
  .option("--status <status>", "Set status")
  .option("--sp <sp>", "Set SP estimate")
  .action(async () => {
    await withSignal("plan set", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan set' is not yet implemented (Phase 3).",
        1,
      );
    });
  });

planCommand
  .command("viz")
  .description("Open interactive graph visualization")
  .option("--dry-run", "Show visualization data without opening browser")
  .action(async () => {
    await withSignal("plan viz", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan viz' is not yet implemented (Phase 5).",
        1,
      );
    });
  });

planCommand
  .command("review")
  .description("Review agent proposals for the build plan")
  .action(async () => {
    await withSignal("plan review", async () => {
      const store = new PlanStore();
      guardEmpty(store);
      throw new CommandError(
        "Command 'gwrk plan review' is not yet implemented (Phase 5).",
        1,
      );
    });
  });
