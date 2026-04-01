import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  IntentEngine,
  type IntentSummary,
  type JsonIntent,
} from "../engine/intent-engine.js";
import { type TaskDispatch, dispatchToAgent } from "../utils/agent.js";
import { PluginLoader, PluginNotFoundError } from "./loader.js";
import type { WorkflowManifest } from "./manifest.js";

export interface WorkflowOptions {
  projectRoot?: string;
  agent?: string;
  model?: string;
}

export interface WorkflowResult {
  summary: string;
  intents: JsonIntent[];
  summaries: IntentSummary[];
}

/**
 * The WorkflowRuntime resolves and executes workflows (Layer 2.5).
 * It uses the JSON Intent Engine to decouple reasoning from mutation.
 */
export class WorkflowRuntime {
  private loader: PluginLoader;
  private intentEngine: IntentEngine;

  constructor(loader?: PluginLoader, intentEngine?: IntentEngine) {
    this.loader = loader || new PluginLoader();
    this.intentEngine = intentEngine || new IntentEngine();
  }

  /**
   * Resolves a workflow from built-ins or project-local overrides.
   * resolution order: .gwrk/plugins/workflows/ -> ~/.gwrk/plugins/workflows/
   */
  async resolveWorkflow(
    name: string,
    projectRoot?: string,
  ): Promise<WorkflowManifest> {
    const loader = projectRoot
      ? new PluginLoader({ projectDir: projectRoot })
      : this.loader;
    try {
      const plugin = await loader.resolvePlugin(name);
      if (plugin.manifest.type !== "workflow") {
        throw new Error(`Plugin '${name}' is not a workflow.`);
      }
      return plugin.manifest as WorkflowManifest;
    } catch (e) {
      if (e instanceof PluginNotFoundError) {
        throw new Error(`Workflow '${name}' not found.`);
      }
      throw e;
    }
  }

  /**
   * Executes a workflow by resolving its prompt, invoking an agent,
   * parsing the JSON intent output, and executing those intents.
   */
  async executeWorkflow(
    name: string,
    input: string,
    options: WorkflowOptions = {},
  ): Promise<WorkflowResult> {
    const projectRoot = options.projectRoot || process.cwd();

    // Resolve manifest and path
    const loader = options.projectRoot
      ? new PluginLoader({ projectDir: options.projectRoot })
      : this.loader;
    const plugin = await loader.resolvePlugin(name);
    const manifest = plugin.manifest as WorkflowManifest;
    const pluginPath = plugin.path;

    // Load the workflow prompt from PROMPT.md in the plugin directory
    const promptPath = path.join(pluginPath, "PROMPT.md");
    let basePrompt = "";
    try {
      basePrompt = await readFile(promptPath, "utf-8");
    } catch (e) {
      // If PROMPT.md is missing, we use a default or fail
      // For core workflows, PROMPT.md is expected.
      throw new Error(
        `Workflow '${name}' is missing PROMPT.md in ${pluginPath}`,
      );
    }

    // Inject the outputSchema and input into the final prompt
    const fullPrompt = `${basePrompt}\n\nCRITICAL: Your output MUST be a single JSON object matching this schema:\n${JSON.stringify(manifest.outputSchema, null, 2)}\n\nInput:\n${input}`;

    const task: TaskDispatch = {
      type: "workflow",
      prompt: fullPrompt,
      agent: options.agent,
      workDir: projectRoot,
      workflow: name,
    };

    const result = await dispatchToAgent(task);

    if (result.exitCode !== 0) {
      throw new Error(
        `Workflow execution failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    let parsedOutput: any;
    try {
      // Find the JSON block in the agent's output
      const jsonMatch = result.stdout.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error(
          "Workflow output failed schema constraint: Expected JSON object.",
        );
      }
      parsedOutput = JSON.parse(jsonMatch[0]);
    } catch (e) {
      throw new Error(
        `Workflow output failed schema constraint: Expected JSON object. Original output: ${result.stdout}`,
      );
    }

    // Basic validation: must have intents and summary
    if (!parsedOutput.intents || !Array.isArray(parsedOutput.intents)) {
      throw new Error(
        `Workflow output failed schema constraint: Missing 'intents' array.`,
      );
    }

    // FR-L25-001: Catch direct FS edit attempts in RUN_COMMAND
    for (const intent of parsedOutput.intents) {
      if (intent.action === "RUN_COMMAND" && intent.command) {
        if (
          intent.command.includes(">") ||
          intent.command.includes("tee") ||
          intent.command.includes(">>")
        ) {
          throw new Error(
            "Workflow execution violation: Use WRITE_FILE JSON intent only.",
          );
        }
      }
    }

    // Execute the intents natively
    const summaries = await this.intentEngine.executeIntents(
      parsedOutput.intents,
      projectRoot,
    );

    return {
      summary: parsedOutput.summary || "Workflow completed successfully.",
      intents: parsedOutput.intents,
      summaries,
    };
  }
}
