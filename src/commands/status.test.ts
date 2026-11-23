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
import { createSqliteOperationsStoreAdapter, createSqliteProjectRegistryAdapter } from "../adapters/sqlite/index.js";
import { runCli } from "../cli.js";
import { openDatabase } from "../db/index.js";
import { computeHarvestWorkKey } from "../domain/durable-harvest.js";
import { computeProjectId } from "../domain/project-id.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import * as pidUtils from "../server/pid.js";
import type { HealthResponse, SystemStatus } from "../server/types.js";
import { createStatusCommand } from "./status.js";

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

function initGitRepo(dir: string, remoteUrl?: string): string {
  const realDir = fs.realpathSync(dir);
  runGit(realDir, "init", "--template=", "--initial-branch=main");
  runGit(realDir, "commit", "--no-gpg-sign", "--allow-empty", "-m", "init");
  if (remoteUrl) {
    runGit(realDir, "remote", "add", "origin", remoteUrl);
  }
  return realDir;
}

async function runStatus(
  args: string[],
  rootFormat?: "json",
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
    program.addCommand(createStatusCommand());
    const argv = rootFormat
      ? ["--format", rootFormat, "status", ...args]
      : ["status", ...args];
    await program.parseAsync(argv, { from: "user" });
  });
  return { stdout, stderr, exitCode: scope.exitCode };
}

describe("TR-022: gwrk status liveness, reachability, readiness and Slack delivery", () => {
  let tempDir: string;
  let gwrkHome: string;
  let oldCwd: string;

  beforeEach(() => {
    oldCwd = process.cwd();
    tempDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-status-test-")),
    );
    gwrkHome = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-status-home-")),
    );
    vi.stubEnv("GWRK_HOME", gwrkHome);
    vi.stubEnv("GWRK_DIR", "");
    vi.stubEnv("GWRK_DB_PATH", "");
    vi.stubEnv("GWRK_RUNTIME_DIR", "");
    vi.stubEnv("GWRK_SERVER_URL", "");
    initGitRepo(tempDir, "git@github.com:org/status-demo.git");
    process.chdir(tempDir);
  });

  afterEach(() => {
    process.chdir(oldCwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(gwrkHome, { recursive: true, force: true });
  });

  it("exits non-zero with serverReachable: false when a configured server is unreachable under --json and --format json", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 19991 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:19991")),
    );

    for (const [args, rootFormat] of [
      [["--json"], undefined],
      [[], "json"],
    ] as const) {
      const result = await runStatus([...args], rootFormat);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/\[exit:1 \| /);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.daemonLiveness).toBe("stopped");
      expect(parsed.serverConfigured).toBe(true);
      expect(parsed.serverReachable).toBe(false);
      expect(parsed.serverError).toContain("ECONNREFUSED");
      expect(parsed.telegram).toEqual({
        enabled: false,
        reason: "disabled_in_pilot",
      });
    }
  });

  it("exits non-zero when a running local daemon fails health or status checks", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "status-demo" } }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(process.pid);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "unavailable" }),
      }),
    );

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/\[exit:1 \| /);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("alive");
    expect(parsed.serverReachable).toBe(false);
    expect(parsed.serverError).toContain("503");
  });

  it("surfaces distinct daemonLiveness, projectReadiness, slackDelivery and durable operations when reachable", async () => {
    const projectId = computeProjectId({
      projectRoot: tempDir,
      remoteOriginUrl: "git@github.com:org/status-demo.git",
      gitCommonDir: path.join(tempDir, ".git"),
    });
    const registry = createSqliteProjectRegistryAdapter();
    try {
      const enrolled: EnrolledProject = {
        projectId,
        slug: "status-demo",
        name: "status-demo",
        repoSlug: "org/status-demo",
        trunkBranch: "main",
        localRoot: tempDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
          opsChannelId: "C_OPS",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      };
      registry.enrollProject(enrolled);
    } finally {
      registry.close();
    }

    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 18790 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(process.pid);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(true);

    const healthPayload: HealthResponse = {
      status: "degraded",
      daemonLiveness: "alive",
      projectReadiness: {
        status: "ready",
        readyCount: 1,
        totalCount: 1,
        projects: [
          {
            projectId,
            slug: "status-demo",
            repoSlug: "org/status-demo",
            trunkBranch: "main",
            checkoutPath: tempDir,
            checkoutReady: true,
            runnerAllowed: true,
            slackBound: true,
            status: "ready",
          },
        ],
      },
      slackDelivery: {
        mode: "degraded",
        workspaceId: "T_DEMO",
        connected: false,
        lastError: "socket disconnected",
      },
      telegram: {
        enabled: false,
        reason: "disabled_in_pilot",
      },
      components: {
        server: { status: "ok" },
        git: { status: "ok" },
        network: { status: "ok" },
        slack: { status: "degraded", message: "socket disconnected" },
      },
    };
    const statusPayload: SystemStatus = {
      projectId,
      server: {
        status: "running",
        lifecycle: "ready",
        pid: process.pid,
        uptime: 42,
        port: 18790,
      },
      system: { cpuPercent: 12, memPercent: 34, diskFreeGb: 100 },
      network: { status: "online" },
      dispatch: {
        queueDepth: 1,
        activeCount: 0,
        completedCount: 2,
        failedCount: 0,
        paused: false,
      },
      sandboxes: [],
    };

    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) {
        return {
          ok: true,
          status: 200,
          json: async () => healthPayload,
        };
      }
      if (url.includes("/api/status")) {
        return {
          ok: true,
          status: 200,
          json: async () => statusPayload,
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toMatch(/\[exit:0 \| /);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("alive");
    expect(parsed.serverReachable).toBe(true);
    expect(parsed.projectReadiness).toMatchObject({
      status: "ready",
      readyCount: 1,
      totalCount: 1,
    });
    expect(parsed.slackDelivery).toEqual({
      mode: "degraded",
      workspaceId: "T_DEMO",
      connected: false,
      lastError: "socket disconnected",
    });
    expect(parsed.telegram).toEqual({
      enabled: false,
      reason: "disabled_in_pilot",
    });
    expect(parsed.dispatch).toMatchObject({ queueDepth: 1, completedCount: 2 });
    expect(parsed.durableOperations).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/status?projectId=${encodeURIComponent(projectId)}`),
      expect.anything(),
    );
  });

  it("exits 0 with stopped daemon and local readiness when no server is running or configured", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "status-demo" } }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runStatus(["--json"]);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    const parsed = JSON.parse(result.stdout);
    expect(parsed.daemonLiveness).toBe("stopped");
    expect(parsed.serverConfigured).toBe(false);
    expect(parsed.serverReachable).toBe(false);
    expect(parsed.projectReadiness.status).toBe("unconfigured");
  });

  it("exits non-zero in text mode when a configured server is unreachable", async () => {
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "status-demo" },
        server: { host: "127.0.0.1", port: 19992 },
      }),
    );
    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")),
    );

    const result = await runStatus([]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("gwrk server is unreachable");
    expect(result.stdout).toContain("Project Readiness");
    expect(result.stdout).toContain("Telegram:");
    expect(result.stderr).toMatch(/\[exit:1 \| /);
  });

  it("T037 / TR-004: renders queue age, pending stages, legacy counts and exits non-zero on unresolved gate_failed or failed delivery while keeping closed_unmerged exit 0", async () => {
    const projectId = computeProjectId({
      projectRoot: tempDir,
      remoteOriginUrl: "git@github.com:org/status-demo.git",
      gitCommonDir: path.join(tempDir, ".git"),
    });
    fs.writeFileSync(
      path.join(tempDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "status-demo" } }),
    );
    fs.mkdirSync(path.join(tempDir, ".gwrk"), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, ".gwrk", "dispatches.jsonl"),
      `${JSON.stringify({
        id: "legacy-1",
        featureId: "001-legacy",
        phaseId: "phase-01",
        backend: "claude",
        branchName: "feat/001-legacy-phase-01",
        status: "completed",
        attempts: [],
        tasks: [],
        createdAt: "2026-11-01T00:00:00.000Z",
      })}\n`,
    );

    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn());

    const db = openDatabase();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      const ops = createSqliteOperationsStoreAdapter({ db });
      const enrolled: EnrolledProject = {
        projectId,
        slug: "status-demo",
        name: "status-demo",
        repoSlug: "org/status-demo",
        trunkBranch: "main",
        localRoot: tempDir,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local"] },
        slack: {
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
          sharedChannel: false,
        },
        legacyProjectIds: [],
        createdAt: "2026-11-23T00:00:00.000Z",
        updatedAt: "2026-11-23T00:00:00.000Z",
      };
      registry.enrollProject(enrolled);

      // Seed queued dispatch for queue age + closed_unmerged harvest + pending/uncertain outbox
      ops.acceptDispatch({
        projectId,
        featureId: "049-durable",
        phaseId: "phase-06",
        backend: "claude",
        trunkBranch: "main",
        recipient: null,
        newOperationId: "disp-age-1",
        nowIso: "2026-11-23T10:00:00.000Z",
      });

      const closedIntake = ops.recordHarvestIntake({
        candidate: {
          source: "github_webhook",
          deliveryId: "deliv-closed-1",
          repoSlug: "org/status-demo",
          headRepoSlug: "org/status-demo",
          baseBranch: "main",
          headBranch: "feat/049-durable-phase-01",
          expectedHeadSha: "a".repeat(40),
          prNumber: 77,
          prUrl: "https://github.com/org/status-demo/pull/77",
          terminalEvent: "closed_unmerged",
          mergeCommitSha: null,
          terminalAt: "2026-11-23T10:05:00.000Z",
          recipient: null,
        },
        payloadDigest: "digest-closed-1",
        receivedAt: "2026-11-23T10:05:01.000Z",
        target: {
          accepted: true,
          project: enrolled,
          operations: [
            {
              operationId: "harv-closed-1",
              projectId,
              workKey: computeHarvestWorkKey({
                repoSlug: "org/status-demo",
                baseBranch: "main",
                prNumber: 77,
                terminalEvent: "closed_unmerged",
                mergeCommitSha: null,
                featureId: "049-durable",
                phaseId: "phase-01",
              }),
              repoSlug: "org/status-demo",
              headRepoSlug: "org/status-demo",
              trunkBranch: "main",
              featureId: "049-durable",
              phaseId: "phase-01",
              prNumber: 77,
              prUrl: "https://github.com/org/status-demo/pull/77",
              headBranch: "feat/049-durable-phase-01",
              expectedHeadSha: "a".repeat(40),
              terminalEvent: "closed_unmerged",
              mergeCommitSha: null,
              terminalAt: "2026-11-23T10:05:00.000Z",
              recipient: null,
              plannedSlackRecipient: null,
              status: "accepted",
              leaseOwner: null,
              leaseEpoch: 0,
              leaseExpiresAt: null,
              linkedRunId: null,
              lastError: null,
              createdAt: "2026-11-23T10:05:01.000Z",
              updatedAt: "2026-11-23T10:05:01.000Z",
              completedAt: null,
            },
          ],
        },
      });
      expect(closedIntake.ok).toBe(true);
      const closedLease = ops.claimHarvestLease({
        operationId: "harv-closed-1",
        leaseOwner: "test",
        nowIso: "2026-11-23T10:05:02.000Z",
        leaseExpiresAt: "2026-11-23T10:15:02.000Z",
      });
      expect(closedLease).not.toBeNull();
      if (closedLease) {
        ops.initializeHarvestStages({
          fence: closedLease.fence,
          nowIso: "2026-11-23T10:05:02.000Z",
          phaseIds: ["phase-01"],
          hasSlackTarget: false,
          hasRemoteBranchTarget: false,
          stages: [
            {
              phaseKey: "phase-01",
              stage: "learning_record",
              initialStatus: "pending",
            },
          ],
        });
        ops.transitionHarvestStage({
          fence: closedLease.fence,
          nowIso: "2026-11-23T10:05:03.000Z",
          phaseKey: "phase-01",
          stage: "learning_record",
          status: "succeeded",
        });
      }

      // Seed an uncertain outbox delivery (must NOT appear delivered, but is not terminal failed)
      const uncertainOutbox = ops.enqueueOutbox({
        outboxId: "outbox-uncertain-1",
        projectId,
        dedupeKey: "dedupe-uncertain-1",
        ownerKind: "dispatch",
        ownerOperationId: "disp-age-1",
        eventType: "review_ready",
        featureId: "049-durable",
        phaseId: "phase-06",
        recipient: {
          projectId,
          surface: "slack",
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
        },
        payload: { text: "review ready" },
        clientMetadataKey: "meta-uncertain-1",
        nowIso: "2026-11-23T10:06:00.000Z",
      });
      const uncertainClaim = ops.claimOutboxItem({
        outboxId: uncertainOutbox.outboxId,
        nowIso: "2026-11-23T10:06:01.000Z",
        destination: {
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
          threadTs: null,
        },
      });
      expect(uncertainClaim && "claim" in uncertainClaim).toBe(true);
      if (uncertainClaim && "claim" in uncertainClaim) {
        ops.markOutboxUncertain({
          claim: uncertainClaim.claim,
          nowIso: "2026-11-23T10:06:02.000Z",
          error: "timeout",
        });
      }

      // 1. closed_unmerged + uncertain delivery + queued item -> exit 0, JSON & text show counts distinctly
      const healthyJson = await runStatus([
        "--project",
        "status-demo",
        "--format",
        "json",
      ]);
      expect(healthyJson.exitCode).toBe(0);
      expect(healthyJson.stderr).toMatch(/\[exit:0 \| /);
      const parsedHealthy = JSON.parse(healthyJson.stdout);
      expect(parsedHealthy.durableOperations.queue.oldestQueuedAt).toBe(
        "2026-11-23T10:00:00.000Z",
      );
      expect(typeof parsedHealthy.queueAgeSeconds).toBe("number");
      expect(parsedHealthy.durableOperations.harvest.closedUnmergedCount).toBe(1);
      expect(parsedHealthy.durableOperations.harvest.unresolvedGateFailures).toBe(0);
      expect(parsedHealthy.durableOperations.delivery.uncertainCount).toBe(1);
      expect(parsedHealthy.durableOperations.delivery.failedCount).toBe(0);
      expect(parsedHealthy.durableOperations.historical.legacyUnverifiedDispatches).toBe(1);

      const healthyText = await runStatus(["--project", "status-demo"]);
      expect(healthyText.exitCode).toBe(0);
      expect(healthyText.stdout).toContain("Closed unmerged");
      expect(healthyText.stdout).toContain("uncertain");
      expect(healthyText.stdout).toContain("Legacy unverified dispatches");
      expect(healthyText.stdout).not.toMatch(/outbox.*delivered/i);

      // 2. Add unresolved gate_failed harvest -> MUST exit 1 with remediation hint
      const mergeIntake = ops.recordHarvestIntake({
        candidate: {
          source: "github_webhook",
          deliveryId: "deliv-gate-fail-1",
          repoSlug: "org/status-demo",
          headRepoSlug: "org/status-demo",
          baseBranch: "main",
          headBranch: "feat/049-durable-phase-02",
          expectedHeadSha: "b".repeat(40),
          prNumber: 78,
          prUrl: "https://github.com/org/status-demo/pull/78",
          terminalEvent: "merged",
          mergeCommitSha: "c".repeat(40),
          terminalAt: "2026-11-23T10:10:00.000Z",
          recipient: null,
        },
        payloadDigest: "digest-gate-fail-1",
        receivedAt: "2026-11-23T10:10:01.000Z",
        target: {
          accepted: true,
          project: enrolled,
          operations: [
            {
              operationId: "harv-gate-fail-1",
              projectId,
              workKey: computeHarvestWorkKey({
                repoSlug: "org/status-demo",
                baseBranch: "main",
                prNumber: 78,
                terminalEvent: "merged",
                mergeCommitSha: "c".repeat(40),
                featureId: "049-durable",
                phaseId: "phase-02",
              }),
              repoSlug: "org/status-demo",
              headRepoSlug: "org/status-demo",
              trunkBranch: "main",
              featureId: "049-durable",
              phaseId: "phase-02",
              prNumber: 78,
              prUrl: "https://github.com/org/status-demo/pull/78",
              headBranch: "feat/049-durable-phase-02",
              expectedHeadSha: "b".repeat(40),
              terminalEvent: "merged",
              mergeCommitSha: "c".repeat(40),
              terminalAt: "2026-11-23T10:10:00.000Z",
              recipient: null,
              plannedSlackRecipient: null,
              status: "accepted",
              leaseOwner: null,
              leaseEpoch: 0,
              leaseExpiresAt: null,
              linkedRunId: null,
              lastError: null,
              createdAt: "2026-11-23T10:10:01.000Z",
              updatedAt: "2026-11-23T10:10:01.000Z",
              completedAt: null,
            },
          ],
        },
      });
      expect(mergeIntake.ok).toBe(true);
      const mergeLease = ops.claimHarvestLease({
        operationId: "harv-gate-fail-1",
        leaseOwner: "test",
        nowIso: "2026-11-23T10:10:02.000Z",
        leaseExpiresAt: "2026-11-23T10:20:02.000Z",
      });
      expect(mergeLease).not.toBeNull();
      if (mergeLease) {
        ops.initializeHarvestStages({
          fence: mergeLease.fence,
          nowIso: "2026-11-23T10:10:02.000Z",
          phaseIds: ["phase-02"],
          hasSlackTarget: false,
          hasRemoteBranchTarget: true,
          stages: [
            { phaseKey: "phase-02", stage: "git_sync", initialStatus: "pending" },
            { phaseKey: "phase-02", stage: "gate_verify", initialStatus: "pending" },
            { phaseKey: "phase-02", stage: "learning_record", initialStatus: "pending" },
            { phaseKey: "phase-02", stage: "slack_delivery", initialStatus: "skipped_no_target" },
            { phaseKey: "phase-02", stage: "branch_cleanup", initialStatus: "pending" },
          ],
        });
        ops.transitionHarvestStage({
          fence: mergeLease.fence,
          nowIso: "2026-11-23T10:10:03.000Z",
          phaseKey: "phase-02",
          stage: "git_sync",
          status: "succeeded",
        });
        ops.transitionHarvestStage({
          fence: mergeLease.fence,
          nowIso: "2026-11-23T10:10:04.000Z",
          phaseKey: "phase-02",
          stage: "gate_verify",
          status: "gate_failed",
          failureNotice: null,
          error: "T001 gate failed",
        });
      }

      const gateFailJson = await runStatus([
        "--project",
        "status-demo",
        "--format",
        "json",
      ]);
      expect(gateFailJson.exitCode).toBe(1);
      expect(gateFailJson.stderr).toMatch(/\[exit:1 \| /);
      expect(gateFailJson.stderr).toContain("hint:");
      const parsedGateFail = JSON.parse(gateFailJson.stdout);
      expect(parsedGateFail.durableOperations.harvest.unresolvedGateFailures).toBe(1);
      expect(parsedGateFail.durableOperations.harvest.closedUnmergedCount).toBe(1);

      // 3. Also verify failed delivery alone triggers exit 1
      db.prepare("DELETE FROM harvest_operations WHERE operation_id = ?").run(
        "harv-gate-fail-1",
      );
      const failedOutbox = ops.enqueueOutbox({
        outboxId: "outbox-failed-1",
        projectId,
        dedupeKey: "dedupe-failed-1",
        ownerKind: "dispatch",
        ownerOperationId: "disp-age-1",
        eventType: "phase_fail",
        featureId: "049-durable",
        phaseId: "phase-06",
        recipient: {
          projectId,
          surface: "slack",
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
        },
        payload: { text: "phase failed" },
        clientMetadataKey: "meta-failed-1",
        nowIso: "2026-11-23T10:11:00.000Z",
      });
      const failClaim = ops.claimOutboxItem({
        outboxId: failedOutbox.outboxId,
        nowIso: "2026-11-23T10:11:01.000Z",
        destination: {
          workspaceId: "T_DEMO",
          channelId: "C_DEMO",
          threadTs: null,
        },
      });
      if (failClaim && "claim" in failClaim) {
        ops.completeOutboxItem({
          claim: failClaim.claim,
          nowIso: "2026-11-23T10:11:02.000Z",
          outcome: { status: "failed", error: "channel_not_found" },
        });
      }

      const deliveryFailJson = await runStatus([
        "--project",
        "status-demo",
        "--json",
      ]);
      expect(deliveryFailJson.exitCode).toBe(1);
      expect(deliveryFailJson.stderr).toMatch(/\[exit:1 \| /);
      expect(deliveryFailJson.stderr).toContain("hint:");
      expect(JSON.parse(deliveryFailJson.stdout).durableOperations.delivery.failedCount).toBe(1);
    } finally {
      if (db.open) db.close();
    }
  });

  it("T037 regression: scopes git and spec metadata to --project <slug> and works via root CLI without cwd .gwrkrc.json", async () => {
    const alphaDir = fs.realpathSync(
      fs.mkdtempSync(path.join(tempDir, "alpha-status-")),
    );
    const betaDir = fs.realpathSync(
      fs.mkdtempSync(path.join(tempDir, "beta-status-")),
    );
    const emptyHostDir = fs.realpathSync(
      fs.mkdtempSync(path.join(tempDir, "empty-host-")),
    );

    initGitRepo(alphaDir, "git@github.com:org/alpha-status.git");
    runGit(alphaDir, "checkout", "-b", "alpha-trunk");
    fs.mkdirSync(path.join(alphaDir, "specs", "049-alpha"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(alphaDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "alpha-status" } }),
    );
    runGit(alphaDir, "add", ".");
    runGit(alphaDir, "commit", "--no-gpg-sign", "-m", "add alpha spec");

    initGitRepo(betaDir, "git@github.com:org/beta-status.git");
    runGit(betaDir, "checkout", "-b", "beta-other");
    fs.writeFileSync(
      path.join(betaDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "beta-status" } }),
    );
    // Leave beta dirty with an untracked file and 0 specs
    fs.writeFileSync(path.join(betaDir, "dirty.txt"), "dirty\n");

    vi.spyOn(pidUtils, "readPid").mockReturnValue(undefined);
    vi.spyOn(pidUtils, "isPidRunning").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn());

    const alphaId = computeProjectId({
      projectRoot: alphaDir,
      remoteOriginUrl: "git@github.com:org/alpha-status.git",
      gitCommonDir: path.join(alphaDir, ".git"),
    });
    const db = openDatabase();
    try {
      const registry = createSqliteProjectRegistryAdapter({ db });
      registry.enrollProject({
        projectId: alphaId,
        slug: "alpha-status",
        name: "Alpha Status",
        repoSlug: "org/alpha-status",
        trunkBranch: "alpha-trunk",
        localRoot: alphaDir,
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

    // 1. From betaDir, --project alpha-status must report alpha's git branch, clean state, and spec count
    process.chdir(betaDir);
    const crossDir = await runStatus([
      "--project",
      "alpha-status",
      "--format",
      "json",
    ]);
    expect(crossDir.exitCode, crossDir.stderr).toBe(0);
    const crossParsed = JSON.parse(crossDir.stdout);
    expect(crossParsed.project.slug).toBe("alpha-status");
    expect(crossParsed.project.root).toBe(alphaDir);
    expect.soft(crossParsed.project.git).toEqual({
      branch: "alpha-trunk",
      clean: true,
    });
    expect.soft(crossParsed.specs).toBe(1);

    // 2. From emptyHostDir (no .gwrkrc.json), root CLI `gwrk status --project alpha-status --format json` must succeed
    process.chdir(emptyHostDir);
    let stdout = "";
    let stderr = "";
    const cliExit = await runCli(
      ["status", "--project", "alpha-status", "--format", "json"],
      {
        stdout: (chunk) => {
          stdout += chunk;
        },
        stderr: (chunk) => {
          stderr += chunk;
        },
      },
    );
    expect.soft(cliExit, stderr).toBe(0);
    expect.soft(stderr).toMatch(/\[exit:0 \| /);
    if (stdout.trim()) {
      const cliParsed = JSON.parse(stdout);
      expect(cliParsed.project.slug).toBe("alpha-status");
      expect(cliParsed.durableOperations.projectId).toBe(alphaId);
    }
  });
});
