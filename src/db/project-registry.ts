/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import type Database from "better-sqlite3";
import { discoverGitIdentityFacts } from "../adapters/git/project-id.js";
import {
  computeLegacyProjectIds,
  computeProjectId,
  normalizeGitRemoteSlug,
} from "../domain/project-id.js";
import {
  type EnrolledProject,
  type ProjectRoleBinding,
  ProjectRoleBindingSchema,
  type ProjectRunnerPolicy,
  type SlackActionReceipt,
  type SlackFeatureThread,
  validateProjectEnrollment,
} from "../domain/project-registry.js";
import type { ProjectRegistryPort } from "../ports/store-port.js";

const LEGACY_LOCAL = "legacy-local";

export function normalizeRegistryRepo(repo: string | null): string | null {
  return repo
    ? (normalizeGitRemoteSlug(repo)?.replace(/^github\.com\//, "") ?? null)
    : null;
}

export function discoverVerifiedCheckout(root: string) {
  if (!isAbsolute(root)) return null;
  try {
    const realRoot = realpathSync(root);
    const topLevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    }).trim();
    if (realpathSync(topLevel) !== realRoot) return null;
    const facts = discoverGitIdentityFacts(root);
    return facts.gitCommonDir ? facts : null;
  } catch {
    return null;
  }
}

function discoverVerifiedMirror(root: string) {
  if (!isAbsolute(root)) return null;
  try {
    const facts = discoverGitIdentityFacts(root);
    return facts.gitCommonDir &&
      realpathSync(facts.gitCommonDir) === realpathSync(root)
      ? facts
      : null;
  } catch {
    return null;
  }
}

export function discoverStoredRepository(
  root: string,
  projectId: string,
  allowLocalSubdirectory = false,
) {
  function discover(checkout: string) {
    const verified =
      discoverVerifiedCheckout(checkout) ?? discoverVerifiedMirror(checkout);
    if (verified || !allowLocalSubdirectory || !isAbsolute(checkout))
      return verified;
    const facts = discoverGitIdentityFacts(checkout);
    return facts.gitCommonDir &&
      computeProjectId({ ...facts, remoteOriginUrl: null }) === projectId
      ? facts
      : null;
  }

  const facts = discover(root);
  const suffix = `#${projectId}`;
  if (facts || !root.endsWith(suffix)) return facts;
  return discover(root.slice(0, -suffix.length));
}

export function canonicalProjectId(
  db: Database.Database,
  projectId: string,
): string {
  const row = db
    .prepare("SELECT project_id FROM project_aliases WHERE alias_id = ?")
    .get(projectId) as { project_id: string } | undefined;
  return row?.project_id ?? projectId;
}

export function prepareProjectLedgerLookup(
  db: Database.Database,
): Database.Statement<{ id: string }> {
  return db.prepare<{ id: string }>(`
    SELECT 1 FROM runs WHERE project_id = @id
    UNION ALL SELECT 1 FROM history WHERE project_id = @id
    UNION ALL SELECT 1 FROM plan_features WHERE project_id = @id
    UNION ALL SELECT 1 FROM plan_phases WHERE project_id = @id
    UNION ALL SELECT 1 FROM plan_proposals WHERE project_id = @id
    UNION ALL SELECT 1 FROM plan_edges WHERE project_id = @id
    UNION ALL SELECT 1 FROM gate_results WHERE project_id = @id
    UNION ALL SELECT 1 FROM issues WHERE project_id = @id
    UNION ALL SELECT 1 FROM compression WHERE project_id = @id
    UNION ALL SELECT 1 FROM routing_history WHERE project_id = @id
    UNION ALL SELECT 1 FROM routing_decisions WHERE project_id = @id
    LIMIT 1
  `);
}

export function projectScope(db: Database.Database, projectId: string) {
  const canonical = canonicalProjectId(db, projectId);
  const aliases = db
    .prepare(
      "SELECT alias_id FROM project_aliases WHERE project_id = ? ORDER BY alias_id",
    )
    .pluck()
    .all(canonical) as string[];
  const ids = [canonical, ...aliases];
  return { canonical, ids, placeholders: ids.map(() => "?").join(", ") };
}

export function firstPerKey<T>(
  rows: T[],
  key: (row: T) => string | number,
): T[] {
  const seen = new Set<string | number>();
  return rows.filter((row) => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  repo_slug: string | null;
  trunk_branch: string;
  local_root: string | null;
  mirror_path: string | null;
  allowed_runners: string;
  slack_workspace_id: string | null;
  slack_channel: string | null;
  slack_channel_name: string | null;
  slack_ops_channel_id: string | null;
  shared_channel: number;
  created_at: string;
  updated_at: string;
}

type ProjectOwnershipRow = Pick<
  ProjectRow,
  "repo_slug" | "local_root" | "mirror_path"
> & {
  path: string;
  github_repo: string | null;
  updated_at: string | null;
};

function storedRepositorySlugs(row?: ProjectOwnershipRow): string[] {
  return [row?.repo_slug, row?.github_repo]
    .map((repo) => normalizeRegistryRepo(repo ?? null))
    .filter((repo) => repo !== null);
}

const threadColumns = `
  project_id AS projectId, feature_id AS featureId, workspace_id AS workspaceId,
  channel_id AS channelId, root_ts AS rootTs, updated_at AS updatedAt
`;

export function createProjectRegistry(
  db: Database.Database,
  close: () => void,
): ProjectRegistryPort {
  function toProject(row: ProjectRow): EnrolledProject {
    const runners = JSON.parse(row.allowed_runners) as
      | ProjectRunnerPolicy
      | ProjectRunnerPolicy["allowedKinds"];
    return {
      projectId: row.id,
      slug: row.slug,
      name: row.name,
      repoSlug: row.repo_slug,
      trunkBranch: row.trunk_branch,
      localRoot: row.local_root,
      mirrorPath: row.mirror_path,
      runnerPolicy: Array.isArray(runners)
        ? { allowedKinds: runners }
        : runners,
      slack:
        row.slack_workspace_id && row.slack_channel
          ? {
              workspaceId: row.slack_workspace_id,
              channelId: row.slack_channel,
              ...(row.slack_channel_name
                ? { channelName: row.slack_channel_name }
                : {}),
              ...(row.slack_ops_channel_id
                ? { opsChannelId: row.slack_ops_channel_id }
                : {}),
              sharedChannel: row.shared_channel === 1,
            }
          : null,
      legacyProjectIds: projectScope(db, row.id).ids.slice(1),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function findOne(sql: string, value: string): EnrolledProject | null {
    const rows = db.prepare(sql).all({ value }) as ProjectRow[];
    return rows.length === 1 ? toProject(rows[0]) : null;
  }

  function requireEnrolled(id: string): string {
    const canonical = canonicalProjectId(db, id);
    const row = db
      .prepare("SELECT 1 FROM projects WHERE id = ? AND updated_at IS NOT NULL")
      .get(canonical);
    if (!row) throw new Error(`Project is not enrolled: ${id}`);
    return canonical;
  }

  function receiptScope(receiptKey: string) {
    let tuple: unknown;
    try {
      tuple = JSON.parse(receiptKey);
    } catch {
      return null;
    }
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 7 ||
      !tuple
        .slice(0, 6)
        .every((field) => typeof field === "string" && field.length > 0) ||
      (tuple[6] !== null && typeof tuple[6] !== "string")
    )
      return null;
    const scope = projectScope(db, tuple[0]);
    return {
      ...scope,
      keys: scope.ids.map((id) => JSON.stringify([id, ...tuple.slice(1)])),
    };
  }

  function findActionReceipt(receiptKey: string): SlackActionReceipt | null {
    const select = `SELECT receipt_key AS receiptKey, project_id AS projectId,
      action_id AS actionId, feature_id AS featureId, phase_id AS phaseId,
      message_ts AS messageTs, actor_user_id AS actorUserId, outcome, recorded_at AS recordedAt
      FROM slack_action_receipts`;
    const scope = receiptScope(receiptKey);
    const row = scope
      ? db
          .prepare(`${select} WHERE receipt_key IN (${scope.placeholders})
          AND project_id IN (${scope.placeholders})
          ORDER BY receipt_key = ? DESC, receipt_key LIMIT 1`)
          .get(...scope.keys, ...scope.ids, scope.keys[0])
      : db.prepare(`${select} WHERE receipt_key = ?`).get(receiptKey);
    return (row as SlackActionReceipt | undefined) ?? null;
  }

  const claimActionReceipt = db.transaction((receipt: SlackActionReceipt) => {
    const projectId = requireEnrolled(receipt.projectId);
    const scope = receiptScope(receipt.receiptKey);
    if (scope && scope.canonical !== projectId) {
      throw new Error("Slack receipt key belongs to another project");
    }
    if (findActionReceipt(receipt.receiptKey)) return false;
    const result = db
      .prepare(`
      INSERT INTO slack_action_receipts (
        receipt_key, project_id, action_id, feature_id, phase_id, message_ts, actor_user_id, outcome, recorded_at
      ) VALUES (@receiptKey, @projectId, @actionId, @featureId, @phaseId, @messageTs, @actorUserId, 'claimed', @recordedAt)
      ON CONFLICT(receipt_key) DO NOTHING
    `)
      .run({
        ...receipt,
        projectId,
        receiptKey: scope?.keys[0] ?? receipt.receiptKey,
      });
    return result.changes === 1;
  });

  const completeActionReceipt = db.transaction(
    (
      receiptKey: string,
      outcome: Parameters<ProjectRegistryPort["completeActionReceipt"]>[1],
    ) => {
      const receipt = findActionReceipt(receiptKey);
      if (!receipt) return false;
      const result = db
        .prepare(`
      UPDATE slack_action_receipts SET outcome = ?
      WHERE receipt_key = ? AND outcome IN ('claimed', 'uncertain')
    `)
        .run(outcome, receipt.receiptKey);
      return result.changes === 1;
    },
  );

  const enroll = db.transaction((input: EnrolledProject): EnrolledProject => {
    const validated = validateProjectEnrollment(input);
    if (!validated.ok) throw new Error(validated.error);
    const project = validated.value;
    const { projectId } = project;
    if (projectId === LEGACY_LOCAL) {
      throw new Error(
        `Project ID is reserved or already an alias: ${projectId}`,
      );
    }

    const checkout = project.localRoot ?? project.mirrorPath;
    const aliases = new Set(project.legacyProjectIds);
    const transitions = new Set<string>();
    const projectRepo = normalizeRegistryRepo(project.repoSlug);
    const verifiedIds = new Set<string>();
    const verifiedPaths = new Set<string>();
    const findLocal = db.prepare(`
      SELECT path, local_root, mirror_path, github_repo, updated_at
      FROM projects WHERE id = ? AND repo_slug IS NULL
    `);
    for (const [root, discover] of [
      [project.localRoot, discoverVerifiedCheckout],
      [
        project.mirrorPath,
        (path: string) =>
          discoverVerifiedCheckout(path) ?? discoverVerifiedMirror(path),
      ],
    ] as const) {
      if (!root) continue;
      const facts = discover(root);
      if (
        !facts ||
        computeProjectId(facts) !== projectId ||
        normalizeRegistryRepo(facts.remoteOriginUrl ?? null) !== projectRepo
      ) {
        throw new Error(
          `Project ID belongs to a different repository or checkout: ${projectId}`,
        );
      }
      verifiedPaths.add(realpathSync(root));
      const origin = projectRepo;

      const localId = computeProjectId({ ...facts, remoteOriginUrl: null });
      for (const id of computeLegacyProjectIds(facts)) {
        verifiedIds.add(id);
        if (id === projectId || canonicalProjectId(db, id) !== id) continue;
        const prior = findLocal.get(id) as
          | (Pick<ProjectRow, "local_root" | "mirror_path" | "updated_at"> & {
              path: string;
              github_repo: string | null;
            })
          | undefined;
        if (!prior) continue;
        const priorRepo = normalizeRegistryRepo(prior.github_repo);
        const preOrigin = id === localId && priorRepo === null;
        if (
          (priorRepo !== origin && !preOrigin) ||
          (prior.updated_at !== null && id !== localId)
        ) {
          continue;
        }
        const priorRoots = [prior.local_root, prior.mirror_path];
        if (prior.updated_at === null || !priorRoots.some(Boolean)) {
          priorRoots.push(prior.path);
        }
        const sameRepository = priorRoots.some(
          (priorRoot) =>
            priorRoot &&
            discoverStoredRepository(priorRoot, id, id === localId)
              ?.gitCommonDir === facts.gitCommonDir,
        );
        if (!sameRepository) continue;
        transitions.add(id);
        aliases.add(id);
      }
    }

    const currentOwner = canonicalProjectId(db, projectId);
    if (currentOwner !== projectId && !transitions.has(currentOwner)) {
      throw new Error(
        `Project ID is reserved or already an alias: ${projectId}`,
      );
    }
    aliases.delete(projectId);
    const findProject = db.prepare<[string], ProjectOwnershipRow>(
      "SELECT path, repo_slug, github_repo, updated_at, local_root, mirror_path FROM projects WHERE id = ?",
    );
    const hasRecords = prepareProjectLedgerLookup(db);
    const existing = findProject.get(projectId);
    const existingRepos = storedRepositorySlugs(existing);
    const verifiedProject = verifiedIds.size > 0;
    const conflict = () =>
      new Error(
        `Project ID belongs to a different repository or checkout: ${projectId}`,
      );
    if (existingRepos.some((repo) => repo !== projectRepo)) throw conflict();

    if (existing?.updated_at != null) {
      if (
        normalizeRegistryRepo(existing.repo_slug) !== projectRepo ||
        (projectRepo === null &&
          !verifiedProject &&
          (existing.local_root !== project.localRoot ||
            existing.mirror_path !== project.mirrorPath))
      ) {
        throw conflict();
      }
    } else {
      const roots = new Set(
        [existing?.path, existing?.local_root, existing?.mirror_path].filter(
          (root): root is string => Boolean(root),
        ),
      );
      for (const root of roots) {
        const facts = discoverStoredRepository(root, projectId);
        if (!facts) continue;
        if (
          computeProjectId(facts) !== projectId ||
          normalizeRegistryRepo(facts.remoteOriginUrl ?? null) !== projectRepo
        ) {
          throw conflict();
        }
        for (const id of computeLegacyProjectIds(facts)) verifiedIds.add(id);
      }
      if (verifiedIds.size === 0) throw conflict();
    }

    for (const alias of aliases) {
      const owner = canonicalProjectId(db, alias);
      const legacy = findProject.get(alias);
      if (
        alias === LEGACY_LOCAL ||
        (legacy?.updated_at != null && !transitions.has(alias)) ||
        (owner !== alias && owner !== projectId && !transitions.has(owner))
      ) {
        throw new Error(`Project alias is reserved or already owned: ${alias}`);
      }
      if (owner !== alias) continue;
      const occupied = Boolean(legacy || hasRecords.get({ id: alias }));

      const storedRepos = storedRepositorySlugs(legacy);
      const legacyRoots = new Set([
        legacy?.path,
        legacy?.local_root,
        legacy?.mirror_path,
      ]);
      const legacyFacts = Array.from(legacyRoots).flatMap((root) => {
        if (!root) return [];
        const facts = discoverStoredRepository(root, alias);
        return facts ? [facts] : [];
      });
      const matchesLegacyCheckout = legacyFacts.some(
        (facts) =>
          computeProjectId(facts) === projectId &&
          computeLegacyProjectIds(facts).includes(alias),
      );
      const conflictingRepo =
        storedRepos.some((repo) => repo !== projectRepo) ||
        legacyFacts.some((facts) => {
          const origin = normalizeRegistryRepo(facts.remoteOriginUrl ?? null);
          return (
            origin !== null &&
            (origin !== projectRepo || computeProjectId(facts) !== projectId)
          );
        });
      // A live remote can change while the checkout path and its hashes stay the same.
      const ownsLegacy =
        transitions.has(alias) ||
        (projectRepo !== null
          ? storedRepos.includes(projectRepo)
          : matchesLegacyCheckout) ||
        (!occupied && verifiedIds.has(alias));
      if (conflictingRepo || !ownsLegacy) {
        throw new Error(
          `Project alias belongs to a different repository or checkout: ${alias}`,
        );
      }
    }

    const activeBindings = db.prepare<
      [string, string],
      { id: string; path: string }
    >(`
      SELECT id, local_root AS path FROM projects
      WHERE updated_at IS NOT NULL AND id <> ? AND local_root IS NOT NULL
      UNION
      SELECT id, mirror_path AS path FROM projects
      WHERE updated_at IS NOT NULL AND id <> ? AND mirror_path IS NOT NULL
    `);
    for (const { id, path } of activeBindings.iterate(projectId, projectId)) {
      if (transitions.has(id)) continue;
      let realPath: string;
      try {
        realPath = realpathSync(path);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        throw error;
      }
      if (verifiedPaths.has(realPath)) {
        throw new Error(
          `Project checkout is already bound to project ${id}: ${path}`,
        );
      }
    }

    const retireLocal = db.prepare(
      "UPDATE projects SET updated_at = NULL WHERE id = ?",
    );
    for (const localId of transitions) retireLocal.run(localId);
    if (currentOwner !== projectId) {
      db.prepare("DELETE FROM project_aliases WHERE alias_id = ?").run(
        projectId,
      );
    }

    const row = db
      .prepare(`
      INSERT INTO projects (
        id, slug, name, path, github_repo, repo_slug, trunk_branch, local_root, mirror_path,
        allowed_runners, slack_workspace_id, slack_channel, slack_channel_name,
        slack_ops_channel_id, shared_channel, created_at, updated_at
      ) VALUES (
        @projectId, @slug, @name, @checkout, @repoSlug, @repoSlug, @trunkBranch, @localRoot,
        @mirrorPath, @runners, @workspace, @channel, @channelName, @opsChannel, @shared,
        @createdAt, @updatedAt
      )
      ON CONFLICT(id) DO UPDATE SET
        slug = excluded.slug, name = excluded.name, path = excluded.path,
        github_repo = excluded.github_repo, repo_slug = excluded.repo_slug,
        trunk_branch = excluded.trunk_branch, local_root = excluded.local_root,
        mirror_path = excluded.mirror_path, allowed_runners = excluded.allowed_runners,
        slack_workspace_id = excluded.slack_workspace_id, slack_channel = excluded.slack_channel,
        slack_channel_name = excluded.slack_channel_name,
        slack_ops_channel_id = excluded.slack_ops_channel_id, shared_channel = excluded.shared_channel,
        created_at = CASE WHEN projects.updated_at IS NULL THEN excluded.created_at ELSE projects.created_at END,
        updated_at = excluded.updated_at
      RETURNING *
    `)
      .get({
        ...project,
        checkout,
        runners: JSON.stringify(project.runnerPolicy),
        workspace: project.slack?.workspaceId ?? null,
        channel: project.slack?.channelId ?? null,
        channelName: project.slack?.channelName ?? null,
        opsChannel: project.slack?.opsChannelId ?? null,
        shared: project.slack?.sharedChannel ? 1 : 0,
      }) as ProjectRow;

    const retargetAliases = db.prepare(
      "UPDATE project_aliases SET project_id = ? WHERE project_id = ?",
    );
    const copyRoles = db.prepare(`
      INSERT INTO project_role_bindings (project_id, principal_type, principal_id, role, created_at)
      SELECT @projectId, principal_type, principal_id, role, created_at
      FROM project_role_bindings WHERE project_id = @localId
      ON CONFLICT(project_id, principal_type, principal_id) DO NOTHING
    `);
    const copyThreads = db.prepare(`
      INSERT INTO slack_feature_threads (project_id, feature_id, workspace_id, channel_id, root_ts, updated_at)
      SELECT @projectId, feature_id, workspace_id, channel_id, root_ts, updated_at
      FROM slack_feature_threads
      WHERE project_id = @localId AND workspace_id = @workspace AND channel_id = @channel
      ON CONFLICT(project_id, feature_id) DO UPDATE SET
        workspace_id = excluded.workspace_id, channel_id = excluded.channel_id,
        root_ts = excluded.root_ts, updated_at = excluded.updated_at
      WHERE slack_feature_threads.workspace_id <> excluded.workspace_id
         OR slack_feature_threads.channel_id <> excluded.channel_id
    `);
    for (const localId of transitions) {
      copyRoles.run({ projectId, localId });
      if (project.slack) {
        copyThreads.run({
          projectId,
          localId,
          workspace: project.slack.workspaceId,
          channel: project.slack.channelId,
        });
      }
      retargetAliases.run(projectId, localId);
    }

    const addAlias = db.prepare(`
      INSERT INTO project_aliases (alias_id, project_id, created_at) VALUES (?, ?, ?)
      ON CONFLICT(alias_id) DO NOTHING
    `);
    for (const alias of aliases)
      addAlias.run(alias, projectId, project.updatedAt);
    return toProject(row);
  });

  return {
    enrollProject: enroll.immediate,
    getProject(value) {
      return findOne(
        `
        SELECT * FROM projects WHERE updated_at IS NOT NULL AND (
          id = @value OR slug = @value OR repo_slug = @value OR id = (
            SELECT project_id FROM project_aliases WHERE alias_id = @value
          )
        )
      `,
        value,
      );
    },
    findByRepoSlug(repoSlug) {
      return findOne(
        "SELECT * FROM projects WHERE updated_at IS NOT NULL AND repo_slug = @value",
        repoSlug,
      );
    },
    findByLocalRoot(localRoot) {
      return findOne(
        `
        SELECT * FROM projects WHERE updated_at IS NOT NULL AND (local_root = @value OR mirror_path = @value)
      `,
        localRoot,
      );
    },
    listBySlackChannel(workspaceId, channelId) {
      const rows = db
        .prepare(`
        SELECT * FROM projects WHERE updated_at IS NOT NULL
        AND slack_workspace_id = ? AND slack_channel = ? ORDER BY slug
      `)
        .all(workspaceId, channelId) as ProjectRow[];
      return rows.map(toProject);
    },
    listProjects() {
      const rows = db
        .prepare(
          "SELECT * FROM projects WHERE updated_at IS NOT NULL ORDER BY slug",
        )
        .all() as ProjectRow[];
      return rows.map(toProject);
    },
    setRoleBinding(input) {
      const binding = ProjectRoleBindingSchema.parse(input);
      db.prepare(`
        INSERT INTO project_role_bindings (project_id, principal_type, principal_id, role)
        VALUES (@projectId, @principalType, @principalId, @role)
        ON CONFLICT(project_id, principal_type, principal_id) DO UPDATE SET role = excluded.role
      `).run({ ...binding, projectId: requireEnrolled(binding.projectId) });
    },
    listRoleBindings(projectId) {
      return db
        .prepare(`
        SELECT project_id AS projectId, principal_type AS principalType, principal_id AS principalId, role
        FROM project_role_bindings WHERE project_id = ? ORDER BY principal_type, principal_id
      `)
        .all(canonicalProjectId(db, projectId)) as ProjectRoleBinding[];
    },
    getFeatureThread(projectId, featureId) {
      const row = db
        .prepare(`
        SELECT ${threadColumns}
        FROM slack_feature_threads
        JOIN (
          SELECT id, slack_workspace_id, slack_channel FROM projects WHERE updated_at IS NOT NULL
        ) AS project ON project.id = project_id
          AND project.slack_workspace_id = workspace_id AND project.slack_channel = channel_id
        WHERE project_id = ? AND feature_id = ?
      `)
        .get(canonicalProjectId(db, projectId), featureId) as
        | SlackFeatureThread
        | undefined;
      return row ?? null;
    },
    bindFeatureThread(thread) {
      const row = db
        .prepare(`
        INSERT INTO slack_feature_threads (project_id, feature_id, workspace_id, channel_id, root_ts, updated_at)
        SELECT id, @featureId, @workspaceId, @channelId, @rootTs, @updatedAt
        FROM projects
        WHERE id = @projectId AND updated_at IS NOT NULL
          AND slack_workspace_id = @workspaceId AND slack_channel = @channelId
        ON CONFLICT(project_id, feature_id) DO UPDATE SET
          workspace_id = excluded.workspace_id, channel_id = excluded.channel_id,
          root_ts = excluded.root_ts, updated_at = excluded.updated_at
        RETURNING ${threadColumns}
      `)
        .get({
          ...thread,
          projectId: requireEnrolled(thread.projectId),
        }) as SlackFeatureThread | undefined;
      if (!row) throw new Error(`Slack binding mismatch: ${thread.projectId}`);
      return row;
    },
    getActionReceipt: findActionReceipt,
    claimActionReceipt: claimActionReceipt.immediate,
    completeActionReceipt: completeActionReceipt.immediate,
    close,
  };
}
