/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type AgentRegistry, ModelSelector } from "./agent-config.js";
import { classifyTask } from "./types.js";

export interface BackendQuotaSnapshot {
  readonly percent: number;
  readonly probeStatus: "fresh" | "cached" | "optimistic" | "failed";
}

export interface HistoricalBackendStat {
  readonly backend: string;
  readonly runs: number;
  readonly successRate: number;
}

export interface RoutingFacts {
  readonly explicitBackend?: string;
  readonly explicitModel?: string;
  readonly pillarConfig?: Readonly<Partial<Record<string, string>>>;
  readonly availableBackends?: readonly string[];
  readonly registry?: AgentRegistry;
  readonly quotas?: Readonly<Record<string, BackendQuotaSnapshot>>;
  readonly history?: readonly HistoricalBackendStat[];
  readonly historyMode?: "priority" | "quota-tiebreak";
  readonly maxBackendAttempts?: number;
  readonly cooledDownModels?: Readonly<Record<string, readonly string[]>>;
  readonly defaultBackend?: string;
}

export interface RoutingContext {
  readonly type: string;
  readonly preferredAgent?: string;
  readonly explicitModel?: string;
}

export interface RouteSelectionDecision {
  readonly backend: string;
  readonly model: string;
  readonly mode: "selected" | "provider-default";
  readonly reason: string;
  readonly effort?: string;
  readonly quotaPercent?: number;
  readonly probeStatus?: BackendQuotaSnapshot["probeStatus"];
  readonly fallbackUsed: boolean;
  readonly modelFailoverUsed: boolean;
}

function backendCandidates(
  context: RoutingContext,
  facts: RoutingFacts,
): string[] {
  if (facts.explicitBackend) return [facts.explicitBackend];

  const history = facts.history ?? [];
  const historical =
    facts.historyMode !== "quota-tiebreak" &&
    history.reduce((total, stat) => total + stat.runs, 0) >= 5
      ? history
          .filter((stat) => stat.successRate > 0.7)
          .sort(
            (left, right) =>
              right.successRate - left.successRate || right.runs - left.runs,
          )
          .map((stat) => stat.backend)
      : [];
  const fallback = [
    ...new Set([
      ...(facts.registry?.fallbackOrder ?? []),
      ...(facts.availableBackends ??
        Object.keys(facts.registry?.backends ?? {})),
    ]),
  ];
  if (facts.quotas) {
    const quota = (backend: string) => facts.quotas?.[backend]?.percent ?? 100;
    const rate = (backend: string) =>
      history.find((stat) => stat.backend === backend)?.successRate ?? 0;
    const maxQuota = Math.max(...fallback.map(quota));
    fallback.sort((left, right) => {
      const leftNear = maxQuota - quota(left) <= 20;
      const rightNear = maxQuota - quota(right) <= 20;
      if (leftNear && rightNear && rate(left) !== rate(right))
        return rate(right) - rate(left);
      return quota(right) - quota(left);
    });
  }

  return [
    ...new Set(
      [
        context.preferredAgent,
        ...historical,
        facts.pillarConfig?.[context.type],
        facts.defaultBackend,
        ...fallback,
      ].filter((name): name is string => Boolean(name)),
    ),
  ];
}

export function selectAgentRoute(
  context: RoutingContext,
  facts: RoutingFacts,
): RouteSelectionDecision {
  const requestedModel = facts.explicitModel ?? context.explicitModel;
  const candidates = backendCandidates(context, facts);
  const modelSelector = new ModelSelector();
  const classification = classifyTask(context.type);
  let attempts = 0;

  for (const [index, name] of candidates.entries()) {
    const quota = facts.quotas?.[name];
    if (facts.availableBackends && !facts.availableBackends.includes(name))
      continue;
    if (quota && quota.percent <= 0) continue;

    const backend = facts.registry?.backends[name];
    if (!facts.availableBackends && facts.registry && !backend) continue;
    if (++attempts > (facts.maxBackendAttempts ?? candidates.length)) break;
    const cooldown = new Set(facts.cooledDownModels?.[name] ?? []);
    const modelId = (label: string) =>
      (label === "review-model-override" ? backend?.reviewModel : undefined) ??
      backend?.models.find((entry) => entry.name === label)?.modelFlag ??
      label;
    const unavailable = (label: string) =>
      cooldown.has(label) || cooldown.has(modelId(label));

    if (requestedModel) {
      const providerDefault = requestedModel === "default";
      const entry = providerDefault
        ? undefined
        : backend?.models.find(
            (model) =>
              model.name === requestedModel ||
              model.modelFlag === requestedModel,
          );
      // An explicit request may use an unlisted provider ID on the selected
      // backend. Changing backend requires evidence it supports the same ID.
      if (
        (index > 0 && !entry && !providerDefault) ||
        unavailable(entry?.name ?? requestedModel)
      )
        continue;
      return {
        backend: name,
        model: entry?.modelFlag || requestedModel,
        mode: providerDefault ? "provider-default" : "selected",
        effort: entry?.effort,
        reason: "explicit model",
        quotaPercent: quota?.percent,
        probeStatus: quota?.probeStatus,
        fallbackUsed: index > 0,
        modelFailoverUsed: false,
      };
    }

    const selected = backend
      ? modelSelector.selectModel(backend, classification, context.type, {
          isModelInCooldown: (_backend, model) => unavailable(model),
        })
      : { model: null, modelFailoverUsed: false };
    if (backend && !selected.model) continue;
    const model =
      selected.model?.modelFlag || selected.model?.name || "default";
    if (model === "default" && unavailable(model)) continue;
    return {
      backend: name,
      model,
      mode: model === "default" ? "provider-default" : "selected",
      effort: selected.model?.effort,
      reason:
        model === "default"
          ? "provider default"
          : `${selected.model?.tier} tier`,
      quotaPercent: quota?.percent,
      probeStatus: quota?.probeStatus,
      fallbackUsed: index > 0,
      modelFailoverUsed: selected.modelFailoverUsed,
    };
  }

  const modelHint = requestedModel ? ` for model ${requestedModel}` : "";
  const backendHint = facts.explicitBackend
    ? ` on ${facts.explicitBackend}`
    : "";
  throw new Error(
    `No available agent route for ${context.type}${modelHint}${backendHint}.`,
  );
}
