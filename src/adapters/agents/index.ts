/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { getBackendSuccessRate, getRoutingHistory } from "../../db/plugins.js";
import {
  type BackendQuotaSnapshot,
  type HistoricalBackendStat,
  type RoutingFacts,
  selectAgentRoute,
} from "../../domain/agent-routing.js";
import { classifyTask } from "../../domain/types.js";
import { quotaProbe } from "../../engine/quota.js";
import type { AgentBackend } from "../../plugins/agent-backend.js";
import { AgentBackendRegistry } from "../../plugins/agent-registry.js";
import { PluginLoader } from "../../plugins/loader.js";
import type { AgentPort, RoutingContext } from "../../ports/agent-port.js";
import { QuotaProber, type QuotaReading } from "../../server/quota-prober.js";
import { recordDecision } from "../../server/routing-decisions.js";
import { loadConfig } from "../../utils/config.js";
import { resolveProjectId } from "../../utils/project-id.js";
import {
  InvalidAgentRegistryError,
  tryLoadRegistry,
} from "./registry-loader.js";

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
    throw new InvalidAgentRegistryError(registered.error.message, {
      cause: registered.error,
    });
  }
  const agentRegistry = registered.ok ? registered.value : undefined;
  const explicitPreview =
    context.preview === true && context.explicitBackend !== undefined;
  const config = loadConfig(projectRoot);
  const quotaFirst = context.historyMode === "quota-tiebreak";
  const installedOnly = context.backendEligibility === "installed";
  const history = context.explicitBackend
    ? []
    : quotaFirst
      ? Object.keys(agentRegistry?.backends ?? {}).map((backend) => ({
          backend,
          runs: 0,
          successRate: getBackendSuccessRate(backend),
        }))
      : routingHistory(context.type, projectRoot);
  const configured = quotaFirst
    ? undefined
    : (config.agents as Record<string, unknown>)?.[context.type];
  const preferredAgent = quotaFirst
    ? undefined
    : (context.preferredAgent ??
      (context.type === "skill" &&
      ["narrative", "signal-cut"].includes(context.skillName ?? "")
        ? "claude"
        : undefined));
  const fallbackOrder = (quotaFirst
    ? agentRegistry?.fallbackOrder
    : config.agents?.fallbackOrder) ?? ["agy", "claude", "codex"];
  const facts: RoutingFacts = {
    explicitBackend: context.explicitBackend,
    explicitModel: context.explicitModel,
    registry: agentRegistry,
    history,
    historyMode: context.historyMode,
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
    context.requireRegistry === true &&
    quotaFirst &&
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
      if (restrictToRegistry) {
        const reading = await prober.probeQuota(
          backend,
          agentRegistry.backends,
        );
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
      }
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
  if (
    restrictToRegistry &&
    Object.values(quotas).every(({ percent }) => percent <= 0)
  ) {
    throw new Error("All backends quota-exhausted. Retry after reset.");
  }

  const registeredCandidates = restrictToRegistry ? [...candidates] : null;
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
          availableBackends: registeredCandidates ?? [...candidates],
          maxBackendAttempts: restrictToRegistry ? 3 : undefined,
          probedUnavailableBackends: restrictToRegistry ? probed : undefined,
          quotas: restrictToRegistry ? quotas : undefined,
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
    let backend: AgentBackend | undefined;
    let available = explicitPreview;
    try {
      backend = await registry.getAgentBackend(route.backend);
      if (!explicitPreview) {
        if (restrictToRegistry && !(await backend.isAvailable())) continue;
        available = installedOnly
          ? await backend.isAvailable()
          : (await quotaProbe(backend)).status === "available";
      }
    } catch {
      // An explicit preview can display the route even if the adapter is missing.
    }
    if (available) {
      const useAdapterModelDefaults =
        context.explicitBackend !== undefined &&
        context.explicitModel === undefined &&
        !agentRegistry?.backends[route.backend];
      const selection = {
        ...route,
        ...(useAdapterModelDefaults && { useAdapterModelDefaults }),
        fallbackUsed: route.fallbackUsed || probed.size > 1,
      };
      if (context.preview) {
        if (!backend?.resolveModel) return selection;
        const adapterModel = backend.resolveModel({
          model: useAdapterModelDefaults ? undefined : route.model,
          env: route.effort ? { GWRK_EFFORT: route.effort } : {},
        });
        return { ...selection, adapterModel: adapterModel ?? null };
      }
      const review =
        context.includeReviewModel && !useAdapterModelDefaults
          ? selectAgentRoute(
              { type: "review" },
              {
                explicitBackend: route.backend,
                availableBackends: [route.backend],
                registry: agentRegistry,
                cooledDownModels,
              },
            )
          : undefined;
      const selected = {
        ...selection,
        ...(review && {
          reviewModel: review.model,
          reviewEffort: review.effort,
        }),
      };
      const { type, runId, feature, phase, taskSP } = context;
      if (type === "implement" && runId && feature && phase) {
        try {
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
        } catch (error) {
          if (!context.explicitBackend) throw error;
        }
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
