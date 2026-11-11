/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
  fixtureGit,
} from "../../tests/helpers/server-fixture.js";
import { getCompressionRecord } from "../db/compression.js";
import { getGateResults } from "../db/gates.js";
import { getDb } from "../db/index.js";
import { listRuns, startRun } from "../db/runs.js";
import { gatherDeliveryActuals } from "../engine/compression.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import { execCommand } from "../utils/exec.js";
import { syncTrunkForHarvest } from "../utils/git.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { PlanHeartbeat } from "./heartbeat.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import { removePid, writePid } from "./pid.js";
import { startSlackApp } from "./slack.js";

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    execFileSync: vi.fn(original.execFileSync),
    execSync: vi.fn(original.execSync),
  };
});
vi.mock("fastify", async (importOriginal) => {
  const original = await importOriginal<typeof import("fastify")>();
  return { ...original, default: vi.fn(original.default) };
});
vi.mock("./pid.js", () => ({ removePid: vi.fn(), writePid: vi.fn() }));
vi.mock("./slack.js", () => ({
  getSlackApp: vi.fn().mockReturnValue(null),
  startSlackApp: vi.fn().mockResolvedValue(undefined),
  stopSlackApp: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./telegram.js", () => ({
  startTelegramBot: vi.fn().mockResolvedValue(undefined),
  stopTelegramBot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));
vi.mock("../engine/compression.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../engine/compression.js")>()),
  gatherDeliveryActuals: vi.fn(),
}));
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: vi.fn(() => {
    throw new Error("Unexpected access to the default SQLite connection");
  }),
}));
vi.mock("../utils/exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/exec.js")>()),
  execCommand: vi.fn(),
}));
vi.mock("../utils/git.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/git.js")>()),
  deleteRemoteBranch: vi.fn(),
  syncTrunkForHarvest: vi.fn(),
}));

function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function portOf({ app }: ServerFixture): number {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a loopback listener");
  }
  return address.port;
}

function stubListener() {
  const app = fastify();
  vi.mocked(fastify).mockReturnValueOnce(app);
  vi.spyOn(app, "listen").mockResolvedValue("http://127.0.0.1:0");
}

describe("Server E2E Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);
    vi.spyOn(NetworkMonitor.prototype, "isOnline").mockReturnValue(true);
    vi.mocked(execCommand).mockImplementation(async (command, args) => {
      if (command !== "gh" || args.slice(0, 2).join(" ") !== "pr list") {
        throw new Error(`Unexpected subprocess: ${command}`);
      }
      return { exitCode: 0, stdout: "[]", stderr: "" };
    });
    vi.mocked(ShipOrchestrator).mockImplementation(
      () =>
        ({
          run: async () => 0,
          getResult: () => ({}),
        }) as ShipOrchestrator,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("keeps two live servers on separate roots and closes their listeners and pollers", async () => {
    const workstationPid = join(homedir(), ".gwrk", "server.pid");
    const checkoutJournal = join(process.cwd(), ".gwrk", "dispatches.jsonl");
    const originalPid = readIfPresent(workstationPid);
    const originalJournal = readIfPresent(checkoutJournal);
    const signalCounts = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
    ];
    const schedule = vi.spyOn(globalThis, "setInterval");
    const cancel = vi.spyOn(globalThis, "clearInterval");
    const fixtures: ServerFixture[] = [];

    try {
      const first = await createServerFixture("listen");
      fixtures.push(first);
      const second = await createServerFixture("listen");
      fixtures.push(second);

      const pollers = schedule.mock.results.map(({ value }) => value);
      expect(pollers).toHaveLength(10);
      expect(portOf(first)).not.toBe(portOf(second));
      expect([
        process.listenerCount("SIGINT"),
        process.listenerCount("SIGTERM"),
      ]).toEqual(signalCounts);
      for (const fixture of fixtures) {
        expect(readFileSync(fixture.pidPath, "utf8")).toBe(String(process.pid));
        expect(fixtureGit(fixture.projectRoot, "remote")).toBe("");
      }

      for (const [index, fixture] of fixtures.entries()) {
        const featureId = `feature-${index}`;
        const response = await fixture.app.inject({
          method: "POST",
          url: "/api/dispatch",
          payload: { featureId, phaseId: "phase-01" },
        });
        expect(response.statusCode).toBe(201);
        const { id } = response.json();

        const queue = await fixture.app.inject({
          method: "GET",
          url: "/api/dispatch/queue",
        });
        expect(queue.statusCode).toBe(200);

        const lookup = await fixture.app.inject({
          method: "GET",
          url: `/api/dispatch/${featureId}/phase-01`,
        });
        expect(lookup.statusCode).toBe(200);
        expect(lookup.json().id).toBe(id);
        await vi.waitFor(() => {
          expect(fixture.journal().at(-1)).toMatchObject({
            id,
            status: "completed",
          });
        });
        const journal = fixture.journal();
        expect(journal.map(({ status }) => status)).toEqual([
          "queued",
          "running",
          "running",
          "completed",
        ]);
        expect(
          journal.every(
            (record) => record.id === id && record.featureId === featureId,
          ),
        ).toBe(true);
        expect(journal[2].workDir).toContain(
          join(fixture.projectRoot, ".runs", "sandboxes") + sep,
        );
        expect(listRuns(featureId, fixture.projectId, fixture.db)).toEqual([
          expect.objectContaining({
            exit_code: 0,
            finished_at: expect.any(String),
          }),
        ]);
        expect(fixture.db.prepare("SELECT feature_id FROM runs").all()).toEqual(
          [{ feature_id: featureId }],
        );
        expect(
          fixtureGit(
            fixture.projectRoot,
            "worktree",
            "list",
            "--porcelain",
          ).match(/^worktree /gm),
        ).toHaveLength(1);
        expect(fixtureGit(fixture.projectRoot, "remote")).toBe("");
      }

      expect(
        vi
          .mocked(execCommand)
          .mock.calls.map(([, , , options]) => options?.cwd),
      ).toEqual(fixtures.map(({ projectRoot }) => projectRoot));
      const gitRoots = [
        ...vi
          .mocked(execFileSync)
          .mock.calls.filter(([file]) => file === "git")
          .map(([, , options]) => options?.cwd),
        ...vi
          .mocked(execSync)
          .mock.calls.filter(
            ([command]) =>
              command.startsWith("git ") && command !== "git --version",
          )
          .map(([, options]) => options?.cwd),
      ];
      expect(gitRoots.length).toBeGreaterThan(0);
      for (const cwd of gitRoots) {
        expect(
          fixtures.some(
            ({ projectRoot }) =>
              cwd === projectRoot || String(cwd).startsWith(projectRoot + sep),
          ),
        ).toBe(true);
      }

      await first.app.close();
      expect(first.app.server.listening).toBe(false);
      expect(existsSync(first.pidPath)).toBe(false);
      expect(first.db.open).toBe(true);
      for (const poller of pollers.slice(0, 5))
        expect(cancel).toHaveBeenCalledWith(poller);
      for (const poller of pollers.slice(5))
        expect(cancel).not.toHaveBeenCalledWith(poller);
      expect(second.app.server.listening).toBe(true);
      expect(existsSync(second.pidPath)).toBe(true);

      await second.app.close();
      expect(second.app.server.listening).toBe(false);
      expect(existsSync(second.pidPath)).toBe(false);
      for (const poller of pollers.slice(5))
        expect(cancel).toHaveBeenCalledWith(poller);
      expect(readIfPresent(workstationPid)).toBe(originalPid);
      expect(readIfPresent(checkoutJournal)).toBe(originalJournal);
      expect(writePid).not.toHaveBeenCalled();
      expect(removePid).not.toHaveBeenCalled();
    } finally {
      await Promise.all(fixtures.map((fixture) => fixture.close()));
    }

    for (const fixture of fixtures) {
      expect(fixture.db.open).toBe(false);
      expect(existsSync(fixture.projectRoot)).toBe(false);
    }
  });

  it("uses scoped SQLite in the startup heartbeat", async () => {
    stubListener();
    const heartbeat = vi.spyOn(PlanHeartbeat.prototype, "runCheck");
    const fixture = await createServerFixture("listen");
    try {
      expect(heartbeat).toHaveBeenCalledOnce();
      const [result] = await Promise.allSettled([
        heartbeat.mock.results[0].value,
      ]);
      expect(getDb).not.toHaveBeenCalled();
      expect(result.status).toBe("fulfilled");
    } finally {
      await fixture.close();
    }
  });

  it("uses scoped persistence when the startup watcher sees terminal pull requests", async () => {
    stubListener();
    const watcher = vi.spyOn(HarvestWatcher.prototype, "runCheck");
    let returnPullRequests!: (
      value: Awaited<ReturnType<typeof execCommand>>,
    ) => void;
    vi.mocked(execCommand).mockReturnValueOnce(
      new Promise((resolve) => {
        returnPullRequests = resolve;
      }),
    );
    const fixture = await createServerFixture("listen");
    const closedAt = "2026-01-01T00:00:00Z";
    const features = [
      { id: "already-harvested", state: "CLOSED" },
      { id: "pending-harvest", state: "CLOSED" },
      { id: "merged-feature", state: "MERGED" },
    ];
    const pullRequests = features.map(({ id, state }, index) => ({
      number: index + 1,
      headRefName: `feat/${id}-phase-01`,
      state,
      closedAt,
      mergedAt: state === "MERGED" ? closedAt : null,
      url: `https://example.invalid/pr/${index + 1}`,
    }));
    try {
      try {
        vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
        writeFileSync(
          join(fixture.projectRoot, ".gwrkrc.json"),
          JSON.stringify({ project: { name: fixture.projectId } }),
        );
        fixture.db
          .prepare(`
        INSERT INTO compression (
          feature_id, phase_id, project_id, estimated_hours, actual_coding_hours,
          estimated_days, actual_delivery_days, point_compression, total_compression, merge_timestamp
        ) VALUES ('already-harvested', 'phase-01', ?, 1, 1, 1, 1, 1, 1, ?)
      `)
          .run(fixture.projectId, closedAt);
        for (const { id } of features) {
          startRun(
            {
              feature_id: id,
              phase_id: "phase-01",
              project_id: fixture.projectId,
              command: "ship",
            },
            fixture.db,
          );
        }
        const featureDir = join(fixture.projectRoot, "specs", "merged-feature");
        const featureStateDir = join(featureDir, ".gwrk");
        mkdirSync(featureStateDir, { recursive: true });
        writeFileSync(
          join(featureDir, "plan.md"),
          "## Phase 1: Merge (1 SP)\n",
        );
        writeFileSync(
          join(featureStateDir, "tasks.json"),
          JSON.stringify({
            featureId: "merged-feature",
            createdAt: closedAt,
            phases: [
              {
                id: "phase-01",
                title: "Merge",
                tasks: [
                  {
                    id: "T001",
                    title: "Verify merged phase",
                    description: "",
                    status: "open",
                    gateScript: "true",
                  },
                ],
              },
            ],
          }),
        );
        vi.mocked(gatherDeliveryActuals).mockReturnValueOnce({
          specCreatedAt: closedAt,
          firstImplCommit: closedAt,
          lastImplCommit: closedAt,
          prMergedAt: closedAt,
          dormancyDays: 0,
          activeCodingMinutes: 60,
          sessionCount: 1,
          deliveryWindowHours: 1,
        });
      } finally {
        returnPullRequests({
          exitCode: 0,
          stdout: JSON.stringify(pullRequests),
          stderr: "",
        });
        await watcher.mock.results[0]?.value;
      }
      expect(watcher).toHaveBeenCalledOnce();
      expect(getDb).not.toHaveBeenCalled();
      expect(syncTrunkForHarvest).toHaveBeenCalledTimes(2);
      expect(
        listRuns("pending-harvest", fixture.projectId, fixture.db),
      ).toEqual([
        expect.objectContaining({ status: "closed", finished_at: closedAt }),
      ]);
      expect(
        listRuns("already-harvested", fixture.projectId, fixture.db),
      ).toEqual([expect.objectContaining({ finished_at: null })]);
      expect(listRuns("merged-feature", fixture.projectId, fixture.db)).toEqual(
        [expect.objectContaining({ status: "merged", finished_at: closedAt })],
      );
      expect(
        getGateResults(
          "merged-feature",
          "phase-01",
          fixture.projectId,
          fixture.db,
        ),
      ).toEqual([expect.objectContaining({ task_id: "T001", passed: 1 })]);
      expect(
        getCompressionRecord(
          "merged-feature",
          "phase-01",
          fixture.projectId,
          fixture.db,
        ),
      ).toMatchObject({ feature_id: "merged-feature" });
    } finally {
      await fixture.close();
    }
  });

  it("releases a dispatch worktree and reports a failed ledger update on close", async () => {
    stubListener();
    const fixture = await createServerFixture("listen");
    try {
      fixture.db.exec(`
        CREATE TRIGGER fail_run_update BEFORE UPDATE ON runs
        BEGIN
          SELECT RAISE(ABORT, 'fixture ledger update failed');
        END;
      `);
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "ledger-failure",
          phaseId: "phase-01",
          taskId: "T001",
        },
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();

      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({
          id,
          status: "completed",
          tasks: [expect.objectContaining({ status: "completed" })],
        });
      });
      const workDir = fixture
        .journal()
        .find((record) => record.workDir)?.workDir;
      expect(workDir).toBeDefined();
      expect(existsSync(workDir ?? "")).toBe(false);
      const worktrees = fixtureGit(
        fixture.projectRoot,
        "worktree",
        "list",
        "--porcelain",
      );
      expect(worktrees.match(/^worktree .+$/gm)).toEqual([
        `worktree ${fixture.projectRoot}`,
      ]);
      const queue = await fixture.app.inject("/api/dispatch/queue");
      expect(queue.json().active).toEqual([]);
      expect(listRuns("ledger-failure", fixture.projectId, fixture.db)).toEqual(
        [expect.objectContaining({ finished_at: null })],
      );
      await expect(fixture.app.close()).rejects.toThrow(
        "fixture ledger update failed",
      );
    } finally {
      await fixture.close();
    }
  });

  it("releases a dispatch slot and reports a failed ledger insert on close", async () => {
    stubListener();
    const fixture = await createServerFixture("listen");
    try {
      fixture.db.exec(`
        CREATE TRIGGER fail_run_insert BEFORE INSERT ON runs
        BEGIN
          SELECT RAISE(ABORT, 'fixture ledger insert failed');
        END;
      `);
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: {
          featureId: "ledger-start-failure",
          phaseId: "phase-01",
          taskId: "T001",
        },
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();
      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({
          id,
          status: "failed",
          tasks: [expect.objectContaining({ status: "failed" })],
        });
      });
      const queue = await fixture.app.inject("/api/dispatch/queue");
      expect(queue.json().active).toEqual([]);
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      await expect(fixture.app.close()).rejects.toThrow(
        "fixture ledger insert failed",
      );
    } finally {
      await fixture.close();
    }
  });

  it("initializes a separate Git repository with inherited repository selectors", async () => {
    const external = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    let fixture: ServerFixture | undefined;
    const snapshot = () => [
      fixtureGit(external.projectRoot, "rev-parse", "HEAD"),
      fixtureGit(external.projectRoot, "status", "--porcelain"),
      fixtureGit(external.projectRoot, "config", "--local", "--list"),
    ];
    try {
      const original = snapshot();
      vi.stubEnv("GIT_DIR", join(external.projectRoot, ".git"));
      vi.stubEnv("GIT_WORK_TREE", external.projectRoot);
      try {
        fixture = await createServerFixture("routes", { routes: ["dispatch"] });
      } finally {
        vi.unstubAllEnvs();
      }
      expect(snapshot()).toEqual(original);
      expect(existsSync(join(fixture.projectRoot, ".git"))).toBe(true);
      expect(fixtureGit(fixture.projectRoot, "log", "-1", "--format=%s")).toBe(
        "Initialize fixture",
      );
    } finally {
      await Promise.all([fixture?.close(), external.close()]);
    }
  });

  it("closes services and removes the fixture after a startup failure", async () => {
    const app = fastify();
    vi.mocked(fastify).mockReturnValueOnce(app);
    vi.spyOn(app, "listen").mockResolvedValue("http://127.0.0.1:0");
    const onClose = vi.fn();
    app.addHook("onClose", async () => onClose());
    const stopPolling = vi.spyOn(SystemMonitor.prototype, "stopPolling");
    const error = new Error("fixture startup failure");
    let root: string | undefined;
    let pidBeforeFailure: string | undefined;
    vi.mocked(startSlackApp).mockImplementationOnce(async ({ projectRoot }) => {
      root = projectRoot;
      pidBeforeFailure = readIfPresent(
        join(projectRoot, ".gwrk", "server.pid"),
      );
      throw error;
    });

    await expect(createServerFixture("listen")).rejects.toBe(error);

    expect(onClose).toHaveBeenCalledOnce();
    expect(stopPolling).toHaveBeenCalledOnce();
    expect(pidBeforeFailure).toBe(String(process.pid));
    expect(root).toBeDefined();
    expect(existsSync(root ?? "")).toBe(false);
    expect(removePid).not.toHaveBeenCalled();
  });
});
