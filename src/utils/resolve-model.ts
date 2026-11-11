/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { tryLoadRegistry } from "../adapters/agents/registry-loader.js";
import { ModelSelector } from "../domain/agent-config.js";
import { classifyTask } from "../domain/types.js";

/**
 * Resolves the preferred model for a task type from the agent registry.
 *
 * This bridges the gap between the config-based backend selection
 * (agents.define = "agy") and the tier-aware model selection
 * (define → THINKING → gemini-3.1-pro-preview).
 *
 * Used by define commands (spec, plan, tests) to select thinking models
 * and by ship/implement to select fast models.
 *
 * @param taskType - The task type string (e.g. "define", "implement", "review")
 * @param backendName - The backend name from config (e.g. "agy")
 * @param projectRoot - The project root directory
 * @returns The provider model ID, or undefined if no model matched
 */
export function resolveModelForTask(
  taskType: string,
  backendName: string,
  projectRoot: string = process.cwd(),
): string | undefined {
  try {
    const result = tryLoadRegistry(projectRoot);
    if (!result.ok) return undefined;
    const backendConfig = result.value.backends[backendName];

    if (!backendConfig || backendConfig.models.length === 0) {
      return undefined;
    }

    const classification = classifyTask(taskType);
    const selector = new ModelSelector();

    // Use a no-cooldown prober for define commands (no state to track)
    const noCooldownProber = {
      isModelInCooldown: () => false,
    };

    const { model } = selector.selectModel(
      backendConfig,
      classification,
      taskType,
      noCooldownProber,
    );

    return model?.modelFlag || model?.name;
  } catch {
    // Registry not configured or backend not found — fall back to default
    return undefined;
  }
}
