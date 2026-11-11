/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getRoutingHistory } from "../../db/plugins.js";
import {
  type HistoricalBackendStat,
  type RoutingFacts,
  selectAgentRoute,
} from "../../domain/agent-routing.js";
import { quotaProbe } from "../../engine/quota.js";
import { AgentBackendRegistry } from "../../plugins/agent-registry.js";
import { PluginLoader } from "../../plugins/loader.js";
import type { AgentPort, RoutingContext } from "../../ports/agent-port.js";
import { loadConfig } from "../../utils/config.js";
import { resolveProjectId } from "../../utils/project-id.js";
import { tryLoadRegistry } from "./registry-loader.js";

interface AgentPortAdapterOptions {
  projectRoot?: string;
  registry?: AgentBackendRegistry;
}

function routingHistory(
  taskType: string,
  projectRoot: string,
): HistoricalBackendStat[] {
  try {
    const rows = getRoutingHistory(taskType, resolveProjectId(projectRoot), 50);
    const grouped = new Map<string, { runs: number; successes: number }>();
    for (const row of rows) {
      const stat = grouped.get(row.selected_backend) ?? {
        runs: 0,
        successes: 0,
      };
      stat.runs++;
      if (row.outcome === "success") stat.successes++;
      grouped.set(row.selected_backend, stat);
    }
    return [...grouped].map(([backend, stat]) => ({
      backend,
      runs: stat.runs,
      successRate: stat.successes / stat.runs,
    }));
  } catch {
    return [];
  }
}

async function selectAvailableRoute(
  context: RoutingContext,
  projectRoot: string,
  registry: AgentBackendRegistry,
) {
  const config = loadConfig(projectRoot);
  const registered = tryLoadRegistry(projectRoot);
  const history = routingHistory(context.type, projectRoot);
  const configured = (config.agents as Record<string, unknown>)?.[context.type];
  const preferredAgent =
    context.preferredAgent ??
    (context.type === "skill" &&
    ["narrative", "signal-cut"].includes(context.skillName ?? "")
      ? "claude"
      : undefined);
  const fallbackOrder = config.agents?.fallbackOrder ?? [
    "agy",
    "claude",
    "codex",
  ];
  const facts: RoutingFacts = {
    explicitBackend: context.explicitBackend,
    explicitModel: context.explicitModel,
    registry: registered.ok ? registered.value : undefined,
    history,
    fallbackOrder,
    pillarConfig:
      typeof configured === "string"
        ? { [context.type]: configured }
        : undefined,
    defaultBackend: context.type === "implement" ? "agy" : undefined,
  };
  const candidates = new Set(
    [
      context.explicitBackend,
      preferredAgent,
      ...history.map(({ backend }) => backend),
      ...(typeof configured === "string" ? [configured] : []),
      facts.defaultBackend,
      ...fallbackOrder,
      ...Object.keys(facts.registry?.backends ?? {}),
    ].filter((backend): backend is string => Boolean(backend)),
  );
  const probed = new Set<string>();
  let loadedAll = false;
  while (candidates.size > 0 || !loadedAll) {
    if (candidates.size === 0) {
      loadedAll = true;
      const installed = await registry.getBackends();
      for (const name of Object.keys(installed ?? {})) {
        if (!probed.has(name)) candidates.add(name);
      }
    }
    let route: ReturnType<typeof selectAgentRoute>;
    try {
      route = selectAgentRoute(
        { ...context, preferredAgent },
        { ...facts, availableBackends: [...candidates] },
      );
    } catch (error) {
      if (!loadedAll && !context.explicitBackend) {
        candidates.clear();
        continue;
      }
      throw error;
    }
    probed.add(route.backend);
    candidates.delete(route.backend);
    try {
      const backend = await registry.getAgentBackend(route.backend);
      if ((await quotaProbe(backend)).status === "available") {
        return {
          ...route,
          fallbackUsed: route.fallbackUsed || probed.size > 1,
        };
      }
    } catch {
      // The next candidate can still satisfy the requested role.
    }
    if (context.explicitBackend) break;
  }
  throw new Error(
    `No available agent backends found for task type: ${context.type}`,
  );
}

export function createAgentPortAdapter(
  options: AgentPortAdapterOptions = {},
): AgentPort {
  return {
    async execute(task) {
      const { dispatchToAgent } = await import("../../utils/agent.js");
      return dispatchToAgent(task);
    },
    selectRoute(context, projectRoot = options.projectRoot ?? process.cwd()) {
      const registry =
        options.registry ??
        new AgentBackendRegistry(new PluginLoader({ projectDir: projectRoot }));
      return selectAvailableRoute(context, projectRoot, registry);
    },
  };
}
