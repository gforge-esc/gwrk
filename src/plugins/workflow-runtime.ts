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

/**
 * Extract a JSON object from raw agent output.
 *
 * Handles common agent output patterns:
 * 1. JSON wrapped in markdown code fences (```json ... ```)
 * 2. Multiple JSON blocks (takes the last one — agents often self-correct)
 * 3. Plain text mixed with JSON (ignores the plain text)
 */
export function extractJsonFromOutput(stdout: string): unknown {
  // Step 1: Extract content from markdown code fences (```json ... ```)
  const fenceBlocks = [...stdout.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  if (fenceBlocks.length > 0) {
    // Try each fenced block in reverse order (last = most likely final answer)
    for (let i = fenceBlocks.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(fenceBlocks[i][1].trim());
        if (typeof parsed === "object" && parsed !== null) {
          return parsed;
        }
      } catch {}
    }
  }

  // Step 2: Try to find bare JSON objects (no fences)
  // Use a balanced-brace approach: find substrings starting with { and ending with }
  // Work backwards from the end (last JSON block is most likely the final output)
  const lines = stdout.split("\n");
  let braceDepth = 0;
  let jsonEnd = -1;
  let jsonStart = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    for (let j = lines[i].length - 1; j >= 0; j--) {
      const ch = lines[i][j];
      if (ch === "}") {
        if (braceDepth === 0) jsonEnd = i;
        braceDepth++;
      } else if (ch === "{") {
        braceDepth--;
        if (braceDepth === 0) {
          jsonStart = i;
          break;
        }
      }
    }
    if (jsonStart !== -1) break;
  }

  if (jsonStart !== -1 && jsonEnd !== -1) {
    const candidate = lines.slice(jsonStart, jsonEnd + 1).join("\n");
    // Extract just the JSON object part
    const startIdx = candidate.indexOf("{");
    const endIdx = candidate.lastIndexOf("}");
    if (startIdx !== -1 && endIdx !== -1) {
      try {
        return JSON.parse(candidate.substring(startIdx, endIdx + 1));
      } catch {
        // Fall through to error
      }
    }
  }

  throw new Error("Expected JSON object in agent output");
}

export interface WorkflowOptions {
  projectRoot?: string;
  agent?: string;
  model?: string;
  quiet?: boolean;
}

/** Typed output contract for workflow agent responses. */
export interface WorkflowOutput {
  summary?: string;
  intents: JsonIntent[];
}

export interface WorkflowResult {
  summary: string;
  intents: JsonIntent[];
  summaries: IntentSummary[];
  logPath?: string;
}

/**
 * Validates a parsed object against a JSON Schema (lightweight structural check).
 * Checks required properties exist and top-level types match.
 * Throws if validation fails with a descriptive error.
 */
function validateAgainstSchema(
  data: unknown,
  schema: Record<string, unknown>,
  context: string,
): void {
  if (typeof data !== "object" || data === null) {
    throw new Error(
      `Workflow output failed schema constraint: ${context} — expected object, got ${typeof data}.`,
    );
  }

  const obj = data as Record<string, unknown>;

  // Check "type" constraint
  if (schema.type && schema.type !== "object") {
    throw new Error(
      `Workflow output failed schema constraint: ${context} — expected type '${schema.type}'.`,
    );
  }

  // Check "required" properties
  if (Array.isArray(schema.required)) {
    for (const prop of schema.required) {
      if (!(prop in obj)) {
        throw new Error(
          `Workflow output failed schema constraint: ${context} — missing required property '${prop}'.`,
        );
      }
    }
  }

  // Check "properties" type constraints
  if (schema.properties && typeof schema.properties === "object") {
    const propSchemas = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    for (const [key, propSchema] of Object.entries(propSchemas)) {
      if (key in obj && propSchema.type) {
        const value = obj[key];
        const expectedType = propSchema.type;
        if (expectedType === "array" && !Array.isArray(value)) {
          throw new Error(
            `Workflow output failed schema constraint: ${context} — property '${key}' expected array, got ${typeof value}.`,
          );
        }
        if (expectedType === "string" && typeof value !== "string") {
          throw new Error(
            `Workflow output failed schema constraint: ${context} — property '${key}' expected string, got ${typeof value}.`,
          );
        }
      }
    }
  }
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
    } catch {
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
      quiet: options.quiet,
    };

    const result = await dispatchToAgent(task);

    if (result.exitCode !== 0) {
      throw new Error(
        `Workflow execution failed with exit code ${result.exitCode}: ${result.stderr}`,
      );
    }

    // Parse the JSON output from the agent
    let parsedOutput: unknown;
    try {
      parsedOutput = extractJsonFromOutput(result.stdout);
    } catch (e) {
      // FR-029: Tolerate agents that do native work and return prose.
      // If the agent exited 0, treat prose output as synthetic success.
      if (result.exitCode === 0) {
        const preview = result.stdout.substring(0, 200).replace(/\n/g, " ");
        console.warn(
          `[workflow-runtime] Agent returned prose instead of JSON (tolerant mode). Preview: ${preview}…`,
        );
        return {
          summary:
            "Agent completed successfully (native execution, no JSON intents)",
          intents: [],
          summaries: [],
        };
      }
      // Truncate raw output in error — full output is in the log file
      const preview = result.stdout.substring(0, 200).replace(/\n/g, " ");
      throw new Error(
        `Workflow output failed schema constraint: ${(e as Error).message}. Preview: ${preview}… (see log file for full output)`,
      );
    }

    // FR-L25-001: Validate output against manifest.outputSchema
    validateAgainstSchema(parsedOutput, manifest.outputSchema, name);

    // Type-narrow after schema validation
    const output = parsedOutput as WorkflowOutput;

    // Basic validation: must have intents and summary
    if (!output.intents || !Array.isArray(output.intents)) {
      throw new Error(
        `Workflow output failed schema constraint: Missing 'intents' array.`,
      );
    }

    // FR-L25-001: Catch direct FS edit attempts in RUN_COMMAND
    for (const intent of output.intents) {
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
      // Guard: reject WRITE_FILE intents targeting tasks.json.
      // Review agents use native tools to update tasks.json before emitting their
      // final JSON payload. If we allow WRITE_FILE to execute afterward, it overwrites
      // the native changes with a potentially truncated string from the JSON output.
      if (
        intent.action === "WRITE_FILE" &&
        intent.filePath?.endsWith("tasks.json")
      ) {
        console.warn(
          "  ⚠ Blocked WRITE_FILE intent targeting tasks.json — agent already applied changes natively.",
        );
        // Remove the intent so it isn't executed
        output.intents = output.intents.filter((i) => i !== intent);
      }
    }

    // Execute the intents natively
    const summaries = await this.intentEngine.executeIntents(
      output.intents,
      projectRoot,
    );

    return {
      summary: output.summary || "Workflow completed successfully.",
      intents: output.intents,
      summaries,
      logPath: result.logPath,
    };
  }
}
