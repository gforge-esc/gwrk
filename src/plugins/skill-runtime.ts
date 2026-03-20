import fs from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { PluginLoader } from "./loader.js";
import type { 
  SkillManifest, 
  AtomicSkillManifest, 
  CompoundSkillManifest 
} from "./manifest.js";
import { processForAgent } from "../utils/agent-layer.js";

const execAsync = promisify(exec);

export interface SkillOptions {
  input?: string;
  format?: 'text' | 'json';
  agent?: boolean;
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
  options: SkillOptions = {}
): Promise<string> {
  if (manifest.tier === 'atomic') {
    return `${manifest.prompt}\n\nInput:\n${input}`;
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
  loader: PluginLoader
): Promise<void> {
  for (const depName of manifest.composes) {
    try {
      await loader.resolvePlugin(depName);
    } catch (e) {
      throw new Error(`Missing dependency: skill '${depName}' required by '${manifest.name}'. Run 'gwrk plugin install <path>'.`);
    }
  }
}

/**
 * FR-006 / FR-007: Execute a skill.
 */
export async function executeSkill(
  name: string,
  options: SkillOptions = {},
  loaderOptions: { globalDir?: string; projectDir?: string } = {}
): Promise<SkillResult> {
  const loader = new PluginLoader(loaderOptions);
  const loaded = await loader.resolvePlugin(name);
  const manifest = loaded.manifest as SkillManifest;

  if (manifest.type !== 'skill') {
    throw new Error(`Plugin '${name}' is not a skill.`);
  }

  if (manifest.tier === 'compound') {
    await validateCompoundManifest(manifest, loader);
  }

  const input = options.input || '';
  const prompt = await assemblePrompt(manifest, input, loader, options);

  // FR-006: Determine agent and model
  const agent = manifest.runtime.preferredAgent;
  const model = manifest.runtime.preferredModel;

  let command: string;
  // Exact formats from FR-006
  if (agent === 'claude') {
    command = `claude --dangerously-skip-permissions --model ${model} -p "${prompt.replace(/"/g, '\\"')}"`;
  } else if (agent === 'gemini') {
    command = `gemini --yolo --model ${model} -p "${prompt.replace(/"/g, '\\"')}"`;
  } else if (agent === 'codex') {
    command = `codex exec --dangerously-bypass-approvals-and-sandbox --model ${model} "${prompt.replace(/"/g, '\\"')}"`;
  } else {
    // Fallback or generic (though FR-006 specifies these three)
    throw new Error(`Unsupported agent backend: ${agent}`);
  }

  const startTime = Date.now();
  try {
    const { stdout, stderr } = await execAsync(command);
    const durationS = (Date.now() - startTime) / 1000;

    let processedStdout = stdout;
    if (options.agent) {
      processedStdout = processForAgent(stdout);
    }

    // F013 signal on stderr
    const exitCode = 0;
    const finalStderr = `${stderr}\n[exit:${exitCode} | ${durationS.toFixed(1)}s]`;

    return {
      stdout: processedStdout,
      stderr: finalStderr,
      exitCode,
      durationS
    };
  } catch (error: any) {
    const durationS = (Date.now() - startTime) / 1000;
    const exitCode = error.code || 1;
    const finalStderr = `${error.stderr || ''}\n[exit:${exitCode} | ${durationS.toFixed(1)}s]`;
    
    throw {
      stdout: error.stdout || '',
      stderr: finalStderr,
      exitCode,
      durationS,
      message: `Skill invocation failed: ${error.message}. Agent: ${agent}, duration: ${durationS.toFixed(1)}s.`
    };
  }
}
