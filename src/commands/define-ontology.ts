/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import { scaffold } from "../engine/ontology-scaffold.js";
import { scan } from "../engine/source-scanner.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { banner, color, success } from "../utils/format.js";
import { resolveProjectId } from "../utils/project-id.js";
import { resolveAgent } from "../utils/resolve-agent.js";
import { CommandError, withSignal } from "../utils/signal.js";

const { CYAN, DIM, RESET } = color;

/** Files a reference directory contributes, sorted, dotfiles skipped. */
function refFiles(root: string): string[] {
  if (!fs.statSync(root).isDirectory()) return [root];

  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Read `--refs` as authoritative source material, wrapping each file so the
 * agent can cite it. Accepts a directory, unlike the file-only `--refs` on
 * `define spec` and `define plan`: a domain is described by a folder of notes
 * more often than by a single file.
 *
 * A missing path throws. Silently dropping the refs is the defect this closes —
 * the run then looks successful over material the agent never saw.
 */
function readRefs(refs: string, cwd: string): string {
  const resolved = path.resolve(cwd, refs);
  if (!fs.existsSync(resolved)) {
    throw new CommandError(
      `Reference path not found: ${refs}\nResolved to: ${resolved}`,
    );
  }

  const files = refFiles(resolved);
  if (files.length === 0) {
    throw new CommandError(`Reference path is empty: ${refs}`);
  }

  return files
    .map((file) => {
      const label = path.relative(cwd, file) || path.basename(file);
      return [
        `<reference_document source="${label}" authority="primary">`,
        fs.readFileSync(file, "utf-8"),
        "</reference_document>",
      ].join("\n");
    })
    .join("\n\n");
}

/**
 * US-020, US-021: Command handler for gwrk define ontology [--run]
 */
export async function defineOntologyCommand(options: {
  run?: boolean;
  agent?: string;
  model?: string;
  refs?: string;
}): Promise<void> {
  await withSignal("define ontology", async () => {
    const projectRoot = process.cwd();

    console.log(
      `${CYAN}🦩${RESET} ${DIM}Scaffolding ontology artifacts...${RESET}`,
    );
    await scaffold(projectRoot);

    if (options.run) {
      const startTime = Date.now();
      const projectId = resolveProjectId(projectRoot);

      // Resolve the backend from config, as `define research --run` does.
      // Passing `options.agent` straight through left it undefined without an
      // explicit --agent, and `agent.ts` then fell back to its hardcoded "agy"
      // whatever config said — an instant exit 1 wherever agy is not installed.
      const { backend, model } = resolveAgent("define", projectRoot, {
        agent: options.agent,
        model: options.model,
      });

      // Read refs before the scan so a bad path costs no dispatch.
      const refsBlock = options.refs
        ? readRefs(options.refs, projectRoot)
        : undefined;

      banner("ontology construct", {
        Project: projectId,
        Agent: backend,
        Model: model || "default",
        ...(options.refs ? { Refs: options.refs } : {}),
      });

      console.log(`${DIM}Scanning project for grounding material...${RESET}`);
      const material = await scan(projectRoot);

      // Prepare input for the workflow. Refs lead: they are authoritative, and
      // the scanned material is context the agent reads in their light.
      const grounding = `
# Grounding Material

## Architecture
${material.architecture || "None found."}

## Specifications
${material.specs.length > 0 ? material.specs.join("\n\n---\n\n") : "None found."}

## Code Patterns
${material.patterns.length > 0 ? material.patterns.join("\n\n---\n\n") : "None found."}
`;
      const input = refsBlock ? `${refsBlock}\n${grounding}` : grounding;

      const runtime = new WorkflowRuntime();
      console.log(
        `${DIM}Executing gwrk-ontology-construct workflow...${RESET}`,
      );

      const result = await runtime.executeWorkflow(
        "gwrk-ontology-construct",
        input,
        {
          projectRoot,
          agent: backend,
          model,
        },
      );

      const durationS = Math.round((Date.now() - startTime) / 1000);
      success("ontology construct", durationS);

      if (result.summary) {
        console.log(`\n${result.summary}\n`);
      }
    } else {
      console.log(
        `\n  ${CYAN}Done!${RESET} Ontology structure created in ${DIM}.gwrk/ontology/${RESET}`,
      );
      console.log(
        `  Run ${DIM}gwrk define ontology --run${RESET} to generate the initial domain.md.\n`,
      );
    }
  });
}
