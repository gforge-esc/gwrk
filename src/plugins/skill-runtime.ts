/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs/promises";
import path from "node:path";
import { createAgentPortAdapter } from "../adapters/agents/index.js";
import {
  type EffectivePolicy,
  type EnforcementScope,
  composeEffectivePolicy,
} from "../domain/policy-selection.js";
import type { ProjectProfile } from "../engine/profile-detector.js";
import { detectProfile } from "../engine/profile-detector.js";
import { processForAgent } from "../utils/agent-layer.js";
import { CommandError } from "../utils/signal.js";
import { AgentBackendRegistry } from "./agent-registry.js";
import { PluginLoader } from "./loader.js";
import type {
  AtomicSkillManifest,
  CompoundSkillManifest,
  SkillManifest,
} from "./manifest.js";

interface SkillOptions {
  input?: string;
  format?: "text" | "json";
  agent?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: dynamic configuration overrides
  [key: string]: any;
}

interface SkillResult {
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
  skillDir?: string,
): Promise<string> {
  const readSkillMarkdown = async (
    dir?: string,
  ): Promise<string | undefined> => {
    if (!dir) return undefined;
    try {
      const md = await fs.readFile(path.join(dir, "SKILL.md"), "utf-8");
      return typeof md === "string" && md.trim().length > 0
        ? md.trim()
        : undefined;
    } catch {
      return undefined;
    }
  };

  if (manifest.tier === "atomic" || manifest.tier === "domain") {
    const mdBody = await readSkillMarkdown(skillDir);
    const basePrompt = manifest.prompt ?? manifest.description;
    const body = mdBody ? `${basePrompt}\n\n${mdBody}` : basePrompt;
    return `${body}\n\nInput:\n${input}`;
  }

  if (manifest.tier === "enforcement") {
    const mdBody = await readSkillMarkdown(skillDir);
    const body = mdBody
      ? `Enforcement Skill: ${manifest.description}\n\n${mdBody}`
      : `Enforcement Skill: ${manifest.description}`;
    return `${body}\n\nInput:\n${input}`;
  }

  // Compound skill: assemble all passes
  let fullPrompt = `Compound Skill: ${manifest.description}\n\n`;
  const compoundMd = await readSkillMarkdown(skillDir);
  if (compoundMd) {
    fullPrompt += `${compoundMd}\n\n`;
  }

  for (const pass of manifest.passes) {
    const loadedSkill = await loader.resolvePlugin(pass.skill);
    const skillManifest = loadedSkill.manifest as AtomicSkillManifest;
    const passMd = await readSkillMarkdown(loadedSkill.path);
    fullPrompt += `Pass: ${pass.name}\nGoal: ${pass.summary}\nPrompt: ${skillManifest.prompt}${passMd ? `\nInstructions:\n${passMd}` : ""}\n\n`;
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
  const prompt = await assemblePrompt(
    manifest,
    input,
    loader,
    options,
    loaded.path,
  );

  // FR-006: Determine agent and model via router
  const projectRoot = loaderOptions.projectDir || process.cwd();
  const registry = new AgentBackendRegistry(loader);

  // Safely extract runtime preferences if they exist (Atomic/Compound tiers)
  const runtime = "runtime" in manifest ? manifest.runtime : undefined;

  const agents = createAgentPortAdapter({ projectRoot, registry });
  const route = await agents.selectRoute({
    type: "skill",
    skillName: name,
    preferredAgent: runtime?.preferredAgent,
    explicitModel: runtime?.preferredModel,
  });

  const taskResult = await agents.execute({
    type: `skill/${name}`,
    agent: route.backend,
    model: route.model,
    env: route.effort ? { GWRK_EFFORT: route.effort } : undefined,
    stdin: prompt,
    workflow: `skill/${name}`,
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

export interface ResolvePolicyOptions {
  scope?: EnforcementScope;
  profile?: ProjectProfile;
  globalDir?: string;
  checksConfigured?: boolean;
}

export async function resolveEffectivePolicy(
  projectRoot: string,
  options: ResolvePolicyOptions = {},
): Promise<EffectivePolicy> {
  const loader = new PluginLoader({
    projectDir: projectRoot,
    globalDir: options.globalDir,
  });
  const [profile, candidates] = await Promise.all([
    options.profile ?? detectProfile(projectRoot),
    loader.listEnforcementCandidates(),
  ]);
  return composeEffectivePolicy({
    profile,
    candidates,
    scope: options.scope,
    checksConfigured: options.checksConfigured,
  });
}

export function formatEffectivePolicyPrompt(policy: EffectivePolicy): string {
  const sections: string[] = [];
  const renderedPaths = new Set<string>();
  for (const { name, path, content } of policy.selectedSkills) {
    if (!content) continue;
    if (path !== undefined) {
      if (renderedPaths.has(path)) continue;
      renderedPaths.add(path);
    }
    sections.push(`<!-- enforcement-skill: ${name} -->\n${content}`);
  }
  if (policy.gaps.length > 0) {
    const notes = policy.gaps.map(({ message }) => `- ${message}`).join("\n");
    sections.push(`## Policy gaps\n\n${notes}`);
  }
  return sections.join("\n\n---\n\n");
}

/** FR-014: Resolves and renders applicable enforcement skills. */
export async function resolveEnforcementSkills(
  projectRoot: string,
  scope: EnforcementScope = "all",
  profile?: ProjectProfile,
): Promise<string> {
  return formatEffectivePolicyPrompt(
    await resolveEffectivePolicy(projectRoot, { scope, profile }),
  );
}
