import { loadConfig } from "./config.js";
import { loadRegistry } from "../server/agent-registry.js";
import type { ModelEntry } from "../server/agent-registry.js";
import { ModelSelector } from "../server/model-selector.js";
import { classifyTask } from "../server/task-classifier.js";

/**
 * Resolves the preferred model for a task type from the agent registry.
 *
 * This bridges the gap between the config-based backend selection
 * (agents.define = "gemini") and the tier-aware model selection
 * (define → THINKING → gemini-3.1-pro-preview).
 *
 * Used by define commands (spec, plan, tests) to select thinking models
 * and by ship/implement to select fast models.
 *
 * @param taskType - The task type string (e.g. "define", "implement", "review")
 * @param backendName - The backend name from config (e.g. "gemini")
 * @param projectRoot - The project root directory
 * @returns The resolved model name, or undefined if no model matched
 */
export function resolveModelForTask(
  taskType: string,
  backendName: string,
  projectRoot: string = process.cwd(),
): string | undefined {
  try {
    const registry = loadRegistry(projectRoot);
    const backendConfig = registry.backends[backendName];

    if (!backendConfig || backendConfig.models.length === 0) {
      return undefined;
    }

    const classification = classifyTask(taskType);
    const selector = new ModelSelector();

    // Use a no-cooldown prober for define commands (no state to track)
    const noCooldownProber = {
      isModelInCooldown: () => false,
      probeQuota: async () => ({ percent: 100, status: "available" as const }),
    };

    const { model } = selector.selectModel(
      backendConfig,
      classification,
      taskType,
      noCooldownProber as any,
    );

    return model?.name ?? undefined;
  } catch {
    // Registry not configured or backend not found — fall back to default
    return undefined;
  }
}
