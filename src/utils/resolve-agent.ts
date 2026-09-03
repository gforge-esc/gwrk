/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { loadConfig } from "./config.js";
import { resolveModelForTask } from "./resolve-model.js";

/**
 * The two agent slots `.gwrkrc.json` declares under `agents`.
 *
 * `define` covers the definition pillar (spec, plan, tasks, tests, research,
 * ontology, adr, analyze). `implement` covers ship and implement.
 */
export type AgentPillar = "define" | "implement";

export interface ResolvedAgent {
  /** The backend to dispatch to. Always a value; config supplies a default. */
  backend: string;
  /** The model the registry picked, or undefined to let the dispatcher choose. */
  model: string | undefined;
}

/**
 * Decide which agent and model a command dispatches to.
 *
 * The single place that reads `agents.<pillar>`. Every dispatching command must
 * call this rather than reaching into config itself, and
 * `config-resolution.conformance.test.ts` fails the build if one does.
 *
 * That test exists because the duplicated form drifted. `define ontology` never
 * called `loadConfig`, so a project configured for claude dispatched to the
 * hardcoded "agy" in `agent.ts` and died wherever agy was not installed. Six
 * other define commands silently ignored `--agent`.
 *
 * @param projectRoot must be the project root. `loadConfig` joins its argument
 * with `.gwrkrc.json` and does not walk parents, so a subdirectory throws.
 */
export function resolveAgent(
  pillar: AgentPillar,
  projectRoot: string,
  overrides: { agent?: string; model?: string } = {},
): ResolvedAgent {
  const config = loadConfig(projectRoot);
  const backend = pillarBackend(config, pillar, overrides.agent);

  // Only consult the registry when the config declares one. `loadRegistry`
  // calls process.exit(1) on a config without `agents.registry`, which is not
  // throwable, so `resolveModelForTask`'s own try/catch cannot see it and
  // `withSignal` never emits its exit line. A project with no registry is
  // legal: it simply has no model to pick, and the dispatcher uses its default.
  const agents = config.agents as {
    registry?: Record<string, unknown>;
    fallbackOrder?: string[];
  };
  const hasRegistry = Boolean(agents.registry && agents.fallbackOrder);
  const model =
    overrides.model ||
    (hasRegistry
      ? resolveModelForTask(pillar, backend, projectRoot)
      : undefined);

  return { backend, model };
}

/**
 * Pick a pillar's backend from an already-loaded config.
 *
 * For callers holding a config object rather than a path, notably the build
 * server, which loads config once at startup and has no project root per
 * request. The precedence rule lives here so it cannot differ between the two
 * entry points.
 */
export function pillarBackend(
  config: { agents: Record<AgentPillar, string> },
  pillar: AgentPillar,
  override?: string,
): string {
  return override || config.agents[pillar];
}
