/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { writeScopedStdout } from "../adapters/cli/output-scope.js";
import { createModelCatalog } from "../adapters/models/catalog-discovery.js";
import { createFixtureRunner } from "../adapters/models/fixture-runner.js";
import { createRouteLockStore } from "../adapters/models/route-lock-store.js";
import { evaluateModels } from "../application/models/evaluate-models.js";
import {
  type RouteLockDocument,
  promoteModel,
  rollbackRouteLock,
} from "../application/models/promote-model.js";
import {
  type DiscoverySnapshot,
  type ModelCandidate,
  type ModelRole,
  type RunnerScope,
  assertNoSecretMaterial,
  checkCandidate,
  eligibleRoutesDigest,
} from "../domain/model-qualification.js";
import type {
  ModelCatalogPort,
  PromotionJudgePort,
  QualificationRunnerPort,
  RouteLockStorePort,
} from "../ports/model-qualification-port.js";
import { loadConfig } from "../utils/config.js";
import { CommandError, withSignal } from "../utils/signal.js";

export interface ModelsCommandDeps {
  readonly catalog?: ModelCatalogPort;
  readonly runner?: QualificationRunnerPort & PromotionJudgePort;
  readonly store?: RouteLockStorePort;
  readonly projectRoot?: string;
}

function findFixturesDir(startDir: string): string | undefined {
  if (
    process.env.GWRK_FIXTURES_DIR &&
    existsSync(process.env.GWRK_FIXTURES_DIR)
  ) {
    return process.env.GWRK_FIXTURES_DIR;
  }
  let current = startDir;
  while (true) {
    const candidate = join(current, "tests/fixtures/model-qualification");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return undefined;
}

export function resolveRunnerScope(
  projectRoot: string,
  options: { runner?: string; workspace?: string },
): RunnerScope {
  let workspaceId = options.workspace || process.env.GWRK_WORKSPACE_ID;
  if (!workspaceId) {
    try {
      const config = loadConfig(projectRoot);
      workspaceId =
        typeof config.project === "string"
          ? config.project
          : config.project?.name;
    } catch {
      // In unconfigured workspaces, default to "local"
    }
  }
  return {
    workspaceId: workspaceId || "local",
    runnerProfile: options.runner || process.env.GWRK_RUNNER_PROFILE || "local",
    platform: process.platform,
    arch: process.arch,
  };
}

const EVALUATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function resolveOutputFormat(format?: string): "text" | "json" {
  if (format === undefined || format === "text") return "text";
  if (format === "json") return "json";
  throw new CommandError(`Unknown format: ${format}. Supported: text, json`, 2);
}

function parseCandidateSpec(
  spec?: string,
  explicit?: Partial<ModelCandidate>,
  snapshot?: DiscoverySnapshot | null,
): ModelCandidate | null {
  if (!spec && !explicit?.modelId && !explicit?.backend) return null;

  let backend = explicit?.backend?.trim() || "";
  let modelId = explicit?.modelId?.trim() || "";
  let effort = explicit?.effort?.trim() || undefined;
  let provider = explicit?.provider?.trim() || undefined;
  let family = explicit?.family?.trim() || undefined;

  if (spec !== undefined) {
    const trimmed = spec.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return null;
        }
        const record = parsed as Record<string, unknown>;
        backend =
          typeof record.backend === "string" ? record.backend.trim() : backend;
        modelId =
          typeof record.modelId === "string" ? record.modelId.trim() : modelId;
        effort =
          typeof record.effort === "string" ? record.effort.trim() : effort;
        provider =
          typeof record.provider === "string"
            ? record.provider.trim()
            : provider;
        family =
          typeof record.family === "string" ? record.family.trim() : family;
      } catch {
        throw new CommandError("Invalid JSON candidate specification", 1);
      }
    } else {
      const parts = trimmed.split(":");
      if (parts.length < 2 || parts.length > 3) return null;
      backend = parts[0]?.trim() || backend;
      modelId = parts[1]?.trim() || modelId;
      if (parts.length === 3) {
        const parsedEffort = parts[2]?.trim();
        if (!parsedEffort) return null;
        effort = parsedEffort;
      }
    }
  }

  if (!backend || !modelId) return null;

  if (snapshot?.adapters) {
    for (const adapter of snapshot.adapters) {
      if (adapter.backend === backend) {
        const match = adapter.models.find((m) => m.modelId === modelId);
        if (match) {
          provider = provider || match.provider;
          family = family || match.family;
        }
      }
    }
  }

  provider = provider || backend;
  family = family || backend;

  return {
    backend,
    provider,
    family,
    modelId,
    ...(effort ? { effort } : {}),
  };
}

export function createModelsDiscoverCommand(
  deps: ModelsCommandDeps = {},
): Command {
  return new Command("discover")
    .description("Discover model catalogs across enabled adapters")
    .addHelpText(
      "after",
      `
Examples:

  Discover available models for the local runner:
    gwrk models discover

  Output discovered models in JSON format:
    gwrk models discover --format json
`,
    )
    .option("--runner <profile>", "Runner profile")
    .option("--workspace <id>", "Workspace identifier")
    .option("--backends <backends...>", "Backends to probe")
    .option("--format <type>", "Output format (text, json)")
    .action(async (_localOpts: unknown, command: Command) => {
      const opts = command.optsWithGlobals<{
        runner?: string;
        workspace?: string;
        backends?: string[];
        format?: string;
      }>();
      await withSignal("models discover", async () => {
        const format = resolveOutputFormat(opts.format);
        const root = deps.projectRoot || process.cwd();
        const scope = resolveRunnerScope(root, opts);
        const catalog = deps.catalog || createModelCatalog(root);
        const store = deps.store || createRouteLockStore(root);

        const reports = await catalog.discoverCatalog({
          scope,
          backends: opts.backends,
          nowIso: new Date().toISOString(),
        });

        const snapshot: DiscoverySnapshot = {
          scope,
          adapters: reports,
        };

        assertNoSecretMaterial(snapshot);
        await store.writeDiscoverySnapshot(scope, snapshot);

        if (
          reports.length > 0 &&
          reports.every((r) => r.status !== "available")
        ) {
          throw new CommandError("All requested backends failed", 1);
        }

        if (format === "json") {
          writeScopedStdout(`${JSON.stringify(snapshot, null, 2)}\n`);
        } else {
          writeScopedStdout(
            `Discovered ${reports.length} adapters for runner ${scope.runnerProfile} (${reports.filter((r) => r.status === "available").length} available)\n`,
          );
          for (const r of reports) {
            writeScopedStdout(
              `  ${r.backend.padEnd(14)} ${r.status.padEnd(12)} (${r.models.length} models)\n`,
            );
          }
        }
      });
    });
}

export function createModelsEvaluateCommand(
  deps: ModelsCommandDeps = {},
): Command {
  return new Command("evaluate")
    .description("Evaluate model candidates against qualification fixtures")
    .addHelpText(
      "after",
      `
Examples:

  Evaluate candidate model for the define role:
    gwrk models evaluate --role define --candidate codex:gpt-6.1-sol --fixed-implementer codex:gpt-6.1-sol

  Evaluate candidate with explicit incumbent and JSON format:
    gwrk models evaluate --role implement --candidate codex:gpt-6.1-sol --incumbent codex:gpt-5.2-codex --format json
`,
    )
    .requiredOption("--role <role>", "Model role (define, implement, review)")
    .option(
      "--candidate <candidate>",
      "Candidate model route (backend:modelId[:effort])",
    )
    .option("--candidate-backend <backend>", "Candidate backend")
    .option("--candidate-model <modelId>", "Candidate model identifier")
    .option("--candidate-effort <effort>", "Candidate effort value")
    .option("--candidate-provider <provider>", "Candidate provider")
    .option("--candidate-family <family>", "Candidate family")
    .option(
      "--incumbent <incumbent>",
      "Incumbent model route (backend:modelId[:effort])",
    )
    .option("--incumbent-backend <backend>", "Incumbent backend")
    .option("--incumbent-model <modelId>", "Incumbent model identifier")
    .option("--incumbent-effort <effort>", "Incumbent effort value")
    .option("--incumbent-provider <provider>", "Incumbent provider")
    .option("--incumbent-family <family>", "Incumbent family")
    .option(
      "--fixed-implementer <route>",
      "Fixed implementer route for define handoffs (backend:modelId[:effort])",
    )
    .option("--judges <judges...>", "Judges for comparison")
    .option("--eval-id <id>", "Evaluation run identifier")
    .option("--evaluation-id <id>", "Evaluation run identifier")
    .option("--runner <profile>", "Runner profile")
    .option("--workspace <id>", "Workspace identifier")
    .option("--repeats <number>", "Number of repeats per fixture")
    .option("--format <type>", "Output format (text, json)")
    .action(async (_localOpts: unknown, command: Command) => {
      const opts = command.optsWithGlobals<{
        role: string;
        candidate?: string;
        candidateBackend?: string;
        candidateModel?: string;
        candidateEffort?: string;
        candidateProvider?: string;
        candidateFamily?: string;
        incumbent?: string;
        incumbentBackend?: string;
        incumbentModel?: string;
        incumbentEffort?: string;
        incumbentProvider?: string;
        incumbentFamily?: string;
        fixedImplementer?: string;
        judges?: string[];
        evalId?: string;
        evaluationId?: string;
        runner?: string;
        workspace?: string;
        repeats?: string;
        format?: string;
      }>();
      await withSignal("models evaluate", async () => {
        const format = resolveOutputFormat(opts.format);
        const root = deps.projectRoot || process.cwd();
        const scope = resolveRunnerScope(root, opts);
        const store = deps.store || createRouteLockStore(root);
        const runner =
          deps.runner ||
          createFixtureRunner({ fixturesDir: findFixturesDir(root) });

        const role = opts.role as ModelRole;
        if (!["define", "implement", "review"].includes(role)) {
          throw new CommandError(
            "Valid role (define, implement, review) is required",
            1,
          );
        }

        const snapshot = await store.readDiscoverySnapshot(scope);
        if (!snapshot) {
          throw new CommandError(
            `Candidate check failed: model-unavailable (run 'gwrk models discover' for runner '${scope.runnerProfile}')`,
            1,
          );
        }

        const candidate = parseCandidateSpec(
          opts.candidate,
          {
            backend: opts.candidateBackend,
            modelId: opts.candidateModel,
            effort: opts.candidateEffort,
            provider: opts.candidateProvider,
            family: opts.candidateFamily,
          },
          snapshot,
        );

        if (!candidate) {
          throw new CommandError("Candidate model is required", 1);
        }

        const candidateCheck = checkCandidate(snapshot, scope, candidate);
        if (!candidateCheck.ok) {
          throw new CommandError(
            `Candidate check failed: ${candidateCheck.reason}`,
            1,
          );
        }

        const activeLock = await store.readRouteLock(scope);
        const activeDoc = activeLock?.document as RouteLockDocument | null;
        const incumbentPin = activeDoc?.routes?.[role];

        let incumbent = parseCandidateSpec(
          opts.incumbent,
          {
            backend: opts.incumbentBackend,
            modelId: opts.incumbentModel,
            effort: opts.incumbentEffort,
            provider: opts.incumbentProvider,
            family: opts.incumbentFamily,
          },
          snapshot,
        );

        if (!incumbent && incumbentPin) {
          incumbent = {
            backend: incumbentPin.backend,
            provider: incumbentPin.provider,
            family: incumbentPin.family,
            modelId: incumbentPin.modelId,
            ...(incumbentPin.effort ? { effort: incumbentPin.effort } : {}),
          };
        }

        if (!incumbent) {
          throw new CommandError(
            "Incumbent candidate is required when no active route lock exists (use --incumbent <backend:model>)",
            1,
          );
        }

        let fixedImplementer: ModelCandidate | undefined;
        if (opts.fixedImplementer !== undefined) {
          const parsedFixed = parseCandidateSpec(
            opts.fixedImplementer,
            {},
            snapshot,
          );
          if (!parsedFixed) {
            throw new CommandError(
              "Invalid --fixed-implementer specification",
              1,
            );
          }
          fixedImplementer = parsedFixed;
        } else if (role === "define" && activeDoc?.routes?.implement) {
          const implPin = activeDoc.routes.implement;
          fixedImplementer = {
            backend: implPin.backend,
            provider: implPin.provider,
            family: implPin.family,
            modelId: implPin.modelId,
            ...(implPin.effort ? { effort: implPin.effort } : {}),
          };
        }

        if (role === "define" && fixedImplementer) {
          const fixedCheck = checkCandidate(snapshot, scope, fixedImplementer);
          if (!fixedCheck.ok) {
            throw new CommandError(
              `Fixed implementer check failed: ${fixedCheck.reason}`,
              1,
            );
          }
        }

        let judges: [ModelCandidate, ModelCandidate];
        if (opts.judges !== undefined) {
          if (!Array.isArray(opts.judges) || opts.judges.length !== 2) {
            throw new CommandError(
              "Exactly two judges are required when --judges is specified",
              1,
            );
          }
          const j1 = parseCandidateSpec(opts.judges[0], {}, snapshot);
          const j2 = parseCandidateSpec(opts.judges[1], {}, snapshot);
          if (!j1 || !j2) {
            throw new CommandError(
              "Invalid --judges specification: provide two valid backend:modelId routes",
              1,
            );
          }
          judges = [j1, j2];
        } else if (activeDoc?.judges && activeDoc.judges.length === 2) {
          judges = [
            {
              backend: activeDoc.judges[0].backend,
              provider: activeDoc.judges[0].provider,
              family: activeDoc.judges[0].family,
              modelId: activeDoc.judges[0].modelId,
              ...(activeDoc.judges[0].effort
                ? { effort: activeDoc.judges[0].effort }
                : {}),
            },
            {
              backend: activeDoc.judges[1].backend,
              provider: activeDoc.judges[1].provider,
              family: activeDoc.judges[1].family,
              modelId: activeDoc.judges[1].modelId,
              ...(activeDoc.judges[1].effort
                ? { effort: activeDoc.judges[1].effort }
                : {}),
            },
          ];
        } else {
          judges = [
            {
              backend: "claude",
              provider: "anthropic",
              family: "claude-3-7",
              modelId: "claude-3-7-sonnet",
            },
            {
              backend: "codex",
              provider: "openai",
              family: "gpt-4o",
              modelId: "gpt-4o",
            },
          ];
        }

        const evaluationId =
          opts.evaluationId ||
          opts.evalId ||
          `eval-${randomUUID().slice(0, 8)}`;
        if (!EVALUATION_ID_RE.test(evaluationId)) {
          throw new CommandError("Invalid evaluation identifier", 1);
        }

        let repeats: number | undefined;
        if (opts.repeats !== undefined) {
          if (!/^\d+$/.test(opts.repeats)) {
            throw new CommandError(
              "Invalid --repeats value: expected positive integer",
              1,
            );
          }
          repeats = Number.parseInt(opts.repeats, 10);
        }

        const suite = await runner.loadSuite();
        const artifactRoot = join(
          root,
          ".runs",
          "models",
          "evaluations",
          evaluationId,
          "artifacts",
        );

        const result = await evaluateModels(
          { runner, judge: runner },
          {
            evaluationId,
            role,
            candidate,
            incumbent,
            judges,
            blindingSecret: randomUUID(),
            fixtures: suite.fixtures,
            ...(fixedImplementer ? { fixedImplementer } : {}),
            artifactRoot,
            repeats,
          },
        );

        const snapshotHash = createHash("sha256")
          .update(JSON.stringify(snapshot))
          .digest("hex");
        const snapshotEligibleDigest = eligibleRoutesDigest(snapshot, scope);
        const adapterReport = snapshot.adapters.find(
          (a) => a.backend === candidate.backend,
        );
        const toolVersions = {
          cliVersion: adapterReport?.cliVersion || "unknown",
          adapterVersion: adapterReport?.adapterVersion || "unknown",
        };

        const bundle = {
          ...result,
          scope,
          incumbentDigest: activeLock?.digest ?? null,
          snapshotHash,
          eligibleRoutesDigest: snapshotEligibleDigest,
          toolVersions,
          createdAt: new Date().toISOString(),
        };

        assertNoSecretMaterial(bundle);
        await store.writeEvaluationBundle(evaluationId, bundle);

        if (!result.decision.promote) {
          throw new CommandError(
            `Evaluation rejected: ${result.decision.reason}`,
            1,
          );
        }

        if (format === "json") {
          writeScopedStdout(`${JSON.stringify(bundle, null, 2)}\n`);
        } else {
          writeScopedStdout(
            `Evaluation ${evaluationId} qualified ${candidate.modelId} for ${role}\n`,
          );
        }
      });
    });
}

export function createModelsPromoteCommand(
  deps: ModelsCommandDeps = {},
): Command {
  return new Command("promote")
    .description("Promote an evaluated candidate or roll back to prior lock")
    .addHelpText(
      "after",
      `
Examples:

  Promote evaluated model to active route lock:
    gwrk models promote --eval eval-123

  Roll back active route lock to previous lock:
    gwrk models promote --rollback
`,
    )
    .option("--eval <id>", "Evaluation identifier to promote")
    .option("--evaluation-id <id>", "Evaluation identifier to promote")
    .option("--rollback", "Roll back to previous route lock")
    .option("--runner <profile>", "Runner profile")
    .option("--workspace <id>", "Workspace identifier")
    .option("--format <type>", "Output format (text, json)")
    .action(async (_localOpts: unknown, command: Command) => {
      const opts = command.optsWithGlobals<{
        eval?: string;
        evaluationId?: string;
        rollback?: boolean;
        runner?: string;
        workspace?: string;
        format?: string;
      }>();
      await withSignal("models promote", async () => {
        const format = resolveOutputFormat(opts.format);
        const root = deps.projectRoot || process.cwd();
        const scope = resolveRunnerScope(root, opts);
        const store = deps.store || createRouteLockStore(root);
        const runner =
          deps.runner ||
          createFixtureRunner({ fixturesDir: findFixturesDir(root) });

        if (opts.rollback) {
          const rollbackResult = await rollbackRouteLock({ store }, scope);
          if (!rollbackResult.ok) {
            throw new CommandError(
              `Rollback failed: ${rollbackResult.reason}`,
              1,
            );
          }
          if (format === "json") {
            writeScopedStdout(`${JSON.stringify(rollbackResult, null, 2)}\n`);
          } else {
            writeScopedStdout(
              `Rolled back active route lock for ${scope.runnerProfile} (digest: ${rollbackResult.digest})\n`,
            );
          }
          return;
        }

        const evaluationId = opts.eval || opts.evaluationId;
        if (!evaluationId) {
          throw new CommandError(
            "Evaluation ID is required (--eval <id>) or use --rollback",
            1,
          );
        }

        const promoteResult = await promoteModel(
          { store, runner },
          { scope, evaluationId },
        );

        if (!promoteResult.promote) {
          throw new CommandError(
            `Promotion failed: ${promoteResult.reason}`,
            1,
          );
        }

        if (format === "json") {
          writeScopedStdout(`${JSON.stringify(promoteResult, null, 2)}\n`);
        } else {
          writeScopedStdout(
            `Promoted evaluation ${evaluationId} for ${scope.runnerProfile} (digest: ${promoteResult.digest})\n`,
          );
        }
      });
    });
}

export function createModelsCommand(deps: ModelsCommandDeps = {}): Command {
  return new Command("models")
    .description("Model discovery, evaluation and route promotion")
    .addHelpText(
      "after",
      `
Examples:

  Discover available models for the local runner:
    gwrk models discover

  Evaluate candidate model for the define role:
    gwrk models evaluate --role define --candidate codex:gpt-6.1-sol

  Promote evaluated model to active route lock:
    gwrk models promote --eval eval-123

  Roll back active route lock to previous lock:
    gwrk models promote --rollback
`,
    )
    .addCommand(createModelsDiscoverCommand(deps))
    .addCommand(createModelsEvaluateCommand(deps))
    .addCommand(createModelsPromoteCommand(deps));
}

export const modelsCommand = createModelsCommand();
