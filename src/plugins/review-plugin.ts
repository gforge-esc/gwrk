import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { loadConfig } from "../utils/config.js";
import {
  type TaskState,
  loadTaskState,
  saveTaskState,
} from "../utils/state.js";
import { PluginLoader } from "./loader.js";
import type { ReviewManifest, WorkflowManifest } from "./manifest.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

/**
 * ReviewStep schema defines a single atomic action within a review workflow.
 * Plugins can declare these as templates.
 */
export const ReviewStepSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  required: z.boolean().optional(),
  skip: z.boolean().optional(),
});

export type ReviewStep = z.infer<typeof ReviewStepSchema>;

/**
 * ReviewPlugin interface (Layer 3 Extension)
 * Represents a set of review strategies (code, uat) for a project.
 */
export interface ReviewPlugin {
  name: string;
  version: string;
  description: string;
  projectType: "cli" | "webapp";

  /**
   * The workflow names (plugins) to use for reviews.
   * Resolution: project-local -> global built-ins.
   */
  codeReviewWorkflow: string;
  uatReviewWorkflow: string;

  /** Default steps for these reviews */
  steps: {
    code: ReviewStep[];
    uat: ReviewStep[];
  };
}

/**
 * ReviewDispatch is the result of a review execution.
 */
export interface ReviewDispatch {
  verdict: "GO" | "NO-GO";
  summary: string;
  reopenedTasks: string[];
}

/**
 * Detects the project type based on filesystem markers.
 */
export function detectProjectType(projectRoot: string): "cli" | "webapp" {
  // Simple detection: look for webapp markers
  const webappMarkers = [
    "next.config.js",
    "tailwind.config.js",
    "src/app",
    "src/pages",
    "public/index.html",
  ];
  for (const marker of webappMarkers) {
    if (fs.existsSync(path.join(projectRoot, marker))) {
      return "webapp";
    }
  }

  // Look for CLI markers
  const cliMarkers = ["src/cli.ts", "bin/", "commander", "yargs"];
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    if (pkg.bin) return "cli";
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (deps.commander || deps.yargs || deps.oclif) return "cli";
  }

  // Default to cli if uncertain
  return "cli";
}

/**
 * Snapshot-Diff-Revert validation to ensure review workflows ONLY modify
 * tasks within the current phase.
 */
export function validatePhaseScope(
  projectRoot: string,
  featureId: string,
  currentPhaseId: string,
  beforeState: TaskState,
): void {
  const featureDir = path.join(projectRoot, "specs", featureId);
  const afterState = loadTaskState(featureDir);
  let dirty = false;

  for (const phase of afterState.phases) {
    if (phase.id === currentPhaseId) continue;

    const beforePhase = beforeState.phases.find((p) => p.id === phase.id);
    if (!beforePhase) continue;

    for (let i = 0; i < phase.tasks.length; i++) {
      const afterTask = phase.tasks[i];
      const beforeTask = beforePhase.tasks.find((t) => t.id === afterTask.id);
      if (!beforeTask) continue;

      if (afterTask.status !== beforeTask.status) {
        console.warn(
          `  ⚠️  Review violation: Reverted state change for task ${afterTask.id} (Phase ${phase.id} is out of scope)`,
        );
        phase.tasks[i] = JSON.parse(JSON.stringify(beforeTask));
        dirty = true;
      }
    }
  }

  if (dirty) {
    saveTaskState(featureDir, afterState);
  }
}

/**
 * Resolves the appropriate ReviewPlugin for the project.
 * resolution: .gwrkrc.json override -> auto-detection.
 */
export async function resolveReviewPlugin(
  projectRoot: string,
): Promise<ReviewPlugin> {
  const config = loadConfig(projectRoot);
  const projectType = config.review?.strategy || detectProjectType(projectRoot);

  const loader = new PluginLoader({ projectDir: projectRoot });
  const pluginName = `review-${projectType}`;

  try {
    const loaded = await loader.resolvePlugin(pluginName);
    const manifest = loaded.manifest as ReviewManifest;

    return {
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      projectType: manifest.projectType,
      codeReviewWorkflow: manifest.codeReviewWorkflow,
      uatReviewWorkflow: manifest.uatReviewWorkflow,
      steps: manifest.steps,
    };
  } catch (err) {
    // ADR-007: Fail fast. No silent degradation to hardcoded defaults.
    throw new Error(
      `Review plugin '${pluginName}' not found. Run 'gwrk init' to provision built-in review plugins.`,
    );
  }
}
