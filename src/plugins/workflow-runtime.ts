/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  IntentEngine,
  type IntentSummary,
} from "../engine/intent-engine.js";
import { detectProfile } from "../engine/profile-detector.js";
import { conditionPrompt } from "../engine/prompt-conditioner.js";
import { type TaskDispatch, dispatchToAgent } from "../utils/agent.js";
import { PluginLoader, PluginNotFoundError } from "./loader.js";
import type { WorkflowManifest, JsonIntent } from "./manifest.js";

/**
 * Extract a JSON object from raw agent output.
 *
 * Handles common agent output patterns:
 * 1. JSON wrapped in markdown code fences (```json ... ```)
 * 2. Multiple JSON blocks (takes the last one — agents often self-correct)
 * 3. Plain text mixed with JSON (ignores the plain text)
 */
export function extractJsonFromOutput(stdout: string): unknown {
  // Step 0: Unwrap Claude Code's `--output-format json` envelope. Its real
  // payload is a string in the `result` field (typically wrapped in prose and
  // a ```json fence), so recurse into it. Without this, the balanced-brace
  // scan below matches the envelope's own outer braces and returns the wrapper
  // object — which has no `summary`/`intents` — failing schema validation.
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    let envelope: Record<string, unknown> | undefined;
    try {
      envelope = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Not a single well-formed JSON value — fall through to fence/brace scan.
      envelope = undefined;
    }
    if (
      envelope &&
      typeof envelope === "object" &&
      envelope.type === "result" &&
      typeof envelope.result === "string"
    ) {
      // This IS a Claude Code result envelope: the real payload lives in
      // `result`. Recurse into it and let any failure propagate. Do NOT fall
      // back to brace-scanning the wrapper — that would match the envelope's
      // own outer braces and return a wrapper object with no summary/intents,
      // masking the true failure (e.g. the agent returned prose, not a contract).
      return extractJsonFromOutput(envelope.result);
    }
  }

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

/**
 * True when a WRITE_FILE intent would replace an existing file with strictly
 * less content — the signature of an agent that wrote the file natively and
 * then emitted an abbreviated/placeholder WRITE_FILE payload. A `null`
 * `existing` means the file doesn't exist yet, so the write is allowed.
 */
export function wouldShrinkExistingFile(
  existing: string | null,
  incoming: string,
): boolean {
  return existing !== null && incoming.length < existing.length;
}

interface WorkflowOptions {
  projectRoot?: string;
  agent?: string;
  model?: string;
  quiet?: boolean;
  tolerant?: boolean;
  /**
   * Optional write-scope allowlist. When set, WRITE_FILE intents targeting
   * paths outside this list are filtered with a warning. Paths are matched
   * as suffixes (e.g. "src/engine/foo.ts" matches intent path ending in that).
   * Test files (*.test.ts, *.spec.ts) and spec artifacts are always allowed.
   */
  allowedPaths?: string[];
}

/** Typed output contract for workflow agent responses. */
interface WorkflowOutput {
  summary?: string;
  intents: JsonIntent[];
}

interface WorkflowResult {
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

    // Phase 13: Project-aware prompt conditioning
    const profile = await detectProfile(projectRoot);
    const conditionedPrompt = conditionPrompt(basePrompt, profile);

    // Inject the outputSchema and input into the final prompt
    // Input is wrapped in XML tags to prevent prompt injection from user content
    const fullPrompt = `${conditionedPrompt}\n\n<output_contract>\nYour output MUST be a single JSON object matching this schema:\n${JSON.stringify(manifest.outputSchema, null, 2)}\n</output_contract>\n\n<user_input>\n${input}\n</user_input>`;

    const task: TaskDispatch = {
      type: "workflow",
      prompt: fullPrompt,
      agent: options.agent,
      model: options.model,
      workDir: projectRoot,
      workflow: name,
      quiet: options.quiet,
      // Enforce the contract at the model level ONLY when the workflow opts in
      // (e.g. Claude's --json-schema). Content-heavy workflows write files
      // natively and only report a manifest — forcing large structured output
      // there exhausts the model's retries and fails an otherwise-good run.
      // See WorkflowManifestSchema.enforceOutputSchema.
      outputSchema: manifest.enforceOutputSchema
        ? manifest.outputSchema
        : undefined,
    };

    const result = await dispatchToAgent(task);

    // Detect native artifacts (files the agent wrote directly). Used by both
    // the structured-output safety net and the FR-029 tolerant path below.
    const hasArtifacts = (): boolean => {
      try {
        return (
          execSync("git status --porcelain", { cwd: projectRoot })
            .toString()
            .trim().length > 0
        );
      } catch {
        return false;
      }
    };

    if (result.exitCode !== 0) {
      // Safety net: Claude under --json-schema can exhaust its structured-output
      // retries (subtype "error_max_structured_output_retries", exit 1) AFTER
      // writing the deliverable files natively — the work is done, only the
      // report failed to serialize. If artifacts exist, recover it as
      // native-writer success rather than discarding the work.
      const exhaustedStructuredOutput = result.stdout.includes(
        "error_max_structured_output_retries",
      );
      if (exhaustedStructuredOutput && hasArtifacts()) {
        console.warn(
          "[workflow-runtime] Agent exhausted structured-output retries but wrote artifacts natively — recovering as native success.",
        );
        return {
          summary:
            "Agent completed successfully (native execution; structured output not serialized)",
          intents: [],
          summaries: [],
        };
      }
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
      // T019: Detect agent-native success by checking for committed artifacts
      if (result.exitCode === 0 && (result.nativeWriter || options.tolerant || hasArtifacts())) {
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

    // FR-L25-001: Filter direct FS edit attempts in RUN_COMMAND intents.
    // Agents sometimes emit redundant RUN_COMMAND intents with shell redirects
    // (> or tee) after already applying changes natively. These are not malicious —
    // they're the agent echoing its work. Filter them instead of throwing.
    output.intents = output.intents.filter((intent) => {
      if (intent.action === "RUN_COMMAND" && intent.command) {
        if (
          intent.command.includes(">") ||
          intent.command.includes("tee") ||
          intent.command.includes(">>")
        ) {
          console.warn(
            "  ⚠ Filtered RUN_COMMAND intent with shell redirect — agent already applied changes natively.",
          );
          return false;
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
          "  ⚠ Filtered WRITE_FILE intent targeting tasks.json — agent already applied changes natively.",
        );
        return false;
      }

      // Guard: don't clobber a file the agent already wrote natively.
      // Agents with file tools (e.g. claude under --dangerously-skip-
      // permissions) sometimes write the file directly during the run, then
      // emit a WRITE_FILE intent whose `content` is an abbreviated summary or
      // a self-reference ("<full report — written to disk…>"). Executing that
      // would overwrite the real content with a placeholder. If the target
      // already exists and the intent carries less content than what's on
      // disk, keep the on-disk (native) version.
      if (intent.action === "WRITE_FILE" && intent.filePath) {
        const abs = path.resolve(projectRoot, intent.filePath);
        const existing = fs.existsSync(abs)
          ? fs.readFileSync(abs, "utf-8")
          : null;
        const incoming = intent.content ?? "";
        if (wouldShrinkExistingFile(existing, incoming)) {
          console.warn(
            `  ⚠ Kept the on-disk ${intent.filePath} — the agent wrote it directly and the WRITE_FILE intent had less content (${incoming.length} vs ${existing?.length} chars).`,
          );
          return false;
        }
      }

      // Guard: enforce write-scope allowlist when provided.
      // Plan-declared file paths define what a workflow is allowed to write.
      // Test files and spec artifacts are always allowed regardless of allowlist.
      if (
        intent.action === "WRITE_FILE" &&
        intent.filePath &&
        options.allowedPaths &&
        options.allowedPaths.length > 0
      ) {
        const fp = intent.filePath;
        const isTestFile = fp.endsWith(".test.ts") || fp.endsWith(".spec.ts") || fp.startsWith("tests/e2e/") || fp.startsWith("e2e/");
        const isSpecArtifact = fp.startsWith("specs/") || fp.includes("gap-matrix");
        if (!isTestFile && !isSpecArtifact) {
          const inScope = options.allowedPaths.some((allowed) => fp.endsWith(allowed) || fp.includes(allowed));
          if (!inScope) {
            console.warn(
              `  ⚠ Filtered WRITE_FILE intent outside allowed scope: ${fp}`,
            );
            return false;
          }
        }
      }

      return true;
    });

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
