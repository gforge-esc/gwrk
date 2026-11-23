/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import type { RouteLockDocument } from "../application/models/promote-model.js";
import {
  type FallbackQualificationRecord,
  type ResolvedModelRoute,
  type RouteFallbackCandidate,
  type RouteMode,
  type SuiteDigestSnapshot,
  formatRoutePreflightBanner,
  resolveQualifiedRoute,
} from "../application/models/resolve-route.js";
import {
  type DiscoverySnapshot,
  type ModelRole,
  type RunnerScope,
  assertNoSecretMaterial,
} from "../domain/model-qualification.js";
import { loadConfig } from "./config.js";
import { resolveModelForTask } from "./resolve-model.js";

/**
 * The two agent slots `.gwrkrc.json` declares under `agents`.
 *
 * `define` covers the definition pillar (spec, plan, tasks, tests, research,
 * ontology, adr, analyze). `implement` covers ship and implement.
 */
export type AgentPillar = "define" | "implement";

export interface ResolveAgentOverrides {
  agent?: string;
  model?: string;
  effort?: string;
  role?: ModelRole;
  routeMode?: RouteMode;
  runnerProfile?: string;
  routeLock?: RouteLockDocument | null;
  snapshot?: DiscoverySnapshot | null;
  currentSuiteHashes?: SuiteDigestSnapshot | null;
  unavailableBackends?: readonly string[];
  primaryFailureReason?: string;
  qualifiedFallbacks?: readonly FallbackQualificationRecord[];
}

export interface ResolvedAgent {
  /** The backend to dispatch to. Always a value; config supplies a default. */
  backend: string;
  /** The model the registry picked, or undefined to let the dispatcher choose. */
  model: string | undefined;
  /** Effort selected by the active route lock or override. */
  effort?: string;
  /** Active route mode ("pinned" or "provider-default"). */
  routeMode?: RouteMode;
  /** Qualification role resolved for this command. */
  role?: ModelRole;
  /** Route resolution status reported by resolve-route. */
  routeStatus?: ResolvedModelRoute["status"];
  /** Reason a qualified fallback or diagnostic was triggered. */
  fallbackReason?: string;
  /** Qualified fallback routes available for this role and runner. */
  fallbackRoutes?: readonly RouteFallbackCandidate[];
  /** Staleness reasons when the pinned route requires requalification. */
  stalenessReasons?: readonly string[];
  /** Human-readable diagnostic for unavailable or stale pins. */
  diagnostic?: string;
  /** Preflight banner displaying role, backend, model, effort and fallback. */
  preflightBanner?: string;
}

const RUNNER_PROFILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function readJsonSafely<T>(filePath: string): T | null {
  try {
    const info = fs.lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    assertNoSecretMaterial(parsed);
    return parsed;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

function readLocalRouteLock(
  projectRoot: string,
  runnerProfile: string,
): RouteLockDocument | null {
  if (!RUNNER_PROFILE_RE.test(runnerProfile)) return null;
  return readJsonSafely<RouteLockDocument>(
    path.join(
      projectRoot,
      ".gwrk",
      "models",
      `route-lock.${runnerProfile}.json`,
    ),
  );
}

function readLocalDiscoverySnapshot(
  projectRoot: string,
  runnerProfile: string,
): DiscoverySnapshot | null {
  if (!RUNNER_PROFILE_RE.test(runnerProfile)) return null;
  return readJsonSafely<DiscoverySnapshot>(
    path.join(
      projectRoot,
      ".runs",
      "models",
      "discovery",
      `${runnerProfile}.json`,
    ),
  );
}

function buildRunnerScope(
  config: { project?: string | { name?: string } },
  runnerProfile?: string,
): RunnerScope {
  const workspaceId =
    process.env.GWRK_WORKSPACE_ID ||
    (typeof config.project === "string"
      ? config.project
      : config.project?.name) ||
    "local";
  return {
    workspaceId,
    runnerProfile: runnerProfile || process.env.GWRK_RUNNER_PROFILE || "local",
    platform: process.platform,
    arch: process.arch,
  };
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
  overrides: ResolveAgentOverrides = {},
): ResolvedAgent {
  const config = loadConfig(projectRoot);
  const configuredBackend = pillarBackend(config, pillar);
  const backend = pillarBackend(config, pillar, overrides.agent);
  const role: ModelRole = overrides.role ?? pillar;
  const scope = buildRunnerScope(config, overrides.runnerProfile);

  const routeLock =
    overrides.routeLock !== undefined
      ? overrides.routeLock
      : readLocalRouteLock(projectRoot, scope.runnerProfile);
  const snapshot =
    overrides.snapshot !== undefined
      ? overrides.snapshot
      : routeLock
        ? readLocalDiscoverySnapshot(projectRoot, scope.runnerProfile)
        : null;

  // Projects without a registry use the provider default.
  const agents = config.agents as {
    registry?: Record<string, unknown>;
    fallbackOrder?: string[];
  };
  const hasRegistry = Boolean(agents.registry && agents.fallbackOrder);
  const fallbackModel =
    overrides.model ||
    (!routeLock && overrides.routeMode !== "provider-default" && hasRegistry
      ? resolveModelForTask(role, backend, projectRoot)
      : undefined);

  const route = resolveQualifiedRoute({
    role,
    scope,
    routeLock,
    snapshot,
    currentSuiteHashes: overrides.currentSuiteHashes,
    requestedBackend: overrides.agent || undefined,
    requestedModel: overrides.model || undefined,
    requestedEffort: overrides.effort,
    routeMode: overrides.routeMode,
    unavailableBackends: overrides.unavailableBackends,
    primaryFailureReason: overrides.primaryFailureReason,
    qualifiedFallbacks: overrides.qualifiedFallbacks,
    defaultBackend: configuredBackend,
    defaultModel: fallbackModel,
  });

  const resolvedBackend = route.backend || backend;
  const resolvedModel =
    route.routeMode === "provider-default"
      ? route.model
      : overrides.model || route.model;

  return {
    backend: resolvedBackend,
    model: resolvedModel,
    ...(route.effort ? { effort: route.effort } : {}),
    routeMode: route.routeMode,
    role: route.role,
    routeStatus: route.status,
    ...(route.fallbackReason ? { fallbackReason: route.fallbackReason } : {}),
    ...(route.fallbackRoutes.length > 0
      ? { fallbackRoutes: route.fallbackRoutes }
      : {}),
    ...(route.stalenessReasons.length > 0
      ? { stalenessReasons: route.stalenessReasons }
      : {}),
    ...(route.diagnostic ? { diagnostic: route.diagnostic } : {}),
    preflightBanner: formatRoutePreflightBanner({
      ...route,
      backend: resolvedBackend,
      model: resolvedModel,
    }),
  };
}

/**
 * Resolve a qualification role (`define`, `implement`, `review`) through the
 * centralized config and route-lock resolver.
 */
export function resolveRoleAgent(
  role: ModelRole,
  projectRoot: string,
  overrides: Omit<ResolveAgentOverrides, "role"> = {},
): ResolvedAgent {
  const pillar: AgentPillar = role === "define" ? "define" : "implement";
  return resolveAgent(pillar, projectRoot, { ...overrides, role });
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
