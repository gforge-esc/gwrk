/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import {
  type DiscoverySnapshot,
  type ModelCandidate,
  type ModelRole,
  type RunnerScope,
  assertNoSecretMaterial,
  checkCandidate,
  eligibleRoutesDigest,
  isConcreteModel,
  qualificationStaleness,
} from "../../domain/model-qualification.js";
import type {
  QualificationRunnerPort,
  RouteLockStorePort,
} from "../../ports/model-qualification-port.js";
import {
  type PromotionReplayEvidence,
  evaluateModelPromotion,
} from "./evaluate-models.js";
import type { PinnedRoleRoute, RouteLockDocument } from "./promote-model.js";

export type RouteMode = "pinned" | "provider-default";

export type RouteResolutionStatus =
  | "pinned"
  | "provider-default"
  | "stale"
  | "unavailable_pin";

export interface RouteFallbackCandidate {
  readonly backend: string;
  readonly provider: string;
  readonly family: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly evaluationId: string;
}

export interface FallbackQualificationRecord {
  readonly evaluationId: string;
  readonly role: ModelRole;
  readonly scope: RunnerScope;
  readonly backend: string;
  readonly provider?: string;
  readonly family?: string;
  readonly modelId: string;
  readonly effort?: string;
  readonly passed: boolean;
}

export interface SuiteDigestSnapshot {
  readonly fixtureSuiteHash: string;
  readonly workflowPromptHashes: Readonly<Record<string, string>>;
}

export interface UnavailableRouteTarget {
  readonly backend: string;
  readonly modelId: string;
  readonly effort?: string;
}

export interface ResolveQualifiedRouteInput {
  readonly role: ModelRole;
  readonly scope: RunnerScope;
  readonly routeLock?: RouteLockDocument | null;
  readonly snapshot?: DiscoverySnapshot | null;
  readonly currentSuiteHashes?: SuiteDigestSnapshot | null;
  readonly pinnedEligibleRoutesDigest?: string;
  readonly requestedBackend?: string;
  readonly requestedModel?: string;
  readonly requestedEffort?: string;
  readonly routeMode?: RouteMode;
  readonly unavailableBackends?: readonly string[];
  readonly unavailableRoutes?: readonly UnavailableRouteTarget[];
  readonly qualifiedFallbacks?: readonly FallbackQualificationRecord[];
  readonly defaultBackend?: string;
  readonly defaultModel?: string;
  readonly primaryFailureReason?: string;
}

export interface ResolvedModelRoute {
  readonly status: RouteResolutionStatus;
  readonly role: ModelRole;
  readonly routeMode: RouteMode;
  readonly backend: string;
  readonly provider?: string;
  readonly family?: string;
  readonly model: string | undefined;
  readonly requestedModel: string;
  readonly effort?: string;
  readonly evaluationId?: string;
  readonly usedFallback: boolean;
  readonly fallbackReason?: string;
  readonly fallbackRoutes: readonly RouteFallbackCandidate[];
  readonly stalenessReasons: readonly string[];
  readonly diagnostic?: string;
}

export interface ResolveRouteDeps {
  readonly store: RouteLockStorePort;
  readonly runner?: Pick<QualificationRunnerPort, "computeSuiteHashes">;
}

export type ResolveRouteFromStoreInput = Omit<
  ResolveQualifiedRouteInput,
  | "routeLock"
  | "snapshot"
  | "currentSuiteHashes"
  | "qualifiedFallbacks"
  | "pinnedEligibleRoutesDigest"
>;

interface StoredEvaluationSummary {
  readonly evaluationId?: unknown;
  readonly role?: unknown;
  readonly scope?: {
    readonly workspaceId?: unknown;
    readonly runnerProfile?: unknown;
    readonly platform?: unknown;
    readonly arch?: unknown;
  };
  readonly candidate?: Partial<ModelCandidate>;
  readonly eligibleRoutesDigest?: unknown;
  readonly promotionEvidence?: PromotionReplayEvidence;
}

const EVALUATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function normalizeOptional(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sameRouteKey(
  a: {
    readonly backend: string;
    readonly modelId: string;
    readonly effort?: string;
  },
  b: {
    readonly backend: string;
    readonly modelId: string;
    readonly effort?: string;
  },
): boolean {
  return (
    a.backend === b.backend &&
    a.modelId === b.modelId &&
    normalizeOptional(a.effort) === normalizeOptional(b.effort)
  );
}

function isRouteUnavailable(
  route: {
    readonly backend: string;
    readonly modelId: string;
    readonly effort?: string;
  },
  unavailableBackends?: readonly string[],
  unavailableRoutes?: readonly UnavailableRouteTarget[],
): boolean {
  if (unavailableBackends?.includes(route.backend)) {
    return true;
  }
  if (unavailableRoutes?.some((target) => sameRouteKey(target, route))) {
    return true;
  }
  return false;
}

function matchesScope(
  a: { readonly workspaceId: string; readonly runnerProfile: string },
  b: { readonly workspaceId: string; readonly runnerProfile: string },
): boolean {
  return a.workspaceId === b.workspaceId && a.runnerProfile === b.runnerProfile;
}

function filterQualifiedFallbacks(
  pin: PinnedRoleRoute,
  role: ModelRole,
  scope: RunnerScope,
  snapshot: DiscoverySnapshot | null | undefined,
  qualifiedFallbacks: readonly FallbackQualificationRecord[] | undefined,
): RouteFallbackCandidate[] {
  if (!Array.isArray(pin.fallbackRoutes) || pin.fallbackRoutes.length === 0) {
    return [];
  }

  const eligible: RouteFallbackCandidate[] = [];
  for (const fallback of pin.fallbackRoutes) {
    if (
      !fallback ||
      typeof fallback.evaluationId !== "string" ||
      !EVALUATION_ID_RE.test(fallback.evaluationId) ||
      !isConcreteModel(fallback.modelId)
    ) {
      continue;
    }

    if (sameRouteKey(fallback, pin)) {
      continue;
    }

    if (eligible.some((existing) => sameRouteKey(existing, fallback))) {
      continue;
    }

    if (snapshot) {
      const check = checkCandidate(snapshot, scope, {
        backend: fallback.backend,
        provider: fallback.provider,
        family: fallback.family,
        modelId: fallback.modelId,
        effort: fallback.effort,
      });
      if (!check.ok) {
        continue;
      }
    }

    const verified = qualifiedFallbacks?.some(
      (record) =>
        record.passed === true &&
        record.evaluationId === fallback.evaluationId &&
        record.role === role &&
        matchesScope(record.scope, scope) &&
        record.scope.platform === scope.platform &&
        record.scope.arch === scope.arch &&
        sameRouteKey(record, fallback) &&
        (record.provider === undefined ||
          record.provider === fallback.provider) &&
        (record.family === undefined || record.family === fallback.family),
    );
    if (!verified) {
      continue;
    }

    eligible.push(fallback);
  }

  return eligible;
}

export function resolveQualifiedRoute(
  input: ResolveQualifiedRouteInput,
): ResolvedModelRoute {
  const route = selectQualifiedRoute(input);
  if (
    route.status === "pinned" &&
    ((input.requestedModel && input.requestedModel !== route.model) ||
      (input.requestedEffort && input.requestedEffort !== route.effort))
  ) {
    return {
      ...route,
      status: "unavailable_pin",
      model: undefined,
      fallbackReason: "unavailable_pin",
      diagnostic:
        "The requested model or effort differs from the qualified route.",
    };
  }
  return route;
}

function selectQualifiedRoute(
  input: ResolveQualifiedRouteInput,
): ResolvedModelRoute {
  const requestedBackend = normalizeOptional(input.requestedBackend);
  const requestedModel = normalizeOptional(input.requestedModel);
  const requestedEffort = normalizeOptional(input.requestedEffort);
  const defaultBackend = normalizeOptional(input.defaultBackend) ?? "";
  const defaultModel = normalizeOptional(input.defaultModel);

  if (input.routeLock) {
    assertNoSecretMaterial(input.routeLock);
  }

  const scopeMatchesLock =
    input.routeLock !== null &&
    input.routeLock !== undefined &&
    matchesScope(input.routeLock, input.scope);
  const pin = scopeMatchesLock
    ? input.routeLock?.routes?.[input.role]
    : undefined;

  if (input.routeMode === "provider-default") {
    const backend = requestedBackend ?? pin?.backend ?? defaultBackend;
    return {
      status: "provider-default",
      role: input.role,
      routeMode: "provider-default",
      backend,
      ...(pin && pin.backend === backend
        ? { provider: pin.provider, family: pin.family }
        : {}),
      model: undefined,
      requestedModel: "provider-default",
      ...(requestedEffort ? { effort: requestedEffort } : {}),
      usedFallback: false,
      fallbackRoutes: [],
      stalenessReasons: [],
    };
  }

  if (!input.routeLock) {
    if (input.routeMode === "pinned") {
      const backend = requestedBackend ?? defaultBackend;
      return {
        status: "unavailable_pin",
        role: input.role,
        routeMode: "pinned",
        backend,
        model: undefined,
        requestedModel: "unavailable",
        usedFallback: false,
        fallbackReason: "unavailable_pin",
        fallbackRoutes: [],
        stalenessReasons: [],
        diagnostic: `No route lock exists for runner '${input.scope.runnerProfile}'.`,
      };
    }

    const backend = requestedBackend ?? defaultBackend;
    const model = requestedModel ?? defaultModel;
    return {
      status: "provider-default",
      role: input.role,
      routeMode: "provider-default",
      backend,
      model,
      requestedModel: model ?? "provider-default",
      ...(requestedEffort ? { effort: requestedEffort } : {}),
      usedFallback: false,
      fallbackRoutes: [],
      stalenessReasons: [],
    };
  }

  if (!scopeMatchesLock) {
    const backend = requestedBackend ?? defaultBackend;
    return {
      status: "unavailable_pin",
      role: input.role,
      routeMode: "pinned",
      backend,
      model: undefined,
      requestedModel: "unavailable",
      usedFallback: false,
      fallbackReason: "runner-mismatch",
      fallbackRoutes: [],
      stalenessReasons: [],
      diagnostic: `Route lock scope '${input.routeLock.workspaceId}/${input.routeLock.runnerProfile}' does not match '${input.scope.workspaceId}/${input.scope.runnerProfile}'.`,
    };
  }

  if (!pin || pin.role !== input.role) {
    const backend = requestedBackend ?? defaultBackend;
    return {
      status: "unavailable_pin",
      role: input.role,
      routeMode: "pinned",
      backend,
      model: undefined,
      requestedModel: "unavailable",
      usedFallback: false,
      fallbackReason: "unavailable_pin",
      fallbackRoutes: [],
      stalenessReasons: [],
      diagnostic: `No qualified route is pinned for role '${input.role}' on runner '${input.scope.runnerProfile}'.`,
    };
  }

  const currentHashes = input.currentSuiteHashes;
  if (!currentHashes) {
    return {
      status: "stale",
      role: input.role,
      routeMode: pin.routeMode,
      backend: pin.backend,
      model: undefined,
      requestedModel: pin.modelId,
      usedFallback: false,
      fallbackRoutes: [],
      fallbackReason: "stale_pin",
      stalenessReasons: [],
      diagnostic:
        "Current qualification fingerprints are missing. Requalification is required.",
    };
  }

  if (pin.routeMode === "provider-default") {
    if (requestedBackend && requestedBackend !== pin.backend) {
      return {
        status: "unavailable_pin",
        role: input.role,
        routeMode: "pinned",
        backend: requestedBackend,
        model: undefined,
        requestedModel: "unavailable",
        usedFallback: false,
        fallbackReason: "unavailable_pin",
        fallbackRoutes: [],
        stalenessReasons: [],
        diagnostic: `Backend '${requestedBackend}' has no qualified pin for role '${input.role}' on runner '${input.scope.runnerProfile}'.`,
      };
    }

    const stalenessReasons = qualificationStaleness(
      {
        fixtureSuiteHash: pin.evidence.fixtureSuiteHash,
        workflowPromptHashes: pin.evidence.workflowPromptHashes,
        cliVersion: pin.toolVersions.cliVersion,
        adapterVersion: pin.toolVersions.adapterVersion,
        eligibleRoutesDigest: "",
      },
      {
        fixtureSuiteHash: currentHashes.fixtureSuiteHash,
        workflowPromptHashes: currentHashes.workflowPromptHashes,
        cliVersion: pin.toolVersions.cliVersion,
        adapterVersion: pin.toolVersions.adapterVersion,
        eligibleRoutesDigest: "",
      },
      true,
    );

    if (stalenessReasons.length > 0) {
      return {
        status: "stale",
        role: input.role,
        routeMode: "provider-default",
        backend: pin.backend,
        provider: pin.provider,
        family: pin.family,
        model: undefined,
        requestedModel: "provider-default",
        evaluationId: pin.evidence.evaluationId,
        usedFallback: false,
        fallbackReason: "stale_pin",
        fallbackRoutes: [],
        stalenessReasons,
        diagnostic: `Route lock for role '${input.role}' is stale (${stalenessReasons.join(", ")}) and requires requalification.`,
      };
    }

    return {
      status: "provider-default",
      role: input.role,
      routeMode: "provider-default",
      backend: pin.backend,
      provider: pin.provider,
      family: pin.family,
      model: undefined,
      requestedModel: "provider-default",
      ...(requestedEffort ? { effort: requestedEffort } : {}),
      evaluationId: pin.evidence.evaluationId,
      usedFallback: false,
      fallbackRoutes: [],
      stalenessReasons: [],
    };
  }

  const adapterReport = input.snapshot?.adapters.find(
    (adapter) => adapter.backend === pin.backend,
  );
  const currentCliVersion = input.snapshot
    ? (adapterReport?.cliVersion ?? "")
    : pin.toolVersions.cliVersion;
  const currentAdapterVersion = input.snapshot
    ? (adapterReport?.adapterVersion ?? "")
    : pin.toolVersions.adapterVersion;
  const pinnedDigest = input.pinnedEligibleRoutesDigest ?? "";
  const currentDigest =
    input.snapshot && input.pinnedEligibleRoutesDigest !== undefined
      ? eligibleRoutesDigest(input.snapshot, input.scope)
      : pinnedDigest;
  const modelAvailable = input.snapshot
    ? isConcreteModel(pin.modelId) &&
      checkCandidate(input.snapshot, input.scope, {
        backend: pin.backend,
        provider: pin.provider,
        family: pin.family,
        modelId: pin.modelId,
        effort: pin.effort,
      }).ok
    : false;

  const stalenessReasons = qualificationStaleness(
    {
      fixtureSuiteHash: pin.evidence.fixtureSuiteHash,
      workflowPromptHashes: pin.evidence.workflowPromptHashes,
      cliVersion: pin.toolVersions.cliVersion,
      adapterVersion: pin.toolVersions.adapterVersion,
      eligibleRoutesDigest: pinnedDigest,
    },
    {
      fixtureSuiteHash: currentHashes.fixtureSuiteHash,
      workflowPromptHashes: currentHashes.workflowPromptHashes,
      cliVersion: currentCliVersion,
      adapterVersion: currentAdapterVersion,
      eligibleRoutesDigest: currentDigest,
    },
    modelAvailable,
  );

  if (stalenessReasons.length > 0) {
    return {
      status: "stale",
      role: input.role,
      routeMode: "pinned",
      backend: requestedBackend ?? pin.backend,
      provider: pin.provider,
      family: pin.family,
      model: undefined,
      requestedModel: pin.modelId,
      ...(pin.effort ? { effort: pin.effort } : {}),
      evaluationId: pin.evidence.evaluationId,
      usedFallback: false,
      fallbackReason: "stale_pin",
      fallbackRoutes: [],
      stalenessReasons,
      diagnostic: `Pinned route for role '${input.role}' is stale (${stalenessReasons.join(", ")}) and requires requalification.`,
    };
  }

  const qualifiedFallbacks = filterQualifiedFallbacks(
    pin,
    input.role,
    input.scope,
    input.snapshot,
    input.qualifiedFallbacks,
  );

  const primaryUnavailable = isRouteUnavailable(
    pin,
    input.unavailableBackends,
    input.unavailableRoutes,
  );

  if (requestedBackend) {
    if (requestedBackend === pin.backend && !primaryUnavailable) {
      return {
        status: "pinned",
        role: input.role,
        routeMode: "pinned",
        backend: pin.backend,
        provider: pin.provider,
        family: pin.family,
        model: pin.modelId,
        requestedModel: pin.modelId,
        ...(pin.effort ? { effort: pin.effort } : {}),
        evaluationId: pin.evidence.evaluationId,
        usedFallback: false,
        fallbackRoutes: qualifiedFallbacks,
        stalenessReasons: [],
      };
    }

    const matchingFallback = qualifiedFallbacks.find(
      (candidate) =>
        candidate.backend === requestedBackend &&
        !isRouteUnavailable(
          candidate,
          input.unavailableBackends,
          input.unavailableRoutes,
        ),
    );

    if (matchingFallback) {
      const reason =
        requestedBackend === pin.backend
          ? (normalizeOptional(input.primaryFailureReason) ??
            "primary_unavailable")
          : "explicit_backend_pin";
      return {
        status: "pinned",
        role: input.role,
        routeMode: "pinned",
        backend: matchingFallback.backend,
        provider: matchingFallback.provider,
        family: matchingFallback.family,
        model: matchingFallback.modelId,
        requestedModel: matchingFallback.modelId,
        ...(matchingFallback.effort ? { effort: matchingFallback.effort } : {}),
        evaluationId: matchingFallback.evaluationId,
        usedFallback: true,
        fallbackReason: reason,
        fallbackRoutes: qualifiedFallbacks.filter(
          (candidate) => !sameRouteKey(candidate, matchingFallback),
        ),
        stalenessReasons: [],
      };
    }

    return {
      status: "unavailable_pin",
      role: input.role,
      routeMode: "pinned",
      backend: requestedBackend,
      model: undefined,
      requestedModel: "unavailable",
      usedFallback: false,
      fallbackReason:
        requestedBackend === pin.backend && primaryUnavailable
          ? (normalizeOptional(input.primaryFailureReason) ?? "unavailable_pin")
          : "unavailable_pin",
      fallbackRoutes: [],
      stalenessReasons: [],
      diagnostic: `Backend '${requestedBackend}' has no qualified pin for role '${input.role}' on runner '${input.scope.runnerProfile}'.`,
    };
  }

  if (!primaryUnavailable) {
    return {
      status: "pinned",
      role: input.role,
      routeMode: "pinned",
      backend: pin.backend,
      provider: pin.provider,
      family: pin.family,
      model: pin.modelId,
      requestedModel: pin.modelId,
      ...(pin.effort ? { effort: pin.effort } : {}),
      evaluationId: pin.evidence.evaluationId,
      usedFallback: false,
      fallbackRoutes: qualifiedFallbacks,
      stalenessReasons: [],
    };
  }

  const nextFallback = qualifiedFallbacks.find(
    (candidate) =>
      !isRouteUnavailable(
        candidate,
        input.unavailableBackends,
        input.unavailableRoutes,
      ),
  );

  if (nextFallback) {
    return {
      status: "pinned",
      role: input.role,
      routeMode: "pinned",
      backend: nextFallback.backend,
      provider: nextFallback.provider,
      family: nextFallback.family,
      model: nextFallback.modelId,
      requestedModel: nextFallback.modelId,
      ...(nextFallback.effort ? { effort: nextFallback.effort } : {}),
      evaluationId: nextFallback.evaluationId,
      usedFallback: true,
      fallbackReason:
        normalizeOptional(input.primaryFailureReason) ?? "primary_unavailable",
      fallbackRoutes: qualifiedFallbacks.filter(
        (candidate) => !sameRouteKey(candidate, nextFallback),
      ),
      stalenessReasons: [],
    };
  }

  return {
    status: "unavailable_pin",
    role: input.role,
    routeMode: "pinned",
    backend: pin.backend,
    provider: pin.provider,
    family: pin.family,
    model: undefined,
    requestedModel: pin.modelId,
    ...(pin.effort ? { effort: pin.effort } : {}),
    evaluationId: pin.evidence.evaluationId,
    usedFallback: false,
    fallbackReason:
      normalizeOptional(input.primaryFailureReason) ?? "unavailable_pin",
    fallbackRoutes: [],
    stalenessReasons: [],
    diagnostic: `Primary pin and all qualified fallbacks are unavailable for role '${input.role}' on runner '${input.scope.runnerProfile}'.`,
  };
}

export function parseStoredFallbackQualification(
  rawBundle: unknown,
  fallback: RouteFallbackCandidate,
  role: ModelRole,
  scope: RunnerScope,
): FallbackQualificationRecord | null {
  if (!rawBundle || typeof rawBundle !== "object") return null;
  assertNoSecretMaterial(rawBundle);
  const bundle = rawBundle as StoredEvaluationSummary;
  if (
    bundle.evaluationId !== fallback.evaluationId ||
    bundle.role !== role ||
    !bundle.scope ||
    typeof bundle.scope.workspaceId !== "string" ||
    typeof bundle.scope.runnerProfile !== "string" ||
    typeof bundle.scope.platform !== "string" ||
    typeof bundle.scope.arch !== "string" ||
    bundle.scope.workspaceId !== scope.workspaceId ||
    bundle.scope.runnerProfile !== scope.runnerProfile ||
    !bundle.candidate ||
    typeof bundle.candidate.backend !== "string" ||
    typeof bundle.candidate.modelId !== "string" ||
    bundle.candidate.provider !== fallback.provider ||
    bundle.candidate.family !== fallback.family ||
    !bundle.promotionEvidence
  ) {
    return null;
  }

  const replay = evaluateModelPromotion(bundle.promotionEvidence);
  return {
    evaluationId: fallback.evaluationId,
    role,
    scope: {
      workspaceId: bundle.scope.workspaceId,
      runnerProfile: bundle.scope.runnerProfile,
      platform: bundle.scope.platform,
      arch: bundle.scope.arch,
    },
    backend: bundle.candidate.backend,
    provider: bundle.candidate.provider,
    family: bundle.candidate.family,
    modelId: bundle.candidate.modelId,
    effort: bundle.candidate.effort,
    passed: replay.promote === true,
  };
}

export async function resolveQualifiedRouteFromStore(
  deps: ResolveRouteDeps,
  input: ResolveRouteFromStoreInput,
): Promise<ResolvedModelRoute> {
  if (input.routeMode === "provider-default")
    return resolveQualifiedRoute(input);
  const activeLock = await deps.store.readRouteLock(input.scope);
  if (!activeLock) return resolveQualifiedRoute(input);
  const routeLock = activeLock.document as RouteLockDocument;
  const [snapshot, currentSuiteHashes] = await Promise.all([
    deps.store.readDiscoverySnapshot(input.scope),
    deps.runner?.computeSuiteHashes(),
  ]);
  const pin = routeLock?.routes?.[input.role];

  let pinnedEligibleRoutesDigest: string | undefined;
  let qualifiedFallbacks: FallbackQualificationRecord[] | undefined;

  if (pin) {
    try {
      const primaryBundle = (await deps.store.readEvaluationBundle(
        pin.evidence.evaluationId,
      )) as StoredEvaluationSummary | null;
      if (
        primaryBundle &&
        typeof primaryBundle.eligibleRoutesDigest === "string" &&
        primaryBundle.eligibleRoutesDigest.trim().length > 0
      ) {
        pinnedEligibleRoutesDigest = primaryBundle.eligibleRoutesDigest;
      }
    } catch {
      // Primary bundle may be absent on a clean checkout with only the git-tracked route lock.
    }

    if (Array.isArray(pin.fallbackRoutes) && pin.fallbackRoutes.length > 0) {
      qualifiedFallbacks = [];
      for (const fallback of pin.fallbackRoutes) {
        try {
          const bundle = await deps.store.readEvaluationBundle(
            fallback.evaluationId,
          );
          const record = parseStoredFallbackQualification(
            bundle,
            fallback,
            input.role,
            input.scope,
          );
          if (record) {
            qualifiedFallbacks.push(record);
          }
        } catch {
          // Missing or unreadable fallback evaluation bundle cannot qualify a fallback route.
        }
      }
    }
  }

  return resolveQualifiedRoute({
    ...input,
    routeLock,
    snapshot,
    currentSuiteHashes,
    pinnedEligibleRoutesDigest,
    qualifiedFallbacks,
  });
}

export function formatRoutePreflightBanner(route: ResolvedModelRoute): string {
  const details: string[] = [];
  if (route.effort) {
    details.push(`effort=${route.effort}`);
  }
  details.push(`mode=${route.routeMode}`);
  if (route.usedFallback && route.fallbackReason) {
    details.push(`fallback=${route.fallbackReason}`);
  } else if (route.status === "stale") {
    details.push(
      `status=stale${route.stalenessReasons.length > 0 ? `: ${route.stalenessReasons.join(", ")}` : ""}`,
    );
  } else if (route.status === "unavailable_pin") {
    details.push("status=unavailable_pin");
  } else if (route.fallbackRoutes.length > 0) {
    const next = route.fallbackRoutes[0];
    details.push(
      `fallback=${next.backend}/${next.modelId}${next.effort ? `:${next.effort}` : ""}`,
    );
  }

  const displayedModel =
    route.routeMode === "provider-default"
      ? (route.model ?? "provider-default")
      : (route.model ?? route.requestedModel ?? "unavailable");

  return `Route [${route.role}]: ${route.backend || "unconfigured"} / ${displayedModel} (${details.join(", ")})`;
}
