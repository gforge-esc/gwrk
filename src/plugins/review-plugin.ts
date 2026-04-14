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
    console.warn(
      `  ⚠  Review plugin '${pluginName}' not found. Falling back to built-in defaults.`,
    );

    if (projectType === "webapp") {
      return {
        name: "review-webapp",
        version: "1.0.0",
        description: "Default WebApp Review Strategy (Hardcoded Fallback)",
        projectType: "webapp",
        codeReviewWorkflow: "review-code-webapp",
        uatReviewWorkflow: "review-uat-webapp",
        steps: {
          code: [
            {
              id: "lint",
              title: "Linting",
              description: "Check for lint errors",
              required: true,
            },
            {
              id: "types",
              title: "Type Check",
              description: "Verify TypeScript types",
              required: true,
            },
            {
              id: "tests",
              title: "Unit Tests",
              description: "Run component unit tests",
              required: true,
            },
          ],
          uat: [
            {
              id: "visual",
              title: "Visual Regression",
              description: "Verify UI components",
              required: true,
            },
            {
              id: "e2e",
              title: "E2E Tests",
              description: "Run Playwright/Cypress tests",
              required: true,
            },
          ],
        },
      };
    }

    return {
      name: "review-cli",
      version: "1.0.0",
      description: "Default CLI Review Strategy (Hardcoded Fallback)",
      projectType: "cli",
      codeReviewWorkflow: "review-code-cli",
      uatReviewWorkflow: "review-uat-cli",
      steps: {
        code: [
          {
            id: "lint",
            title: "Linting",
            description: "Check for lint errors",
            required: true,
          },
          {
            id: "types",
            title: "Type Check",
            description: "Verify TypeScript types",
            required: true,
          },
          {
            id: "tests",
            title: "Unit Tests",
            description: "Run unit tests",
            required: true,
          },
        ],
        uat: [
          {
            id: "integration",
            title: "Integration Tests",
            description: "Verify CLI commands end-to-end",
            required: true,
          },
          {
            id: "help",
            title: "Help Output",
            description: "Verify --help and manpages",
            required: false,
          },
        ],
      },
    };
  }
}
