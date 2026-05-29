import fs from "node:fs/promises";
import path from "node:path";
import { selectBackend } from "../engine/router.js";
import { processForAgent } from "../utils/agent-layer.js";
import { dispatchToAgent } from "../utils/agent.js";
import { CommandError } from "../utils/signal.js";
import { AgentBackendRegistry } from "./agent-registry.js";
import { PluginLoader } from "./loader.js";
import type {
  AtomicSkillManifest,
  CompoundSkillManifest,
  EnforcementSkillManifest,
  SkillManifest,
} from "./manifest.js";

export interface SkillOptions {
  input?: string;
  format?: "text" | "json";
  agent?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic configuration overrides
  [key: string]: any;
}

export interface SkillResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationS: number;
}

/**
 * FR-008: Assemble prompt for atomic or compound skills.
 */
export async function assemblePrompt(
  manifest: SkillManifest,
  input: string,
  loader: PluginLoader,
  options: SkillOptions = {},
): Promise<string> {
  if (manifest.tier === "atomic") {
    return `${manifest.prompt}\n\nInput:\n${input}`;
  }

  if (manifest.tier === "enforcement") {
    return `Enforcement Skill: ${manifest.description}\n\nInput:\n${input}`;
  }

  // Compound skill: assemble all passes
  let fullPrompt = `Compound Skill: ${manifest.description}\n\n`;

  for (const pass of manifest.passes) {
    const loadedSkill = await loader.resolvePlugin(pass.skill);
    const skillManifest = loadedSkill.manifest as AtomicSkillManifest;
    fullPrompt += `Pass: ${pass.name}\nGoal: ${pass.summary}\nPrompt: ${skillManifest.prompt}\n\n`;
  }

  fullPrompt += `Original Input:\n${input}`;

  // Add optional context if provided in options
  if (manifest.context) {
    for (const opt of manifest.context.optional) {
      if (options[opt]) {
        fullPrompt = `Context: ${opt}=${options[opt]}\n${fullPrompt}`;
      }
    }
  }

  return fullPrompt;
}

/**
 * FR-009: Validate compound skill dependencies.
 */
export async function validateCompoundManifest(
  manifest: CompoundSkillManifest,
  loader: PluginLoader,
): Promise<void> {
  const allDeps = new Set([
    ...manifest.composes,
    ...manifest.passes.map((p) => p.skill),
  ]);
  for (const depName of allDeps) {
    try {
      await loader.resolvePlugin(depName);
    } catch (e) {
      throw new Error(
        `Missing dependency: skill '${depName}' required by '${manifest.name}'. Run 'gwrk plugin install <path>'.`,
      );
    }
  }
}

/**
 * FR-006 / FR-007: Execute a skill.
 */
export async function executeSkill(
  name: string,
  options: SkillOptions = {},
  loaderOptions: { globalDir?: string; projectDir?: string } = {},
): Promise<SkillResult> {
  const loader = new PluginLoader(loaderOptions);
  const loaded = await loader.resolvePlugin(name);
  const manifest = loaded.manifest as SkillManifest;

  if (manifest.type !== "skill") {
    throw new Error(`Plugin '${name}' is not a skill.`);
  }

  if (manifest.tier === "compound") {
    await validateCompoundManifest(manifest, loader);
  }

  const input = options.input || "";
  const prompt = await assemblePrompt(manifest, input, loader, options);

  // FR-006: Determine agent and model via router
  const projectRoot = loaderOptions.projectDir || process.cwd();
  const registry = new AgentBackendRegistry(loader);

  const backend = await selectBackend(
    { type: "skill", skillName: name },
    projectRoot,
    registry,
  );

  const taskResult = await dispatchToAgent({
    type: `skill/${name}`,
    prompt,
    agent: backend.name,
    stdin: prompt,
    workflow: `skill/${name}`, // Symbolic path for logging
    workDir: projectRoot,
  });

  let processedStdout = taskResult.stdout;
  if (options.agent) {
    processedStdout = processForAgent(taskResult.stdout);
  }

  return {
    stdout: processedStdout,
    stderr: taskResult.stderr,
    exitCode: taskResult.exitCode,
    durationS: taskResult.durationS,
  };
}

/**
 * FR-014: Resolves all enforcement skills applicable to the project.
 * Returns combined SKILL.md content.
 * Follows resolution order: project-local -> global -> builtins (standard loader order)
 */
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
): Promise<string> {
  const loader = new PluginLoader({ projectDir: projectRoot });
  const allPlugins = await loader.listPlugins();
  const enforcementSkills = allPlugins.filter((p) => p.tier === "enforcement");

  const resolvedContents: string[] = [];
  const visitedNames = new Set<string>();

  for (const summary of enforcementSkills) {
    if (visitedNames.has(summary.name)) continue;

    try {
      const loaded = await loader.resolvePlugin(summary.name);
      const manifest = loaded.manifest as EnforcementSkillManifest;

      // Filter by scope
      if (
        scope !== "all" &&
        manifest.scope &&
        manifest.scope !== "all" &&
        manifest.scope !== scope
      ) {
        continue;
      }

      const skillMdPath = path.join(loaded.path, "SKILL.md");
      const content = await fs.readFile(skillMdPath, "utf-8");
      resolvedContents.push(content);
      visitedNames.add(summary.name);
    } catch (e) {
      // Skip invalid/failed plugins
    }
  }

  return resolvedContents.join("\n\n---\n\n");
}
