/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { usesHostedRuntime } from "../adapters/config/paths.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  discoverVerifiedCheckout,
  discoverVerifiedMirror,
  normalizeRegistryRepo,
  resolveGitCheckoutRoot,
  verifyEnrolledCheckout,
} from "../adapters/git/project-id.js";
import { createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import {
  type ProjectIdentityFacts,
  computeLegacyProjectIds,
  computeProjectId,
} from "../domain/project-id.js";
import {
  type AllowedRunnerKind,
  type EnrolledProject,
  type ProjectRole,
  type ProjectRoleBinding,
  ProjectRoleSchema,
  type ProjectRunnerPolicy,
  type ProjectSlackBinding,
} from "../domain/project-registry.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";
import type { ProjectReadinessReport } from "../server/types.js";
import { createOutput, resolveFormat } from "../utils/output.js";
import { CommandError, withSignal } from "../utils/signal.js";

export interface ProjectEnrollOptions {
  path?: string;
  localRoot?: string;
  mirror?: string;
  repo?: string;
  slug?: string;
  name?: string;
  trunk?: string;
  runners?: string;
  runnerIds?: string;
  workspace?: string;
  channel?: string;
  channelName?: string;
  opsChannel?: string;
  sharedChannel?: boolean;
  role?: string[];
  alias?: string[];
  format?: string;
  json?: boolean;
}

export interface EnrollRepositoryResult {
  project: EnrolledProject;
  roleBindings: ProjectRoleBinding[];
  readiness: ProjectReadinessReport;
}

function resolveCommandOutput(
  options: { format?: string; json?: boolean },
  command: Command,
) {
  if (options.json) return createOutput("json");
  if (options.format) {
    return options.format === "text"
      ? createOutput(undefined)
      : createOutput(options.format);
  }
  return resolveFormat(command);
}

function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "project"
  );
}

function detectTrunkBranch(checkoutRoot: string): string {
  const gitOptions = {
    cwd: checkoutRoot,
    env: repositoryGitEnv(checkoutRoot),
    encoding: "utf-8" as const,
    stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  };
  try {
    const ref = execFileSync(
      "git",
      ["symbolic-ref", "refs/remotes/origin/HEAD"],
      gitOptions,
    ).trim();
    const branch = ref.split("/").pop();
    if (branch) return branch;
  } catch {
    // Fall through to local branch inspection.
  }

  try {
    const branches = execFileSync(
      "git",
      ["branch", "--format=%(refname:short)"],
      gitOptions,
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const candidate of ["develop", "main", "master", "trunk"]) {
      if (branches.includes(candidate)) return candidate;
    }
    const current = execFileSync(
      "git",
      ["symbolic-ref", "--short", "HEAD"],
      gitOptions,
    ).trim();
    if (current) return current;
  } catch {
    // Fall through to default trunk.
  }

  return "develop";
}

function readTrackedProjectName(checkoutRoot: string): string | undefined {
  const configPath = path.join(checkoutRoot, ".gwrkrc.json");
  if (!fs.existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8")) as {
      project?: { name?: unknown };
    };
    return typeof parsed.project?.name === "string" &&
      parsed.project.name.trim()
      ? parsed.project.name.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function resolveUniqueSlug(
  registry: ProjectRegistryPort,
  desired: string,
  projectId: string,
  repoSlug: string | null,
): string {
  const takenByOther = (candidate: string) => {
    const owner = registry.getProject(candidate);
    return owner !== null && owner.projectId !== projectId;
  };
  const base = slugify(desired);
  if (!takenByOther(base)) return base;
  if (repoSlug) {
    const repoCandidate = slugify(repoSlug);
    if (!takenByOther(repoCandidate)) return repoCandidate;
  }
  return `${base}-${projectId.slice(0, 6)}`;
}

function parseRunnerPolicy(
  runnersArg: string | undefined,
  runnerIdsArg: string | undefined,
  existing?: ProjectRunnerPolicy,
): ProjectRunnerPolicy {
  let allowedKinds: AllowedRunnerKind[] = existing?.allowedKinds ?? ["local"];
  if (runnersArg !== undefined) {
    const parsed = runnersArg
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parsed.length === 0) {
      throw new CommandError(
        "Invalid --runners value. Pass a comma-separated list of 'local' and 'hosted'.",
        2,
      );
    }
    const kinds: AllowedRunnerKind[] = [];
    for (const kind of parsed) {
      if (kind !== "local" && kind !== "hosted") {
        throw new CommandError(
          `Unknown runner kind '${kind}'. Allowed values: local, hosted.`,
          2,
        );
      }
      if (!kinds.includes(kind)) kinds.push(kind);
    }
    allowedKinds = kinds;
  }

  const runnerIds =
    runnerIdsArg !== undefined
      ? runnerIdsArg
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      : existing?.runnerIds;

  return runnerIds && runnerIds.length > 0
    ? { allowedKinds, runnerIds }
    : { allowedKinds };
}

function parseRoleBindingSpec(
  raw: string,
  projectId: string,
): ProjectRoleBinding {
  const eqIndex = raw.lastIndexOf("=");
  if (eqIndex <= 0 || eqIndex === raw.length - 1) {
    throw new CommandError(
      `Invalid --role '${raw}'. Expected '<principalType>:<principalId>=<role>' (for example slack_user:T123:U123=maintainer).`,
      2,
    );
  }
  const principalPart = raw.slice(0, eqIndex).trim();
  const rolePart = raw.slice(eqIndex + 1).trim();
  const colonIndex = principalPart.indexOf(":");
  if (colonIndex <= 0 || colonIndex === principalPart.length - 1) {
    throw new CommandError(
      `Invalid --role '${raw}'. Expected '<principalType>:<principalId>=<role>'.`,
      2,
    );
  }

  const principalType = principalPart.slice(0, colonIndex).trim();
  const principalId = principalPart.slice(colonIndex + 1).trim();
  if (
    principalType !== "slack_user" &&
    principalType !== "cli_token" &&
    principalType !== "google_sub"
  ) {
    throw new CommandError(
      `Invalid principal type '${principalType}'. Expected slack_user, cli_token, or google_sub.`,
      2,
    );
  }
  const roleResult = ProjectRoleSchema.safeParse(rolePart);
  if (!roleResult.success) {
    throw new CommandError(
      `Invalid role '${rolePart}'. Expected viewer, operator, or maintainer.`,
      2,
    );
  }
  return {
    projectId,
    principalType,
    principalId,
    role: roleResult.data as ProjectRole,
  };
}

export function evaluateEnrolledProjectReadiness(
  project: EnrolledProject,
  runnerKind: AllowedRunnerKind = usesHostedRuntime() ? "hosted" : "local",
): ProjectReadinessReport {
  const runnerAllowed = project.runnerPolicy.allowedKinds.includes(runnerKind);
  const verifiedCheckout =
    verifyEnrolledCheckout(project, "mirrorPath") ??
    verifyEnrolledCheckout(project, "localRoot");
  const configuredCheckout = project.mirrorPath ?? project.localRoot;
  const checkoutPath = verifiedCheckout ?? configuredCheckout ?? null;
  const checkoutReady = Boolean(verifiedCheckout);
  const slackBound = Boolean(
    project.slack?.workspaceId && project.slack?.channelId,
  );

  let status: ProjectReadinessReport["status"];
  let reason: string | undefined;

  if (!configuredCheckout) {
    status = "misconfigured";
    reason = "No checkout path (localRoot or mirrorPath) configured";
  } else if (!runnerAllowed) {
    status = "misconfigured";
    reason = `Runner kind '${runnerKind}' is not allowed by project policy`;
  } else if (!checkoutReady) {
    status = "degraded";
    reason = `Configured checkout at '${configuredCheckout}' failed repository verification`;
  } else if (!slackBound) {
    status = "degraded";
    reason = "Project has no Slack workspace and channel binding";
  } else {
    status = "ready";
  }

  return {
    projectId: project.projectId,
    slug: project.slug,
    repoSlug: project.repoSlug,
    trunkBranch: project.trunkBranch,
    checkoutPath,
    checkoutReady,
    runnerAllowed,
    slackBound,
    status,
    ...(reason ? { reason } : {}),
  };
}

function resolveCanonicalPath(rawPath: string): string {
  const resolved = path.resolve(rawPath);
  if (!fs.existsSync(resolved)) {
    throw new CommandError(
      `Path does not exist: ${resolved}. Pass --path <checkout> or --mirror <mirror>, or run 'gwrk project enroll' inside a git checkout.`,
      1,
    );
  }
  return fs.realpathSync(resolved);
}

export function enrollLocalRepository(
  options: ProjectEnrollOptions & {
    cwd?: string;
    registry?: ProjectRegistryPort;
  } = {},
): EnrollRepositoryResult {
  const cwd = options.cwd ?? process.cwd();
  const explicitLocal = options.localRoot ?? options.path;
  const explicitMirror = options.mirror;

  let localRoot: string | null = null;
  let mirrorPath: string | null = null;
  let primaryFacts: ProjectIdentityFacts | null = null;

  if (explicitLocal || !explicitMirror) {
    const candidate = resolveCanonicalPath(explicitLocal ?? cwd);
    const topLevel = resolveGitCheckoutRoot(candidate);
    const canonicalCheckout = fs.existsSync(topLevel)
      ? fs.realpathSync(topLevel)
      : candidate;
    const verified = discoverVerifiedCheckout(canonicalCheckout);
    if (!verified) {
      throw new CommandError(
        `Cannot verify a git checkout at '${candidate}'. Pass --repo <owner/name> with --path <checkout> or --mirror <mirror>, or run 'gwrk project enroll' inside a git checkout.`,
        1,
      );
    }
    localRoot = canonicalCheckout;
    primaryFacts = verified;
  }

  if (explicitMirror) {
    const canonicalMirror = resolveCanonicalPath(explicitMirror);
    const verifiedMirror =
      discoverVerifiedCheckout(canonicalMirror) ??
      discoverVerifiedMirror(canonicalMirror);
    if (!verifiedMirror) {
      throw new CommandError(
        `Cannot verify a git mirror or checkout at '${canonicalMirror}'. Pass --repo <owner/name> or run 'gwrk project enroll' with a valid git repository.`,
        1,
      );
    }
    mirrorPath = canonicalMirror;
    if (!primaryFacts) {
      primaryFacts = verifiedMirror;
    }
  }

  if (!primaryFacts) {
    throw new CommandError(
      "Cannot determine repository identity. Pass --repo <owner/name> with a checkout or run 'gwrk project enroll' inside a git checkout.",
      1,
    );
  }

  const detectedRepoSlug = normalizeRegistryRepo(
    primaryFacts.remoteOriginUrl ?? null,
  );
  const requestedRepoSlug = options.repo
    ? normalizeRegistryRepo(options.repo)
    : null;
  if (
    requestedRepoSlug &&
    detectedRepoSlug &&
    requestedRepoSlug !== detectedRepoSlug
  ) {
    throw new CommandError(
      `Repository slug mismatch: --repo '${requestedRepoSlug}' does not match checkout origin '${detectedRepoSlug}'.`,
      1,
    );
  }
  if (requestedRepoSlug && !detectedRepoSlug) {
    throw new CommandError(
      `Checkout has no origin remote matching --repo '${requestedRepoSlug}'. Add the git origin remote first or omit --repo.`,
      1,
    );
  }

  const repoSlug = detectedRepoSlug;
  const projectId = computeProjectId(primaryFacts);
  const primaryCheckout = localRoot ?? mirrorPath;
  if (!primaryCheckout) {
    throw new CommandError(
      "Enrollment requires a local checkout or mirror path.",
      1,
    );
  }

  const ownRegistry = !options.registry;
  const registry = options.registry ?? createSqliteProjectRegistryAdapter();
  try {
    const localOnlyId = computeProjectId({
      ...primaryFacts,
      remoteOriginUrl: null,
    });
    const existing =
      registry.getProject(projectId) ??
      registry.findByLocalRoot(primaryCheckout) ??
      registry.getProject(localOnlyId);

    const legacyIds = new Set<string>([
      ...(existing?.legacyProjectIds ?? []),
      ...computeLegacyProjectIds(primaryFacts),
      ...(options.alias ?? []),
    ]);
    if (existing && existing.projectId !== projectId) {
      legacyIds.add(existing.projectId);
    }
    legacyIds.delete(projectId);

    const defaultName =
      options.name?.trim() ||
      existing?.name ||
      readTrackedProjectName(primaryCheckout) ||
      (repoSlug ? repoSlug.split("/").pop() : undefined) ||
      path.basename(primaryCheckout);

    const slug = options.slug
      ? slugify(options.slug)
      : existing?.slug ||
        resolveUniqueSlug(
          registry,
          repoSlug?.split("/").pop() ?? defaultName,
          projectId,
          repoSlug,
        );

    const trunkBranch =
      options.trunk?.trim() ||
      existing?.trunkBranch ||
      detectTrunkBranch(primaryCheckout);

    const runnerPolicy = parseRunnerPolicy(
      options.runners,
      options.runnerIds,
      existing?.runnerPolicy,
    );

    let slack: ProjectSlackBinding | null = existing?.slack ?? null;
    const hasSlackArg =
      options.workspace !== undefined ||
      options.channel !== undefined ||
      options.channelName !== undefined ||
      options.opsChannel !== undefined ||
      options.sharedChannel !== undefined;

    if (hasSlackArg) {
      const workspaceId =
        options.workspace?.trim() ?? existing?.slack?.workspaceId;
      const channelId = options.channel?.trim() ?? existing?.slack?.channelId;
      if (!workspaceId || !channelId) {
        throw new CommandError(
          "Slack binding requires both --workspace <id> and --channel <id>.",
          2,
        );
      }
      const channelName =
        options.channelName?.trim() ?? existing?.slack?.channelName;
      const opsChannelId =
        options.opsChannel?.trim() ?? existing?.slack?.opsChannelId;
      slack = {
        workspaceId,
        channelId,
        ...(channelName ? { channelName } : {}),
        ...(opsChannelId ? { opsChannelId } : {}),
        sharedChannel:
          options.sharedChannel ?? existing?.slack?.sharedChannel ?? false,
      };
    }

    const nowIso = new Date().toISOString();
    const enrolled = registry.enrollProject({
      projectId,
      slug,
      name: defaultName,
      repoSlug,
      trunkBranch,
      localRoot: localRoot ?? existing?.localRoot ?? null,
      mirrorPath: mirrorPath ?? existing?.mirrorPath ?? null,
      runnerPolicy,
      slack,
      legacyProjectIds: Array.from(legacyIds),
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    });

    const parsedBindings = (options.role ?? []).map((spec) =>
      parseRoleBindingSpec(spec, enrolled.projectId),
    );
    for (const binding of parsedBindings) {
      registry.setRoleBinding(binding);
    }

    const roleBindings = registry.listRoleBindings(enrolled.projectId);
    const readiness = evaluateEnrolledProjectReadiness(enrolled);
    return { project: enrolled, roleBindings, readiness };
  } finally {
    if (ownRegistry) registry.close();
  }
}

export const createProjectEnrollCommand = () =>
  new Command("enroll")
    .description(
      "Enroll or update a repository in the project registry with trunk, checkout, runners, Slack binding and role bindings",
    )
    .option("--path <dir>", "Local repository checkout path")
    .option("--local-root <dir>", "Alias for --path")
    .option("--mirror <dir>", "Bare or checkout mirror path")
    .option("--repo <owner/name>", "Expected GitHub repository slug")
    .option("--slug <slug>", "Stable project slug")
    .option("--name <name>", "Project display name")
    .option("--trunk <branch>", "Trunk branch name")
    .option(
      "--runners <kinds>",
      "Comma-separated allowed runner kinds (local,hosted)",
    )
    .option("--runner-ids <ids>", "Comma-separated allowed runner IDs")
    .option("--workspace <id>", "Slack workspace ID")
    .option("--channel <id>", "Slack channel ID")
    .option("--channel-name <name>", "Slack channel display name")
    .option("--ops-channel <id>", "Explicit Slack operations channel ID")
    .option("--shared-channel", "Mark Slack channel as shared across projects")
    .option(
      "--role <binding>",
      "Assign project role (<principalType>:<principalId>=<role>, repeatable)",
      collectOption,
      [] as string[],
    )
    .option(
      "--alias <id>",
      "Legacy project ID alias (repeatable)",
      collectOption,
      [] as string[],
    )
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Type: mutator (changes project registry)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Enrollment or verification failed
  2: Usage error
`,
    )
    .action(async (options: ProjectEnrollOptions, command: Command) => {
      await withSignal("project enroll", async () => {
        const out = resolveCommandOutput(options, command);
        const result = enrollLocalRepository(options);
        if (out.isJson) {
          out.write({
            ...result.project,
            roleBindings: result.roleBindings,
            readiness: result.readiness,
          });
          return;
        }
        const p = result.project;
        out.write(
          [
            `Enrolled project: ${p.slug} (${p.projectId})`,
            `  Name:      ${p.name}`,
            `  Repo:      ${p.repoSlug ?? "local-only"}`,
            `  Trunk:     ${p.trunkBranch}`,
            `  LocalRoot: ${p.localRoot ?? "none"}`,
            `  Mirror:    ${p.mirrorPath ?? "none"}`,
            `  Runners:   ${p.runnerPolicy.allowedKinds.join(", ")}`,
            `  Slack:     ${p.slack ? `${p.slack.workspaceId}/${p.slack.channelId}${p.slack.opsChannelId ? ` (ops: ${p.slack.opsChannelId})` : ""}` : "unbound"}`,
            `  Aliases:   ${p.legacyProjectIds.length}`,
            `  Roles:     ${result.roleBindings.length}`,
            `  Readiness: ${result.readiness.status}${result.readiness.reason ? ` (${result.readiness.reason})` : ""}`,
            "",
          ].join("\n"),
        );
      });
    });

export const createProjectListCommand = () =>
  new Command("list")
    .description(
      "List enrolled projects, legacy aliases, Slack bindings and readiness",
    )
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Type: query (read-only)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Registry access error
  2: Usage error
`,
    )
    .action(
      async (
        options: { format?: string; json?: boolean },
        command: Command,
      ) => {
        await withSignal("project list", async () => {
          const out = resolveCommandOutput(options, command);
          const registry = createSqliteProjectRegistryAdapter();
          try {
            const projects = registry.listProjects().map((project) => ({
              ...project,
              roleBindings: registry.listRoleBindings(project.projectId),
              readiness: evaluateEnrolledProjectReadiness(project),
            }));

            if (out.isJson) {
              out.write({ projects, total: projects.length });
              return;
            }

            if (projects.length === 0) {
              out.write(
                "No enrolled projects found. Run 'gwrk project enroll' inside a git checkout.\n",
              );
              return;
            }

            const lines = [
              "Slug                 Repo                       Trunk     Slack               Readiness",
              "───────────────────  ─────────────────────────  ────────  ──────────────────  ─────────────",
            ];
            for (const entry of projects) {
              const slackLabel = entry.slack
                ? `${entry.slack.workspaceId}/${entry.slack.channelId}`
                : "unbound";
              lines.push(
                `${entry.slug.slice(0, 19).padEnd(19)}  ${(entry.repoSlug ?? "local-only").slice(0, 25).padEnd(25)}  ${entry.trunkBranch.slice(0, 8).padEnd(8)}  ${slackLabel.slice(0, 18).padEnd(18)}  ${entry.readiness.status}`,
              );
            }
            lines.push(`\n${projects.length} enrolled project(s)\n`);
            out.write(`${lines.join("\n")}`);
          } finally {
            registry.close();
          }
        });
      },
    );

export const createProjectShowCommand = () =>
  new Command("show")
    .description(
      "Show one enrolled project, its legacy aliases and role bindings",
    )
    .argument(
      "<project>",
      "Project slug, canonical ID, repository slug, or legacy alias",
    )
    .option("--format <type>", "Output format (text, json)")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Type: query (read-only)
Format: use --format json or gwrk --format json for structured output
Exit codes:
  0: Success
  1: Project not found
  2: Usage error
`,
    )
    .action(
      async (
        selector: string,
        options: { format?: string; json?: boolean },
        command: Command,
      ) => {
        await withSignal("project show", async () => {
          const out = resolveCommandOutput(options, command);
          const registry = createSqliteProjectRegistryAdapter();
          try {
            const project = registry.getProject(selector);
            if (!project) {
              const knownSlugs = registry.listProjects().map((p) => p.slug);
              if (knownSlugs.length > 0) {
                throw new CommandError(
                  `Project '${selector}' is not enrolled. Known projects: ${knownSlugs.join(", ")}. Run 'gwrk project list' to inspect enrollments.`,
                  1,
                );
              }
              throw new CommandError(
                `Project '${selector}' is not enrolled. No projects are currently enrolled. Run 'gwrk project enroll' inside a git checkout.`,
                1,
              );
            }

            const roleBindings = registry.listRoleBindings(project.projectId);
            const readiness = evaluateEnrolledProjectReadiness(project);

            if (out.isJson) {
              out.write({
                ...project,
                roleBindings,
                readiness,
              });
              return;
            }

            const lines = [
              `Project:   ${project.slug} (${project.projectId})`,
              `Name:      ${project.name}`,
              `Repo:      ${project.repoSlug ?? "local-only"}`,
              `Trunk:     ${project.trunkBranch}`,
              `LocalRoot: ${project.localRoot ?? "none"}`,
              `Mirror:    ${project.mirrorPath ?? "none"}`,
              `Runners:   ${project.runnerPolicy.allowedKinds.join(", ")}`,
              `Slack:     ${project.slack ? `${project.slack.workspaceId}/${project.slack.channelId}${project.slack.opsChannelId ? ` (ops: ${project.slack.opsChannelId})` : ""}` : "unbound"}`,
              `Readiness: ${readiness.status}${readiness.reason ? ` (${readiness.reason})` : ""}`,
              `Aliases:   ${project.legacyProjectIds.length > 0 ? project.legacyProjectIds.join(", ") : "none"}`,
              `Roles:     ${roleBindings.length > 0 ? roleBindings.map((r) => `${r.principalType}:${r.principalId}=${r.role}`).join(", ") : "none"}`,
              "",
            ];
            out.write(lines.join("\n"));
          } finally {
            registry.close();
          }
        });
      },
    );
