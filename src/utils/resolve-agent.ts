/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseRouteLockDocument } from "../adapters/models/route-lock-store.js";
import type { RouteLockDocument } from "../application/models/promote-model.js";
import {
  type FallbackQualificationRecord,
  type ResolvedModelRoute,
  type RouteFallbackCandidate,
  type RouteMode,
  type SuiteDigestSnapshot,
  formatRoutePreflightBanner,
  parseStoredFallbackQualification,
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
  requestedModel?: string;
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
    const info = fs.lstatSync(filePath, { throwIfNoEntry: false });
    if (!info) return null;
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Invalid model storage file");
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Invalid model storage document");
    }
    assertNoSecretMaterial(parsed);
    return parsed;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? (error as { code?: string }).code
        : undefined;
    if (code === "ENOENT") return null;
    throw error;
  }
}

function readLocalRouteLock(
  projectRoot: string,
  runnerProfile: string,
): RouteLockDocument | null {
  if (!RUNNER_PROFILE_RE.test(runnerProfile))
    throw new Error("Invalid runner profile");
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
  if (!RUNNER_PROFILE_RE.test(runnerProfile))
    throw new Error("Invalid runner profile");
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

// The CLI resolver is synchronous. Render the qualification suite in a bounded
// process so its filesystem effects use the selected checkout, including under worktrees.
function readCurrentSuiteHashes(projectRoot: string): SuiteDigestSnapshot {
  let directory = path.resolve(projectRoot);
  let fixturesDir = process.env.GWRK_FIXTURES_DIR;
  if (!fixturesDir || !fs.existsSync(fixturesDir)) {
    while (
      !fs.existsSync(
        path.join(directory, "tests/fixtures/model-qualification/suite.json"),
      )
    ) {
      const parent = path.dirname(directory);
      if (parent === directory)
        throw new Error(
          "Cannot verify pin: qualification fixture suite missing.",
        );
      directory = parent;
    }
    fixturesDir = path.join(directory, "tests/fixtures/model-qualification");
  }
  const source = import.meta.url.endsWith(".ts");
  const runner = new URL(
    `../adapters/models/fixture-runner.${source ? "ts" : "js"}`,
    import.meta.url,
  );
  const program = [
    "const { FixtureRunner } = await import(process.argv[1]);",
    "const hashes = await new FixtureRunner({ fixturesDir: process.argv[2] }).computeSuiteHashes();",
    "process.stdout.write(JSON.stringify(hashes));",
  ].join("\n");
  const output = execFileSync(
    process.execPath,
    [
      ...(source
        ? [
            "--import",
            pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
          ]
        : []),
      "--input-type=module",
      "--eval",
      program,
      runner.href,
      path.resolve(fixturesDir),
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(output) as SuiteDigestSnapshot;
}

export function resolveWorkflowPin(
  role: ModelRole,
  projectRoot: string,
  overrides: ResolveAgentOverrides,
): ResolvedAgent | undefined {
  if (overrides.routeMode === "provider-default") return undefined;
  const profile =
    overrides.runnerProfile || process.env.GWRK_RUNNER_PROFILE || "local";
  const routeLock = readLocalRouteLock(projectRoot, profile);
  if (!routeLock && overrides.routeMode !== "pinned") return undefined;
  return resolveRoleAgent(role, projectRoot, { ...overrides, routeLock });
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

  const rawLock =
    overrides.routeMode === "provider-default"
      ? null
      : overrides.routeLock !== undefined
        ? overrides.routeLock
        : readLocalRouteLock(projectRoot, scope.runnerProfile);
  const routeLock = rawLock && parseRouteLockDocument(scope, rawLock);
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

  const pin = routeLock?.routes[role];
  const currentSuiteHashes =
    pin && overrides.currentSuiteHashes === undefined
      ? readCurrentSuiteHashes(projectRoot)
      : overrides.currentSuiteHashes;
  const qualifiedFallbacks =
    overrides.qualifiedFallbacks ??
    pin?.fallbackRoutes.flatMap((fallback) => {
      if (!RUNNER_PROFILE_RE.test(fallback.evaluationId)) return [];
      try {
        const bundle = readJsonSafely<unknown>(
          path.join(
            projectRoot,
            ".runs",
            "models",
            "evaluations",
            fallback.evaluationId,
            "bundle.json",
          ),
        );
        const record = parseStoredFallbackQualification(
          bundle,
          fallback,
          role,
          scope,
          snapshot,
          currentSuiteHashes,
        );
        return record ? [record] : [];
      } catch {
        return [];
      }
    });
  const route = resolveQualifiedRoute({
    role,
    scope,
    routeLock,
    snapshot,
    currentSuiteHashes,
    requestedBackend: overrides.agent || undefined,
    requestedModel: overrides.model || undefined,
    requestedEffort: overrides.effort,
    routeMode: overrides.routeMode,
    unavailableBackends: overrides.unavailableBackends,
    primaryFailureReason: overrides.primaryFailureReason,
    qualifiedFallbacks,
    defaultBackend: configuredBackend,
    defaultModel: fallbackModel,
  });

  if (route.status === "stale" || route.status === "unavailable_pin") {
    throw new Error(`${route.status}: ${route.diagnostic}`);
  }
  const resolvedBackend = route.backend || backend;
  const resolvedModel = route.model;

  return {
    backend: resolvedBackend,
    model: resolvedModel,
    ...(route.effort ? { effort: route.effort } : {}),
    requestedModel: route.requestedModel,
    // Legacy registry models must still reach dispatch when no pin or mode was selected.
    routeMode:
      resolvedModel && !routeLock && !overrides.routeMode
        ? undefined
        : route.routeMode,
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
