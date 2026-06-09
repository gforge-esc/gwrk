import fs from "node:fs/promises";
import path from "node:path";
import { selectBackend } from "../engine/router.js";
import { processForAgent } from "../utils/agent-layer.js";
import { dispatchToAgent } from "../utils/agent.js";
import { CommandError } from "../utils/signal.js";
import { AgentBackendRegistry } from "./agent-registry.js";
import { PluginLoader } from "./loader.js";
import type { ProjectProfile } from "../engine/profile-detector.js";
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
 * Resolution order in string: builtins -> global -> project-local.
 * Precedence: project-local overrides global, global overrides builtins.
 */
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: "implementation" | "review" | "all" = "all",
  profile?: ProjectProfile,
): Promise<string> {
  const loader = new PluginLoader({ projectDir: projectRoot });
  const allPlugins = await loader.listPlugins({ tier: "enforcement" });

  // loader.listPlugins returns [project, global, builtins].
  // We want to process them such that we find the highest-precedence version of each skill,
  // but keep the final string order as [builtins, global, project].
  const visitedNames = new Set<string>();
  const skillMap = new Map<string, string>();

  // Reverse to get [builtins, global, project] order for the final string
  const orderedSummaries = [...allPlugins].reverse();

  for (const summary of orderedSummaries) {
    if (visitedNames.has(summary.name)) continue;

    try {
      // loader.resolvePlugin always returns the highest precedence version
      const loaded = await loader.resolvePlugin(summary.name);
      const manifest = loaded.manifest as EnforcementSkillManifest;

      // Filter by scope
      const manifestScope = manifest.scope ?? "all";
      if (
        scope !== "all" &&
        manifestScope !== "all" &&
        manifestScope !== scope
      ) {
        continue;
      }

      // Filter by language (R007: profile-aware enforcement routing)
      // Only filter builtins — project-local skills always load (the user chose them)
      if (profile?.stack?.language && manifest.language) {
        const manifestLang = manifest.language.toLowerCase();
        // Polyglot: check against languages array if present
        if (profile.stack.languages && profile.stack.languages.length > 1) {
          const profileLangs = profile.stack.languages.map((l) => l.toLowerCase());
          if (!profileLangs.includes(manifestLang)) {
            continue;
          }
        } else if (manifestLang !== profile.stack.language.toLowerCase()) {
          continue;
        }
      }

      const skillMdPath = path.join(loaded.path, "SKILL.md");
      const content = await fs.readFile(skillMdPath, "utf-8");
      
      skillMap.set(summary.name, `<!-- enforcement-skill: ${manifest.name} -->\n${content}`);
      visitedNames.add(summary.name);
    } catch (e) {
      // Skip invalid/failed plugins
    }
  }

  return Array.from(skillMap.values()).join("\n\n---\n\n");
}
