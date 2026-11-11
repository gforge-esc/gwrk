/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getRoutingHistory } from "../../db/plugins.js";
import {
  type BackendQuotaSnapshot,
  type HistoricalBackendStat,
  type RoutingFacts,
  selectAgentRoute,
} from "../../domain/agent-routing.js";
import { classifyTask } from "../../domain/types.js";
import { quotaProbe } from "../../engine/quota.js";
import { AgentBackendRegistry } from "../../plugins/agent-registry.js";
import { PluginLoader } from "../../plugins/loader.js";
import type { AgentPort, RoutingContext } from "../../ports/agent-port.js";
import { QuotaProber, type QuotaReading } from "../../server/quota-prober.js";
import { recordDecision } from "../../server/routing-decisions.js";
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
  getQuotaProber: () => QuotaProber,
) {
  const registered = tryLoadRegistry(projectRoot);
  if (context.requireRegistry && !registered.ok) {
    throw new Error(registered.error.message, { cause: registered.error });
  }
  const agentRegistry = registered.ok ? registered.value : undefined;
  const requestedRoute = {
    explicitBackend: context.explicitBackend,
    explicitModel: context.explicitModel,
    registry: agentRegistry,
  };
  if (context.preview && context.explicitBackend) {
    return selectAgentRoute(context, {
      ...requestedRoute,
      availableBackends: [context.explicitBackend],
    });
  }

  const config = loadConfig(projectRoot);
  const history = context.explicitBackend
    ? []
    : routingHistory(context.type, projectRoot);
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
    ...requestedRoute,
    history,
    fallbackOrder,
    pillarConfig:
      typeof configured === "string"
        ? { [context.type]: configured }
        : undefined,
    defaultBackend:
      context.type === "implement" && !agentRegistry ? "agy" : undefined,
  };
  const restrictToRegistry =
    context.type === "implement" &&
    !context.explicitBackend &&
    agentRegistry !== undefined;
  const candidates = new Set(
    restrictToRegistry
      ? Object.keys(agentRegistry.backends)
      : [
          context.explicitBackend,
          preferredAgent,
          ...history.map(({ backend }) => backend),
          ...(typeof configured === "string" ? [configured] : []),
          facts.defaultBackend,
          ...fallbackOrder,
          ...Object.keys(facts.registry?.backends ?? {}),
        ].filter((backend): backend is string => Boolean(backend)),
  );
  const readings: Record<string, QuotaReading> = {};
  const quotas: Record<string, BackendQuotaSnapshot> = {};
  const cooledDownModels: Record<string, string[]> = {};
  if (agentRegistry) {
    const prober = getQuotaProber();
    for (const backend of Object.values(agentRegistry.backends)) {
      const { name } = backend;
      if (context.explicitBackend && name !== context.explicitBackend) continue;
      const reading = await prober.probeQuota(backend, agentRegistry.backends);
      readings[name] = reading;
      quotas[name] = {
        percent: reading.percent,
        probeStatus:
          reading.status === "timeout-assumed-available"
            ? "optimistic"
            : reading.status === "cached"
              ? "cached"
              : "fresh",
      };
      const models = [
        "default",
        ...backend.models.flatMap((entry) =>
          entry.modelFlag ? [entry.name, entry.modelFlag] : [entry.name],
        ),
        ...(backend.reviewModel
          ? [backend.reviewModel, "review-model-override"]
          : []),
        ...(context.explicitModel ? [context.explicitModel] : []),
      ];
      cooledDownModels[name] = [...new Set(models)].filter((model) =>
        prober.isModelInCooldown(name, model),
      );
    }
  }
  const probed = new Set<string>();
  let loadedAll = restrictToRegistry;
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
        {
          ...facts,
          availableBackends: [...candidates],
          quotas:
            agentRegistry && !context.explicitBackend ? quotas : undefined,
          cooledDownModels,
        },
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
    let available = false;
    try {
      const backend = await registry.getAgentBackend(route.backend);
      available = (await quotaProbe(backend)).status === "available";
    } catch {
      // The next candidate can still satisfy the requested role.
    }
    if (available) {
      const selected = {
        ...route,
        fallbackUsed: route.fallbackUsed || probed.size > 1,
      };
      const { type, preview, runId, feature, phase, taskSP } = context;
      if (type === "implement" && !preview && runId && feature && phase) {
        recordDecision({
          runId,
          feature,
          phase,
          selectedBackend: selected.backend,
          selectedModel: selected.model,
          taskClassification: classifyTask(type),
          reason: selected.reason,
          quotaPercent: selected.quotaPercent,
          probeStatus: readings[selected.backend]?.status ?? "available",
          taskSp: taskSP,
          fallbackUsed: selected.fallbackUsed,
          modelFailoverUsed: selected.modelFailoverUsed,
        });
      }
      return selected;
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
  const quotaProbers = new Map<string, QuotaProber>();
  return {
    async execute(task) {
      const { dispatchToAgent } = await import("../../utils/agent.js");
      return dispatchToAgent(task);
    },
    selectRoute(context, projectRoot = options.projectRoot ?? process.cwd()) {
      const registry =
        options.registry ??
        new AgentBackendRegistry(new PluginLoader({ projectDir: projectRoot }));
      return selectAvailableRoute(context, projectRoot, registry, () => {
        let prober = quotaProbers.get(projectRoot);
        if (!prober) {
          prober = new QuotaProber(projectRoot);
          quotaProbers.set(projectRoot, prober);
        }
        return prober;
      });
    },
  };
}
