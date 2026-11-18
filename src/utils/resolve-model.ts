/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { tryLoadRegistry } from "../adapters/agents/registry-loader.js";
import {
  type RouteSelectionDecision,
  selectAgentRoute,
} from "../domain/agent-routing.js";

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
  const route = resolveRegisteredRoute(taskType, backendName, projectRoot);
  return route?.mode === "selected" ? route.model : undefined;
}

export function resolveRegisteredRoute(
  taskType: string,
  backendName: string,
  projectRoot: string,
): RouteSelectionDecision | undefined {
  const result = tryLoadRegistry(projectRoot);
  if (!result.ok || !result.value.backends[backendName]) return undefined;
  return selectAgentRoute(
    { type: taskType },
    {
      explicitBackend: backendName,
      registry: result.value,
    },
  );
}
