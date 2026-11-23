/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runWithOutputScope } from "../adapters/cli/output-scope.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { runCli } from "../cli.js";
import { openDatabase } from "../db/index.js";
import { listRuns } from "../db/runs.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import type { NotificationPort } from "../ports/notification-port.js";
import type { GitHubHarvestPort } from "../ports/operations-port.js";
import { createHarvestCommand } from "./harvest.js";

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...repositoryGitEnv(cwd),
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Gwrk Test",
      GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
      GIT_COMMITTER_NAME: "Gwrk Test",
      GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
      GIT_TERMINAL_PROMPT: "0",
    },
  }).trim();
}

function createFeatureRepo(options: {
  dir: string;
  trunk?: string;
  remoteUrl?: string;
  featureId: string;
  phaseId?: string;
  gateExitCode?: number;
}): { root: string; headSha: string } {
  const {
    dir,
    trunk = "main",
    remoteUrl,
    featureId,
    phaseId = "phase-01",
    gateExitCode = 0,
  } = options;
  fs.mkdirSync(dir, { recursive: true });
  const root = fs.realpathSync(dir);
  runGit(root, "init", "--template=", `--initial-branch=${trunk}`);
  if (remoteUrl) {
    runGit(root, "remote", "add", "origin", remoteUrl);
  }

  fs.writeFileSync(
    path.join(root, ".gwrkrc.json"),
    JSON.stringify({ project: { name: path.basename(root) } }, null, 2),
  );

  const featureDir = path.join(root, "specs", featureId);
  const gatesDir = path.join(featureDir, "gates");
  const gwrkDir = path.join(featureDir, ".gwrk");
  fs.mkdirSync(gatesDir, { recursive: true });
  fs.mkdirSync(gwrkDir, { recursive: true });

  fs.writeFileSync(
    path.join(featureDir, "plan.md"),
    `# Feature ${featureId}\n\n### Phase 1: Initial\n\n- T001: First task\n`,
  );
  fs.writeFileSync(
    path.join(gwrkDir, "tasks.json"),
    JSON.stringify(
      {
        featureId,
        createdAt: "2026-11-23T00:00:00.000Z",
        phases: [
          {
            id: phaseId,
            title: "Phase 1",
            sp_estimate: 2,
            tasks: [
              {
                id: "T001",
                title: "Verify gate",
                description: "Verify gate",
                status: "open",
                gateScript: "gates/T001-gate.sh",
                sp: 2,
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  );
  const gatePath = path.join(gatesDir, "T001-gate.sh");
  fs.writeFileSync(
    gatePath,
    `#!/usr/bin/env bash\n# AUTHORED\nexit ${gateExitCode}\n`,
    { mode: 0o755 },
  );

  runGit(root, "add", ".");
  runGit(root, "commit", "--no-gpg-sign", "-m", "feat: add feature phase");
  const headSha = runGit(root, "rev-parse", "HEAD");
  return { root, headSha };
}

async function runHarvest(
  args: string[],
  options?: {
    rootFormat?: "json";
    deps?: Parameters<typeof createHarvestCommand>[0];
  },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";
  const scope = {
    agentMode: false,
    exitCode: 0,
    stdout: (chunk: string) => {
      stdout += chunk;
    },
    stderr: (chunk: string) => {
      stderr += chunk;
    },
  };
  await runWithOutputScope(scope, async () => {
    const program = new Command("gwrk").option("--format <type>");
    program.addCommand(createHarvestCommand(options?.deps));
    const argv = options?.rootFormat
      ? ["--format", options.rootFormat, "harvest", ...args]
      : ["harvest", ...args];
    await program.parseAsync(argv, { from: "user" });
  });
  return { stdout, stderr, exitCode: scope.exitCode };
}

describe("T036 / TR-002: manual gwrk harvest through DurableHarvestService", () => {
  let workspaceDir: string;
  let gwrkHome: string;
  let oldCwd: string;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    oldCwd = process.cwd();
    workspaceDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-harvest-cmd-")),
    );
    gwrkHome = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-harvest-home-")),
    );
    vi.stubEnv("GWRK_HOME", gwrkHome);
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Unexpected live network call"));
  });

  afterEach(() => {
    process.chdir(oldCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    fs.rmSync(gwrkHome, { recursive: true, force: true });
  });

  it("executes offline local commit harvest without remote or Slack, emits ADR-004 JSON, and updates local tasks", async () => {
    const { root, headSha } = createFeatureRepo({
      dir: path.join(workspaceDir, "local-offline"),
      trunk: "main",
      featureId: "049-offline",
      phaseId: "phase-01",
      gateExitCode: 0,
    });
    process.chdir(root);

    const res = await runHarvest([
      "049-offline",
      "1",
      "--commit",
      headSha,
      "--format",
      "json",
    ]);

    expect(res.exitCode, res.stderr).toBe(0);
    expect(res.stderr).toMatch(/\[exit:0 \| /);
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.featureId).toBe("049-offline");
    expect(parsed.phaseId).toBe("phase-01");
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0]).toMatchObject({
      status: "completed",
      pendingStages: [],
      failedStages: [],
    });

    const taskState = JSON.parse(
      fs.readFileSync(
        path.join(root, "specs", "049-offline", ".gwrk", "tasks.json"),
        "utf-8",
      ),
    );
    expect(taskState.phases[0].tasks[0].status).toBe("completed");
    expect(fetchSpy).not.toHaveBeenCalled();

    // Repeat offline harvest converges onto the same durable operation
    const replay = await runHarvest([
      "049-offline",
      "phase-01",
      "--commit",
      headSha,
      "--format",
      "json",
    ]);
    expect(replay.exitCode).toBe(0);
    const replayParsed = JSON.parse(replay.stdout);
    expect(replayParsed.operations[0].operationId).toBe(
      parsed.operations[0].operationId,
    );
    expect(replayParsed.operations[0].deduplicatedWork).toBe(true);
  });

  it("exits 1 with parseable JSON and recovery hint on gate_failed without promoting local tasks", async () => {
    const { root, headSha } = createFeatureRepo({
      dir: path.join(workspaceDir, "gate-fail-repo"),
      trunk: "main",
      featureId: "049-fail",
      phaseId: "phase-01",
      gateExitCode: 1,
    });
    process.chdir(root);

    const res = await runHarvest([
      "049-fail",
      "phase-01",
      "--commit",
      headSha,
      "--format",
      "json",
    ]);

    expect(res.exitCode).toBe(1);
    expect(res.stderr).toMatch(/\[exit:1 \| /);
    expect(res.stderr).toContain("hint:");
    const parsed = JSON.parse(res.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.operations[0]).toMatchObject({
      status: "gate_failed",
      failedStages: ["gate_verify"],
    });

    const taskState = JSON.parse(
      fs.readFileSync(
        path.join(root, "specs", "049-fail", ".gwrk", "tasks.json"),
        "utf-8",
      ),
    );
    expect(taskState.phases[0].tasks[0].status).toBe("open");
  });

  it("exits 2 on invalid CLI arguments with ADR-004 signal", async () => {
    const { root } = createFeatureRepo({
      dir: path.join(workspaceDir, "bad-args"),
      featureId: "049-args",
    });
    process.chdir(root);

    const badPr = await runHarvest(["049-args", "--pr", "not-a-number"]);
    expect(badPr.exitCode).toBe(2);
    expect(badPr.stderr).toMatch(/\[exit:2 \| /);

    const zeroPr = await runHarvest(["049-args", "--pr", "0"]);
    expect(zeroPr.exitCode).toBe(2);
    expect(zeroPr.stderr).toMatch(/\[exit:2 \| /);

    const badFormat = await runHarvest(["049-args", "--format", "xml"]);
    expect(badFormat.exitCode).toBe(2);
    expect(badFormat.stderr).toMatch(/\[exit:2 \| /);
  });

  it("supports --project selection, converges with existing PR harvest, preserves caller receipt unless --no-notify, and exits 0 for closed_unmerged", async () => {
    const alpha = createFeatureRepo({
      dir: path.join(workspaceDir, "alpha"),
      trunk: "main",
      remoteUrl: "git@github.com:org/alpha.git",
      featureId: "049-shared",
      phaseId: "phase-01",
      gateExitCode: 0,
    });
    const beta = createFeatureRepo({
      dir: path.join(workspaceDir, "beta"),
      trunk: "develop",
      remoteUrl: "git@github.com:org/beta.git",
      featureId: "049-shared",
      phaseId: "phase-01",
      gateExitCode: 0,
    });

    const db = openDatabase();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const store = createSqliteOperationsStoreAdapter({ db });
      const alphaProject: EnrolledProject = registry.enrollProject({
        projectId: computeProjectId({
          projectRoot: alpha.root,
          remoteOriginUrl: "git@github.com:org/alpha.git",
          gitCommonDir: path.join(alpha.root, ".git"),
        }),
        slug: "alpha",
        name: "Alpha",
        repoSlug: "org/alpha",
        trunkBranch: "main",
        localRoot: alpha.root,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_TEST",
          channelId: "C_ALPHA",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      });
      const betaProject: EnrolledProject = registry.enrollProject({
        projectId: computeProjectId({
          projectRoot: beta.root,
          remoteOriginUrl: "git@github.com:org/beta.git",
          gitCommonDir: path.join(beta.root, ".git"),
        }),
        slug: "beta",
        name: "Beta",
        repoSlug: "org/beta",
        trunkBranch: "develop",
        localRoot: beta.root,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_TEST",
          channelId: "C_BETA",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      });

      // Seed feature thread and original dispatch caller receipt on alpha
      registry.bindFeatureThread({
        projectId: alphaProject.projectId,
        featureId: "049-shared",
        workspaceId: "T_TEST",
        channelId: "C_ALPHA",
        rootTs: "1732300000.000111",
        updatedAt: "2026-11-23T08:59:00.000Z",
      });
      store.acceptDispatch({
        projectId: alphaProject.projectId,
        featureId: "049-shared",
        phaseId: "phase-01",
        backend: "claude",
        trunkBranch: "main",
        recipient: {
          projectId: alphaProject.projectId,
          surface: "slack",
          workspaceId: "T_TEST",
          channelId: "C_ALPHA",
          threadTs: "1732300000.000111",
          actorUserId: "U_CALLER",
        },
        newOperationId: "disp-alpha-caller",
        nowIso: "2026-11-23T09:00:00.000Z",
      });

      const sentPayloads: Array<{
        projectId?: string;
        channel?: string;
        threadTs?: string;
        actorUserId?: string;
      }> = [];
      const notifier: NotificationPort = {
        async notify(payload) {
          sentPayloads.push({
            projectId: payload.projectId,
            channel: payload.channel,
            threadTs: payload.threadTs,
            actorUserId: payload.recipient?.actorUserId,
          });
          return {
            delivered: true,
            channelId: payload.channel ?? "C_ALPHA",
            messageTs: "1732300000.000222",
            threadTs: payload.threadTs,
          };
        },
      };

      const github: GitHubHarvestPort = {
        verifyWebhookSignature: () => false,
        listTerminalPullRequests: async () => [],
        getPullRequest: async ({ repoSlug, prNumber }) => {
          if (repoSlug === "org/alpha" && prNumber === 42) {
            return {
              repoSlug: "org/alpha",
              headRepoSlug: "org/alpha",
              prNumber: 42,
              prUrl: "https://github.com/org/alpha/pull/42",
              state: "MERGED",
              merged: true,
              baseBranch: "main",
              headBranch: "feat/049-shared-phase-01",
              headSha: null,
              mergeCommitSha: alpha.headSha,
              mergedAt: "2026-11-23T10:00:00.000Z",
              closedAt: "2026-11-23T10:00:00.000Z",
            };
          }
          if (repoSlug === "org/beta" && prNumber === 42) {
            return {
              repoSlug: "org/beta",
              headRepoSlug: "org/beta",
              prNumber: 42,
              prUrl: "https://github.com/org/beta/pull/42",
              state: "CLOSED",
              merged: false,
              baseBranch: "develop",
              headBranch: "feat/049-shared-phase-01",
              headSha: null,
              mergeCommitSha: null,
              mergedAt: null,
              closedAt: "2026-11-23T10:01:00.000Z",
            };
          }
          if (repoSlug === "org/beta" && prNumber === 43) {
            return {
              repoSlug: "org/beta",
              headRepoSlug: "org/beta",
              prNumber: 43,
              prUrl: "https://github.com/org/beta/pull/43",
              state: "MERGED",
              merged: true,
              baseBranch: "develop",
              headBranch: "feat/049-shared-phase-01",
              headSha: null,
              mergeCommitSha: beta.headSha,
              mergedAt: "2026-11-23T10:02:00.000Z",
              closedAt: "2026-11-23T10:02:00.000Z",
            };
          }
          return null;
        },
      };

      const vcsOverrides = {
        fetchBranch: () => {},
        getRemoteBranchSha: async () => null,
        deleteRemoteBranchAtTip: async () => ({
          deleted: false,
          reason: "missing" as const,
        }),
      };

      // Run from beta cwd while explicitly selecting --project alpha
      process.chdir(beta.root);
      const alphaPrRes = await runHarvest(
        ["049-shared", "phase-01", "--project", "alpha", "--pr", "42", "--format", "json"],
        { deps: { github, notifier, vcsOverrides } },
      );
      expect(alphaPrRes.exitCode, alphaPrRes.stderr).toBe(0);
      const alphaParsed = JSON.parse(alphaPrRes.stdout);
      expect(alphaParsed.projectId).toBe(alphaProject.projectId);
      expect(alphaParsed.operations[0].status).toBe("completed");
      // Omitted recipient preserved original caller dispatch receipt and feature thread
      expect(sentPayloads).toEqual([
        {
          projectId: alphaProject.projectId,
          channel: "C_ALPHA",
          threadTs: "1732300000.000111",
          actorUserId: "U_CALLER",
        },
      ]);

      // Converge manual commit harvest against the already-harvested merged PR
      const convergedRes = await runHarvest(
        [
          "049-shared",
          "phase-01",
          "--project",
          "alpha",
          "--commit",
          alpha.headSha,
          "--format",
          "json",
        ],
        { deps: { github, notifier, vcsOverrides } },
      );
      expect(convergedRes.exitCode, convergedRes.stderr).toBe(0);
      const convergedParsed = JSON.parse(convergedRes.stdout);
      expect(convergedParsed.operations[0].operationId).toBe(
        alphaParsed.operations[0].operationId,
      );
      expect(convergedParsed.operations[0].deduplicatedWork).toBe(true);
      expect(sentPayloads).toHaveLength(1);
      expect(listRuns("049-shared", alphaProject.projectId, db)).toHaveLength(1);

      // Closed unmerged PR #42 on beta exits 0 without failing or sending Slack
      const closedRes = await runHarvest(
        ["049-shared", "phase-01", "--project", "beta", "--pr", "42", "--format", "json"],
        { deps: { github, notifier, vcsOverrides } },
      );
      expect(closedRes.exitCode, closedRes.stderr).toBe(0);
      const closedParsed = JSON.parse(closedRes.stdout);
      expect(closedParsed.projectId).toBe(betaProject.projectId);
      expect(closedParsed.operations[0].status).toBe("closed_unmerged");
      expect(sentPayloads).toHaveLength(1);

      // Explicit --no-notify passes null recipient suppression on beta PR #43
      const suppressedRes = await runHarvest(
        [
          "049-shared",
          "phase-01",
          "--project",
          "beta",
          "--pr",
          "43",
          "--no-notify",
          "--format",
          "json",
        ],
        { deps: { github, notifier, vcsOverrides } },
      );
      expect(suppressedRes.exitCode, suppressedRes.stderr).toBe(0);
      expect(JSON.parse(suppressedRes.stdout).operations[0].status).toBe("completed");
      // Explicit null recipient suppressed Slack delivery on beta
      expect(sentPayloads).toHaveLength(1);
    } finally {
      if (db.open) db.close();
    }
  });

  it("T036 regression: executes gwrk harvest --project <slug> via root CLI when cwd has no .gwrkrc.json", async () => {
    const alpha = createFeatureRepo({
      dir: path.join(workspaceDir, "alpha-cli"),
      trunk: "main",
      featureId: "049-cli-proj",
      phaseId: "phase-01",
      gateExitCode: 0,
    });
    const hostDir = path.join(workspaceDir, "host-no-config");
    fs.mkdirSync(hostDir, { recursive: true });

    const db = openDatabase();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        projectId: computeProjectId({
          projectRoot: alpha.root,
          remoteOriginUrl: null,
          gitCommonDir: path.join(alpha.root, ".git"),
        }),
        slug: "alpha-cli",
        name: "Alpha CLI",
        repoSlug: null,
        trunkBranch: "main",
        localRoot: alpha.root,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      });
    } finally {
      if (db.open) db.close();
    }

    process.chdir(hostDir);
    let stdout = "";
    let stderr = "";
    const exitCode = await runCli(
      [
        "harvest",
        "049-cli-proj",
        "phase-01",
        "--project",
        "alpha-cli",
        "--commit",
        alpha.headSha,
        "--format",
        "json",
      ],
      {
        stdout: (chunk) => {
          stdout += chunk;
        },
        stderr: (chunk) => {
          stderr += chunk;
        },
      },
    );
    expect(exitCode, stderr).toBe(0);
    expect(stderr).toMatch(/\[exit:0 \| /);
    const parsed = JSON.parse(stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.projectSlug).toBe("alpha-cli");
    expect(parsed.operations[0].status).toBe("completed");
  });
});
