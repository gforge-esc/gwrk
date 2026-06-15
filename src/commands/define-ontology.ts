import path from "node:path";
import { scaffold } from "../engine/ontology-scaffold.js";
import { scan } from "../engine/source-scanner.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { resolveProjectId } from "../utils/project-id.js";
import { color, success, banner } from "../utils/format.js";
import { withSignal } from "../utils/signal.js";

const { CYAN, DIM, RESET } = color;

/**
 * US-020, US-021: Command handler for gwrk define ontology [--run]
 */
export async function defineOntologyCommand(options: { run?: boolean; agent?: string; model?: string }): Promise<void> {
  await withSignal("define ontology", async () => {
    const projectRoot = process.cwd();
    
    console.log(`${CYAN}🦩${RESET} ${DIM}Scaffolding ontology artifacts...${RESET}`);
    await scaffold(projectRoot);

    if (options.run) {
      const startTime = Date.now();
      const projectId = resolveProjectId(projectRoot);
      
      banner("ontology construct", {
        Project: projectId,
        Agent: options.agent || "default",
        Model: options.model || "default",
      });

      console.log(`${DIM}Scanning project for grounding material...${RESET}`);
      const material = await scan(projectRoot);

      // Prepare input for the workflow
      const input = `
# Grounding Material

## Architecture
${material.architecture || "None found."}

## Specifications
${material.specs.length > 0 ? material.specs.join("\n\n---\n\n") : "None found."}

## Code Patterns
${material.patterns.length > 0 ? material.patterns.join("\n\n---\n\n") : "None found."}
`;

      const runtime = new WorkflowRuntime();
      console.log(`${DIM}Executing gwrk-ontology-construct workflow...${RESET}`);
      
      const result = await runtime.executeWorkflow("gwrk-ontology-construct", input, {
        projectRoot,
        agent: options.agent,
        model: options.model,
      });

      const durationS = Math.round((Date.now() - startTime) / 1000);
      success("ontology construct", durationS);
      
      if (result.summary) {
        console.log(`\n${result.summary}\n`);
      }
    } else {
      console.log(`\n  ${CYAN}Done!${RESET} Ontology structure created in ${DIM}.gwrk/ontology/${RESET}`);
      console.log(`  Run ${DIM}gwrk define ontology --run${RESET} to generate the initial domain.md.\n`);
    }
  });
}
