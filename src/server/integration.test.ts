/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { devNull, homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
  fixtureGit,
} from "../../tests/helpers/server-fixture.js";
import { repositoryGitEnv } from "../adapters/git/process-env.js";
import { resolveProjectId } from "../adapters/git/project-id.js";
import { createGitHubHarvestAdapter } from "../adapters/github/index.js";
import {
  createSqliteOperationsStoreAdapter,
  createSqliteProjectRegistryAdapter,
} from "../adapters/sqlite/index.js";
import { getCompressionRecord } from "../db/compression.js";
import { getGateResults } from "../db/gates.js";
import { getDb } from "../db/index.js";
import { listIssues } from "../db/issues.js";
import { insertFeature, insertPhase } from "../db/plan.js";
import { listRuns, recordHistory, startRun } from "../db/runs.js";
import {
  computeHarvestWorkKey,
  planHarvestStages,
} from "../domain/durable-harvest.js";
import type { EnrolledProject } from "../domain/project-registry.js";
import { ShipStage } from "../domain/ship-types.js";
import { gatherDeliveryActuals } from "../engine/compression.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { GitHubHarvestPort } from "../ports/operations-port.js";
import { GwrkConfigSchema } from "../utils/config.js";
import * as projectConfig from "../utils/config.js";
import { execCommand } from "../utils/exec.js";
import * as gateExec from "../utils/gate-exec.js";
import { HarvestWatcher } from "./harvest-watcher.js";
import { PlanHeartbeat } from "./heartbeat.js";
import {
  ScopedSandboxManager,
  type ServerStartOptions,
  startServer,
} from "./index.js";
import { SystemMonitor } from "./monitor.js";
import { NetworkMonitor } from "./network.js";
import * as persistence from "./persistence.js";
import { removePid, writePid } from "./pid.js";
import { notifyRoutes } from "./routes/notify.js";
import * as slackCommands from "./slack-commands.js";
import { notifySlack } from "./slack-notify.js";
import { presenceManager } from "./slack-presence.js";
import { getSlackApp, startSlackApp } from "./slack.js";
import { startTelegramBot } from "./telegram.js";

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
vi.mock("./slack-notify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./slack-notify.js")>()),
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./telegram.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./telegram.js")>()),
  startTelegramBot: vi.fn().mockResolvedValue(undefined),
  stopTelegramBot: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));
vi.mock("../engine/compression.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../engine/compression.js")>();
  return {
    ...original,
    gatherDeliveryActuals: vi.fn(original.gatherDeliveryActuals),
  };
});
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

function githubHeaders(event: string, body: string, deliveryId?: string) {
  const signature = createHmac("sha256", "fixture-secret")
    .update(body)
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-github-event": event,
    "x-hub-signature-256": `sha256=${signature}`,
    ...(deliveryId ? { "x-github-delivery": deliveryId } : {}),
  };
}

function injectGitHub(
  fixture: { app: FastifyInstance },
  event: string,
  payload: Record<string, unknown>,
  deliveryId?: string,
) {
  const body = JSON.stringify(payload);
  return fixture.app.inject({
    method: "POST",
    url: "/webhook/github",
    headers: githubHeaders(event, body, deliveryId),
    payload: body,
  });
}

function isolatedFixtureGitEnv(root: string): NodeJS.ProcessEnv {
  const env = repositoryGitEnv(root);
  for (const key of Object.keys(env)) {
    if (key === "GIT_EXEC_PATH" || /^GIT_TRACE/i.test(key)) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_DEFAULT_HASH: "sha1",
    GIT_DEFAULT_REF_FORMAT: "files",
    GIT_AUTHOR_NAME: "Gwrk Test",
    GIT_AUTHOR_EMAIL: "gwrk-test@example.invalid",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Gwrk Test",
    GIT_COMMITTER_EMAIL: "gwrk-test@example.invalid",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
    GIT_EDITOR: "true",
    EDITOR: "true",
    GIT_TERMINAL_PROMPT: "0",
  };
}

function enrollFixtureProject(
  fixture: ServerFixture,
  input: {
    repoSlug: string;
    slug?: string;
    trunkBranch?: string;
    localOriginPath?: string;
  },
): EnrolledProject {
  const remoteUrl = `https://github.com/${input.repoSlug}.git`;
  const existingRemotes = fixtureGit(fixture.projectRoot, "remote")
    .split("\n")
    .filter(Boolean);
  if (existingRemotes.includes("origin")) {
    fixtureGit(fixture.projectRoot, "remote", "set-url", "origin", remoteUrl);
  } else {
    fixtureGit(fixture.projectRoot, "remote", "add", "origin", remoteUrl);
  }
  if (input.localOriginPath) {
    fixtureGit(
      fixture.projectRoot,
      "config",
      "--local",
      `url.${input.localOriginPath}.insteadOf`,
      remoteUrl,
    );
  }
  const projectId = resolveProjectId(fixture.projectRoot);
  const registry = createSqliteProjectRegistryAdapter({ db: fixture.db });
  const project: EnrolledProject = {
    projectId,
    slug: input.slug ?? fixture.projectId,
    name: input.slug ?? fixture.projectId,
    repoSlug: input.repoSlug,
    trunkBranch: input.trunkBranch ?? "develop",
    localRoot: fixture.projectRoot,
    mirrorPath: null,
    runnerPolicy: { allowedKinds: ["local"] },
    slack: null,
    legacyProjectIds: [],
    createdAt: "2026-11-23T00:00:00.000Z",
    updatedAt: "2026-11-23T00:00:00.000Z",
  };
  return registry.enrollProject(project);
}

async function startDurableServerOnFixture(
  fixture: ServerFixture,
  options: {
    projectId?: string;
    github?: GitHubHarvestPort;
    heartbeatIntervalMs?: number | null;
    extra?: Partial<ServerStartOptions>;
  } = {},
): Promise<FastifyInstance> {
  const projectId = options.projectId ?? fixture.projectId;
  const gitEnv = () => isolatedFixtureGitEnv(fixture.projectRoot);
  const sandbox = new ScopedSandboxManager(fixture.projectRoot, gitEnv);
  const config = GwrkConfigSchema.parse({
    project: { name: projectId },
    agents: { implement: "gemini" },
    server: {
      host: "127.0.0.1",
      port: 0,
      githubWebhookSecret: "fixture-secret",
      heartbeatIntervalMs: 100,
      networkCheckIntervalMs: 100,
    },
    parallelism: {
      local: { maxCpu: 100, maxMem: 100, minDiskGb: 1, maxClones: 2 },
    },
  });
  return startServer(config, {
    handleSignals: false,
    projectRoot: fixture.projectRoot,
    ledger: { db: fixture.db, projectId },
    sandbox,
    gitEnv,
    ...(options.github ? { github: options.github } : {}),
    ...(options.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: options.heartbeatIntervalMs }
      : {}),
    pid: {
      writePid(pid) {
        mkdirSync(join(fixture.projectRoot, ".gwrk"), { recursive: true });
        writeFileSync(fixture.pidPath, String(pid), { flag: "wx" });
      },
      removePid() {
        if (
          existsSync(fixture.pidPath) &&
          readFileSync(fixture.pidPath, "utf8") === String(process.pid)
        ) {
          rmSync(fixture.pidPath, { force: true });
        }
      },
    },
    ...options.extra,
  });
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
    const fixtures: Array<ServerFixture & { server: FastifyInstance }> = [];
    const listTerminalPullRequests = vi.fn<
      GitHubHarvestPort["listTerminalPullRequests"]
    >(async () => []);
    const baseGithub = createGitHubHarvestAdapter();
    const githubPort: GitHubHarvestPort = {
      verifyWebhookSignature: baseGithub.verifyWebhookSignature,
      listTerminalPullRequests,
      getPullRequest: vi.fn(async () => null),
    };
    let finishShips!: (exitCode: number) => void;
    const ships = new Promise<number>((resolve) => {
      finishShips = resolve;
    });

    try {
      for (let index = 0; index < 2; index += 1) {
        const base = await createServerFixture("routes", {
          routes: ["dispatch"],
        });
        const enrolled = enrollFixtureProject(base, {
          repoSlug: `synthetic/server-${index}`,
          slug: `server-${index}`,
        });
        const server = await startDurableServerOnFixture(base, {
          projectId: enrolled.projectId,
          github: githubPort,
          heartbeatIntervalMs: null,
        });
        fixtures.push({
          ...base,
          projectId: enrolled.projectId,
          app: server,
          server,
        });
      }
      const [first, second] = fixtures;

      const pollers = schedule.mock.results.map(({ value }) => value);
      expect(pollers).toHaveLength(10);
      expect(portOf(first)).not.toBe(portOf(second));
      expect([
        process.listenerCount("SIGINT"),
        process.listenerCount("SIGTERM"),
      ]).toEqual(signalCounts);
      for (const [index, fixture] of fixtures.entries()) {
        expect(readFileSync(fixture.pidPath, "utf8")).toBe(String(process.pid));
        expect(
          fixtureGit(fixture.projectRoot, "remote", "get-url", "origin"),
        ).toBe(`https://github.com/synthetic/server-${index}.git`);
      }

      const launchedCwds = new Map<string, string>();
      const run = vi.fn(() => ships);
      vi.mocked(ShipOrchestrator).mockImplementation((config) => {
        if (config?.featureId && config?.cwd) {
          launchedCwds.set(config.featureId, config.cwd);
        }
        return { run, getResult: () => ({}) } as ShipOrchestrator;
      });
      const responses = await Promise.all(
        fixtures.map((fixture, index) =>
          fixture.app.inject({
            method: "POST",
            url: "/api/dispatch",
            payload: { featureId: `feature-${index}`, phaseId: "phase-01" },
          }),
        ),
      );
      await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
      finishShips(0);

      for (const [index, fixture] of fixtures.entries()) {
        const featureId = `feature-${index}`;
        const response = responses[index];
        expect(response.statusCode).toBe(201);
        const receipt = response.json() as {
          operationId: string;
          projectId: string;
        };
        expect(receipt.projectId).toBe(fixture.projectId);

        const queue = await fixture.app.inject({
          method: "GET",
          url: "/api/dispatch/queue",
        });
        expect(queue.statusCode).toBe(200);

        await vi.waitFor(async () => {
          const lookup = await fixture.app.inject({
            method: "GET",
            url: `/api/dispatch/${featureId}/phase-01`,
          });
          expect(lookup.statusCode).toBe(200);
          expect(lookup.json()).toMatchObject({
            operationId: receipt.operationId,
            status: "completed",
          });
        });

        const persisted = fixture.db
          .prepare(
            "SELECT operation_id, project_id, feature_id, status FROM dispatch_operations WHERE operation_id = ?",
          )
          .get(receipt.operationId);
        expect(persisted).toEqual({
          operation_id: receipt.operationId,
          project_id: fixture.projectId,
          feature_id: featureId,
          status: "completed",
        });
        expect(launchedCwds.get(featureId)).toContain(
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
        expect(
          fixtureGit(fixture.projectRoot, "remote", "get-url", "origin"),
        ).toBe(`https://github.com/synthetic/server-${index}.git`);
      }

      await vi.waitFor(() =>
        expect(listTerminalPullRequests).toHaveBeenCalledTimes(2),
      );
      expect(
        listTerminalPullRequests.mock.calls.map(([input]) => input.cwd),
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
      finishShips(0);
      await Promise.all(
        fixtures.map(async (fixture) => {
          try {
            await fixture.server.close();
          } finally {
            await fixture.close();
          }
        }),
      );
    }

    for (const fixture of fixtures) {
      expect(fixture.db.open).toBe(false);
      expect(existsSync(fixture.projectRoot)).toBe(false);
    }
  });

  it("bounds an in-flight GitHub poll before removing the scoped PID file", async () => {
    const bin = mkdtempSync(join(tmpdir(), "gwrk-poll-bin-"));
    const marker = join(bin, "poll.pid");
    let fixture: ServerFixture | undefined;
    let server: FastifyInstance | undefined;
    let childPid: number | undefined;
    const stopChild = () => {
      if (childPid === undefined) return;
      try {
        process.kill(childPid, "SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    try {
      writeFileSync(
        join(bin, "gh"),
        `#!${process.execPath}
process.on("SIGTERM", () => {});
require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
setInterval(() => {}, 1000);
`,
        { mode: 0o755 },
      );
      vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
      fixture = await createServerFixture("routes", { routes: ["dispatch"] });
      const enrolled = enrollFixtureProject(fixture, {
        repoSlug: "synthetic/poll-bound",
        slug: "poll-bound",
      });
      stubListener();
      server = await startDurableServerOnFixture(fixture, {
        projectId: enrolled.projectId,
      });
      const pollPid = await vi.waitFor(() => {
        const pid = Number(readFileSync(marker, "utf8"));
        expect(pid).toBeGreaterThan(0);
        return pid;
      });
      childPid = pollPid;
      expect(readIfPresent(fixture.pidPath)).toBe(String(process.pid));

      const closeFinished = vi.fn();
      const closing = server.close().then(closeFinished);
      await vi.waitFor(() => expect(closeFinished).toHaveBeenCalledOnce(), {
        timeout: 6500,
      });
      await closing;

      expect(() => process.kill(pollPid, 0)).toThrow(/ESRCH/);
      childPid = undefined;
      expect(existsSync(fixture.pidPath)).toBe(false);
    } finally {
      try {
        stopChild();
      } finally {
        try {
          await server?.close();
        } finally {
          try {
            await fixture?.close();
          } finally {
            rmSync(bin, { recursive: true, force: true });
          }
        }
      }
    }
  }, 10_000);

  it("keeps inherited repository selectors out of the actual durable GitHub port", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const bin = join(fixture.projectRoot, ".git", "durable-gh-bin");
    const marker = join(bin, "observed.json");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!${process.execPath}
require("node:fs").writeFileSync(${JSON.stringify(marker)}, JSON.stringify({cwd:process.cwd(), args:process.argv.slice(2), GIT_DIR:process.env.GIT_DIR, GIT_WORK_TREE:process.env.GIT_WORK_TREE, GH_REPO:process.env.GH_REPO, GH_HOST:process.env.GH_HOST}));
process.stdout.write("[]");
`,
      { mode: 0o755 },
    );
    try {
      vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
      vi.stubEnv("GIT_DIR", "/synthetic/external/.git");
      vi.stubEnv("GIT_WORK_TREE", "/synthetic/external");
      vi.stubEnv("GH_REPO", "external/repo");
      vi.stubEnv("GH_HOST", "ghe.internal.example");
      await createGitHubHarvestAdapter().listTerminalPullRequests({
        cwd: fixture.projectRoot,
        repoSlug: "synthetic/fixture",
        baseBranch: "develop",
      });
      const observed = JSON.parse(readFileSync(marker, "utf8"));
      expect(observed.cwd).toBe(fixture.projectRoot);
      expect.soft(observed.GIT_DIR).toBeUndefined();
      expect.soft(observed.GIT_WORK_TREE).toBeUndefined();
      expect.soft(observed.GH_REPO).toBeUndefined();
      const explicitPublicHost =
        Array.isArray(observed.args) &&
        observed.args.includes("--hostname") &&
        observed.args[observed.args.indexOf("--hostname") + 1] === "github.com";
      expect
        .soft(observed.GH_HOST === undefined || explicitPublicHost)
        .toBe(true);
      expect(getDb).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it("drains the actual enrolled durable GitHub poll within the existing shutdown bound", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const registry = createSqliteProjectRegistryAdapter({ db: fixture.db });
    fixtureGit(
      fixture.projectRoot,
      "remote",
      "add",
      "origin",
      "https://github.com/synthetic/fixture.git",
    );
    registry.enrollProject({
      projectId: resolveProjectId(fixture.projectRoot),
      slug: "durable-shutdown",
      name: "Synthetic poll",
      repoSlug: "synthetic/fixture",
      trunkBranch: "develop",
      localRoot: fixture.projectRoot,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: [],
      createdAt: "2026-11-23T00:00:00Z",
      updatedAt: "2026-11-23T00:00:00Z",
    });
    const bin = join(fixture.projectRoot, ".git", "durable-stall-bin");
    const marker = join(bin, "poll.pid");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "gh"),
      `#!${process.execPath}
process.on("SIGTERM", () => {});
require("node:fs").writeFileSync(${JSON.stringify(marker)}, String(process.pid));
setInterval(() => {}, 1000);
`,
      { mode: 0o755 },
    );
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const watcher = new HarvestWatcher(
      GwrkConfigSchema.parse({ project: { name: fixture.projectId } }),
      null,
      fixture.projectRoot,
      { db: fixture.db, projectId: fixture.projectId },
      undefined,
      { registry, github: createGitHubHarvestAdapter() },
    );
    let childPid: number | undefined;
    let stopping: Promise<void> | void;
    try {
      watcher.start();
      childPid = await vi.waitFor(() => Number(readFileSync(marker, "utf8")));
      expect(childPid).toBeGreaterThan(0);
      const drained = vi.fn();
      stopping = Promise.resolve(watcher.stop()).then(drained);
      await vi.waitFor(() => expect(drained).toHaveBeenCalledOnce(), {
        timeout: 6500,
      });
      await stopping;
      expect(() => process.kill(childPid as number, 0)).toThrow(/ESRCH/);
      childPid = undefined;
    } finally {
      if (childPid) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch (error) {
          expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
        }
      }
      await stopping;
      await watcher.stop();
      await fixture.close();
    }
  }, 10_000);

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

  it("cancels a stalled heartbeat request before removing its process record", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const server = fastify();
    vi.spyOn(server, "listen").mockResolvedValue("http://127.0.0.1:0");
    vi.mocked(fastify).mockReturnValueOnce(server);
    vi.mocked(getSlackApp).mockReturnValueOnce({
      client: { token: "fixture-slack-token" },
    } as NonNullable<ReturnType<typeof getSlackApp>>);
    const providerStopped = vi.fn();
    const provider = vi
      .fn<typeof fetch>()
      .mockImplementation(async (_url, init) => {
        const signal = init?.signal;
        if (!signal) throw new Error("Expected an abortable heartbeat request");
        return new Promise((_, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              providerStopped(existsSync(fixture.pidPath));
              reject(signal.reason);
            },
            { once: true },
          );
        });
      });
    vi.stubGlobal("fetch", provider);
    try {
      insertFeature(
        {
          id: "fixture",
          name: "Fixture",
          status: "ACTIVE",
          sp_total: 1,
        },
        fixture.projectId,
        fixture.db,
      );
      insertPhase(
        {
          id: "phase-01",
          feature_id: "fixture",
          name: "Pending fixture phase",
          status: "IN_PROGRESS",
          health: "GREEN",
          sp_estimate: 1,
          seq: 1,
        },
        fixture.projectId,
        fixture.db,
      );
      fixture.db
        .prepare("UPDATE plan_phases SET updated_at = ?")
        .run("2000-01-01T00:00:00Z");
      const config = GwrkConfigSchema.parse({
        project: {
          name: "fixture",
          slack: { channelId: "C1", opsChannelId: "C1-OPS" },
        },
        server: { host: "127.0.0.1", port: 0 },
      });
      await startServer(config, {
        projectRoot: fixture.projectRoot,
        handleSignals: false,
        ledger: { projectId: fixture.projectId, db: fixture.db },
        pid: {
          writePid(pid) {
            writeFileSync(fixture.pidPath, String(pid), { flag: "wx" });
          },
          removePid() {
            rmSync(fixture.pidPath);
          },
        },
      });
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      expect(provider).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          body: expect.stringContaining("Build Plan Health Report"),
        }),
      );
      expect(providerStopped).not.toHaveBeenCalled();
      const closing = server.close();
      await vi.waitFor(() =>
        expect(providerStopped).toHaveBeenCalledExactlyOnceWith(true),
      );
      await closing;
      expect(existsSync(fixture.pidPath)).toBe(false);
    } finally {
      await server.close();
      await fixture.close();
      vi.unstubAllGlobals();
    }
  });

  it("drains a cancelled Telegram poll before removing its process record", async () => {
    const telegram =
      await vi.importActual<typeof import("./telegram.js")>("./telegram.js");
    vi.mocked(startTelegramBot).mockImplementationOnce((deps) =>
      telegram.startTelegramBot({ ...deps, pilotMode: false }),
    );
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-telegram");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123");
    let respond!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      respond = resolve;
    });
    const provider = vi.fn<typeof fetch>().mockReturnValue(response);
    vi.stubGlobal("fetch", provider);
    const command = vi.spyOn(slackCommands, "handleSlashCommand");
    const timer = vi.spyOn(globalThis, "setTimeout");
    stubListener();
    let fixture: ServerFixture | undefined;
    try {
      fixture = await createServerFixture("listen");
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      const signal = provider.mock.calls[0][1]?.signal;
      const closed = vi.fn();
      const closing = fixture.app.close().then(closed);
      await vi.waitFor(() => expect(signal?.aborted).toBe(true));
      expect(closed).not.toHaveBeenCalled();
      expect(existsSync(fixture.pidPath)).toBe(true);
      respond(
        Response.json({
          ok: true,
          result: [
            {
              update_id: 1,
              message: { message_id: 1, chat: { id: 123 }, text: "/help" },
            },
          ],
        }),
      );
      await closing;
      expect(command).not.toHaveBeenCalled();
      expect(provider).toHaveBeenCalledOnce();
      expect(timer.mock.calls.some(([, delay]) => delay === 2000)).toBe(false);
      expect(existsSync(fixture.pidPath)).toBe(false);
    } finally {
      respond(Response.json({ ok: true, result: [] }));
      await fixture?.close();
      vi.unstubAllGlobals();
    }
  });

  it("lets a configured fixture poll after an unconfigured fixture starts", async () => {
    const telegram =
      await vi.importActual<typeof import("./telegram.js")>("./telegram.js");
    vi.mocked(startTelegramBot)
      .mockImplementationOnce((deps) =>
        telegram.startTelegramBot({ ...deps, pilotMode: false }),
      )
      .mockImplementationOnce((deps) =>
        telegram.startTelegramBot({ ...deps, pilotMode: false }),
      );
    vi.stubEnv(
      "GWRK_HOME",
      join(tmpdir(), "gwrk-fixture-absent-telegram-config"),
    );
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    vi.stubEnv("TELEGRAM_CHAT_ID", undefined);
    const provider = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true, result: [] }));
    vi.stubGlobal("fetch", provider);
    stubListener();
    const unconfigured = await createServerFixture("listen");
    let configured: ServerFixture | undefined;
    try {
      vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-telegram");
      vi.stubEnv("TELEGRAM_CHAT_ID", "123");
      stubListener();
      configured = await createServerFixture("listen");
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      const signal = provider.mock.calls[0][1]?.signal;
      await unconfigured.close();
      expect(signal?.aborted).toBe(false);
      await vi.waitFor(() => expect(provider).toHaveBeenCalledTimes(2), {
        timeout: 3_000,
      });
      expect(provider.mock.calls[1][1]?.signal).toBe(signal);
      await configured.close();
      expect(signal?.aborted).toBe(true);
    } finally {
      await unconfigured.close();
      await configured?.close();
      await telegram.stopTelegramBot();
      vi.unstubAllGlobals();
    }
  });

  it("fetches from a local fixture without using an inherited Git helper", async () => {
    const source = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const target = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const helpers = join(target.projectRoot, "host-helpers");
    const marker = join(helpers, "invoked");
    try {
      mkdirSync(helpers);
      writeFileSync(
        join(helpers, "git-upload-pack"),
        `#!/bin/sh\n: > "${marker}"\nexit 42\n`,
        { mode: 0o700 },
      );
      vi.stubEnv("GIT_EXEC_PATH", helpers);
      expect(() =>
        fixtureGit(target.projectRoot, "fetch", source.projectRoot, "develop"),
      ).not.toThrow();
      expect(existsSync(marker)).toBe(false);
      expect(fixtureGit(target.projectRoot, "rev-parse", "FETCH_HEAD")).toBe(
        fixtureGit(source.projectRoot, "rev-parse", "develop"),
      );
    } finally {
      vi.unstubAllEnvs();
      await target.close();
      await source.close();
    }
  });

  it.each(["listen", "routes", "unscoped"] as const)(
    "routes POST /api/notify to the configured webhook in %s mode",
    async (mode) => {
      const realNotifier =
        await vi.importActual<typeof import("./slack-notify.js")>(
          "./slack-notify.js",
        );
      const checkout = await createServerFixture("routes");
      const checkoutWebhook = "https://checkout.invalid/slack";
      const fixtureWebhook = "https://fixture.invalid/slack";
      const cwd = process.cwd();
      const provider = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => Response.json({ ok: true }));
      let fixture: ServerFixture | undefined;
      const configureWebhook = (target: ServerFixture, webhookUrl: string) => {
        writeFileSync(
          join(target.projectRoot, ".gwrkrc.json"),
          JSON.stringify({ project: { name: target.projectId } }),
        );
        writeFileSync(
          join(target.projectRoot, ".gwrkrc.local.json"),
          JSON.stringify({
            project: { slack: { channelId: "C_NOTIFY", webhookUrl } },
          }),
        );
      };
      vi.stubGlobal("fetch", provider);
      vi.stubEnv("GWRK_HOME", join(checkout.projectRoot, ".gwrk"));
      vi.stubEnv("SLACK_WEBHOOK_URL", undefined);
      vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
      vi.stubEnv("TELEGRAM_CHAT_ID", undefined);
      try {
        configureWebhook(checkout, checkoutWebhook);
        if (mode === "listen") stubListener();
        fixture = await createServerFixture(
          mode === "listen" ? "listen" : "routes",
          { routes: mode === "routes" ? ["notify"] : [] },
        );
        configureWebhook(fixture, fixtureWebhook);
        const app = mode === "unscoped" ? fastify() : fixture.app;
        try {
          if (mode === "unscoped") await notifyRoutes(app);
          const originalLoadConfig = projectConfig.loadConfig;
          const configStub = vi
            .spyOn(projectConfig, "loadConfig")
            .mockImplementation((root, ...args) =>
              originalLoadConfig(
                root === cwd ? checkout.projectRoot : root,
                ...args,
              ),
            );
          vi.mocked(notifySlack).mockImplementationOnce(
            realNotifier.notifySlack,
          );
          const response = await app.inject({
            method: "POST",
            url: "/api/notify",
            payload: { type: "phase_start", feature: "notify-probe" },
          });

          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual({ ok: true });
          expect(provider.mock.calls.map(([url]) => url)).toEqual([
            mode === "unscoped" ? checkoutWebhook : fixtureWebhook,
          ]);
          expect(process.cwd()).toBe(cwd);
          configStub.mockRestore();
        } finally {
          vi.restoreAllMocks();
          if (mode === "unscoped") await app.close();
        }
      } finally {
        vi.unstubAllGlobals();
        await Promise.all([fixture?.close(), checkout.close()]);
      }
    },
  );

  it.each(["webhook", "presence"] as const)(
    "routes dispatch notifications to the fixture via %s with pilot Telegram disabled",
    async (transport) => {
      const realNotifier =
        await vi.importActual<typeof import("./slack-notify.js")>(
          "./slack-notify.js",
        );
      vi.mocked(notifySlack).mockImplementationOnce(realNotifier.notifySlack);
      const fixture = await createServerFixture("routes", {
        routes: ["dispatch"],
      });
      const webhook = "https://fixture.invalid/slack";
      const slackApi = "https://slack.com/api/chat.postMessage";
      const telegramApi =
        "https://api.telegram.org/botfixture-telegram/sendMessage";
      const provider = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => Response.json({ ok: true }));
      vi.stubGlobal("fetch", provider);
      vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
      vi.stubEnv("SLACK_WEBHOOK_URL", "https://checkout.invalid/slack");
      vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
      vi.stubEnv("TELEGRAM_CHAT_ID", undefined);
      if (transport === "presence") {
        const slack = { client: { token: "fixture-slack" } } as NonNullable<
          ReturnType<typeof getSlackApp>
        >;
        vi.mocked(getSlackApp)
          .mockReturnValueOnce(slack)
          .mockReturnValueOnce(slack);
      }
      try {
        writeFileSync(
          join(fixture.projectRoot, ".gwrkrc.json"),
          JSON.stringify({ project: { name: fixture.projectId } }),
        );
        writeFileSync(
          join(fixture.projectRoot, ".gwrkrc.local.json"),
          JSON.stringify({
            project: {
              name: fixture.projectId,
              slack: { channelId: "C_FIXTURE", webhookUrl: webhook },
              telegram: { botToken: "fixture-telegram", chatId: "123" },
            },
          }),
        );
        const result = await fixture.app.inject({
          method: "POST",
          url: "/api/dispatch",
          payload: { featureId: "notify-probe", phaseId: "phase-01" },
        });
        expect(result.statusCode).toBe(201);
        await fixture.app.close();
        expect(fixture.journal().at(-1)?.status).toBe("completed");
        expect(provider.mock.calls.map(([url]) => url)).toEqual([
          transport === "presence" ? slackApi : webhook,
        ]);
        expect(provider.mock.calls.map(([url]) => url)).not.toContain(
          telegramApi,
        );
        if (transport === "presence") {
          expect(
            JSON.parse(String(provider.mock.calls[0][1]?.body)).channel,
          ).toBe("C_FIXTURE");
        }
      } finally {
        await fixture.close();
        vi.unstubAllGlobals();
      }
    },
  );

  it("sends an away dispatch after five seconds and discards the next one on close", async () => {
    const realNotifier =
      await vi.importActual<typeof import("./slack-notify.js")>(
        "./slack-notify.js",
      );
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const getPresence = vi
      .fn()
      .mockResolvedValue({ ok: true, presence: "away" });
    const provider = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json({ ok: true }));
    vi.mocked(getSlackApp).mockReturnValue({
      client: {
        token: "fixture-slack",
        users: {
          list: vi.fn().mockResolvedValue({
            ok: true,
            members: [{ id: "fixture-user", is_bot: false }],
          }),
          getPresence,
        },
      },
    } as NonNullable<ReturnType<typeof getSlackApp>>);
    vi.mocked(notifySlack).mockImplementation(realNotifier.notifySlack);
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    vi.stubEnv("TELEGRAM_CHAT_ID", undefined);
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    try {
      writeFileSync(
        join(fixture.projectRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: fixture.projectId } }),
      );
      writeFileSync(
        join(fixture.projectRoot, ".gwrkrc.local.json"),
        JSON.stringify({
          project: {
            name: fixture.projectId,
            slack: { channelId: "C_FIXTURE" },
          },
        }),
      );
      presenceManager.setUserPresence("fixture-user", "away");
      await presenceManager.init(
        GwrkConfigSchema.parse({ project: { name: fixture.projectId } }),
      );
      const dispatch = async (featureId: string) => {
        const response = await fixture.app.inject({
          method: "POST",
          url: "/api/dispatch",
          payload: { featureId, phaseId: "phase-01" },
        });
        expect(response.statusCode).toBe(201);
        await vi.waitFor(() =>
          expect(fixture.journal().at(-1)).toMatchObject({
            featureId,
            status: "completed",
          }),
        );
      };

      await dispatch("delivered-feature");
      await vi.advanceTimersByTimeAsync(5_001);
      expect(provider).not.toHaveBeenCalled();
      getPresence.mockResolvedValue({ ok: true, presence: "active" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(provider).toHaveBeenCalledExactlyOnceWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          body: expect.stringContaining("delivered-feature"),
          signal: expect.any(AbortSignal),
        }),
      );

      getPresence.mockResolvedValue({ ok: true, presence: "away" });
      await vi.advanceTimersByTimeAsync(60_000);
      await dispatch("discarded-feature");
      await fixture.app.close();
      getPresence.mockResolvedValue({ ok: true, presence: "active" });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(provider).toHaveBeenCalledOnce();
    } finally {
      presenceManager.stop();
      vi.useRealTimers();
      await fixture.close();
      vi.mocked(notifySlack).mockResolvedValue(undefined);
      vi.mocked(getSlackApp).mockReturnValue(null);
      vi.unstubAllGlobals();
    }
  });

  it("drains an aborted dispatch notification before closing the server", async () => {
    const realNotifier =
      await vi.importActual<typeof import("./slack-notify.js")>(
        "./slack-notify.js",
      );
    vi.mocked(notifySlack).mockImplementationOnce(realNotifier.notifySlack);
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://fixture.invalid/stalled");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "fixture-telegram");
    vi.stubEnv("TELEGRAM_CHAT_ID", "123");
    let release!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const cancelled = vi.fn();
    const provider = vi
      .fn<typeof fetch>()
      .mockImplementation((_url, request) => {
        request?.signal?.addEventListener("abort", cancelled, { once: true });
        return response;
      });
    vi.stubGlobal("fetch", provider);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const result = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "notify-probe", phaseId: "phase-01" },
      });
      expect(result.statusCode).toBe(201);
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      expect(fixture.journal().at(-1)?.status).toBe("completed");
      expect(listRuns("notify-probe", fixture.projectId, fixture.db)).toEqual([
        expect.objectContaining({ exit_code: 0 }),
      ]);

      const closed = vi.fn();
      const closing = fixture.app.close().then(closed);
      await vi.advanceTimersByTimeAsync(5000);
      expect(cancelled).toHaveBeenCalledOnce();
      expect(closed).not.toHaveBeenCalled();
      release(new Response(null, { status: 200 }));
      await closing;
      expect(provider).toHaveBeenCalledOnce();
    } finally {
      release(new Response(null, { status: 200 }));
      await fixture.close();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("uses scoped persistence when the startup watcher sees terminal pull requests", async () => {
    const watcher = vi.spyOn(HarvestWatcher.prototype, "runCheck");
    const repoSlug = "synthetic/startup-watcher";
    const closedAt = "2026-01-01T00:00:00Z";
    const origin = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    let server: FastifyInstance | undefined;
    let returnPullRequests!: (
      value: Awaited<ReturnType<GitHubHarvestPort["listTerminalPullRequests"]>>,
    ) => void;
    const baseGithub = createGitHubHarvestAdapter();
    const githubPort: GitHubHarvestPort = {
      verifyWebhookSignature: baseGithub.verifyWebhookSignature,
      listTerminalPullRequests: vi.fn(
        () =>
          new Promise((resolve) => {
            returnPullRequests = resolve;
          }),
      ),
      getPullRequest: vi.fn(async () => null),
    };
    const features = [
      { id: "already-harvested", state: "CLOSED" as const },
      { id: "pending-harvest", state: "CLOSED" as const },
      { id: "merged-feature", state: "MERGED" as const },
    ];
    try {
      const enrolled = enrollFixtureProject(fixture, {
        repoSlug,
        slug: "startup-watcher",
        localOriginPath: origin.projectRoot,
      });
      const projectId = enrolled.projectId;
      fixtureGit(fixture.projectRoot, "fetch", "origin", "develop");
      fixtureGit(fixture.projectRoot, "reset", "--hard", "origin/develop");

      const featureDir = join(origin.projectRoot, "specs", "merged-feature");
      const featureStateDir = join(featureDir, ".gwrk");
      mkdirSync(featureStateDir, { recursive: true });
      writeFileSync(
        join(origin.projectRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: projectId } }),
      );
      writeFileSync(join(featureDir, "plan.md"), "## Phase 1: Merge (1 SP)\n");
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
                {
                  id: "T002",
                  title: "Cancelled before merge",
                  description: "",
                  status: "cancelled",
                  gateScript: "false",
                },
              ],
            },
          ],
        }),
      );
      fixtureGit(origin.projectRoot, "add", "--", ".gwrkrc.json", "specs");
      fixtureGit(
        origin.projectRoot,
        "-c",
        "user.name=Gwrk Test",
        "-c",
        "user.email=gwrk-test@example.invalid",
        "commit",
        "--author=Gwrk Test <gwrk-test@example.invalid>",
        "--no-gpg-sign",
        "-m",
        "Add merged feature specs",
      );
      const mergeCommitSha = fixtureGit(
        origin.projectRoot,
        "rev-parse",
        "HEAD",
      );
      const operationsStore = createSqliteOperationsStoreAdapter({
        db: fixture.db,
      });
      // Record PR #1 as already durably harvested so startup watcher skips re-applying it.
      const priorWorkKey = computeHarvestWorkKey({
        repoSlug,
        baseBranch: "develop",
        prNumber: 1,
        terminalEvent: "closed_unmerged",
        mergeCommitSha: null,
        featureId: "already-harvested",
        phaseId: "phase-01",
      });
      const priorIntake = operationsStore.recordHarvestIntake({
        candidate: {
          source: "github_poller",
          deliveryId: `prior:${repoSlug}:1:closed_unmerged:${closedAt}`,
          repoSlug,
          headRepoSlug: repoSlug,
          baseBranch: "develop",
          headBranch: "feat/already-harvested-phase-01",
          expectedHeadSha: null,
          prNumber: 1,
          prUrl: `https://github.com/${repoSlug}/pull/1`,
          terminalEvent: "closed_unmerged",
          mergeCommitSha: null,
          terminalAt: closedAt,
          recipient: null,
        },
        payloadDigest: "a".repeat(64),
        receivedAt: closedAt,
        target: {
          accepted: true,
          project: enrolled,
          operations: [
            {
              operationId: "op-already-harvested-1",
              projectId: enrolled.projectId,
              workKey: priorWorkKey,
              repoSlug,
              headRepoSlug: repoSlug,
              trunkBranch: "develop",
              featureId: "already-harvested",
              phaseId: "phase-01",
              prNumber: 1,
              prUrl: `https://github.com/${repoSlug}/pull/1`,
              headBranch: "feat/already-harvested-phase-01",
              expectedHeadSha: null,
              terminalEvent: "closed_unmerged",
              mergeCommitSha: null,
              terminalAt: closedAt,
              recipient: null,
              plannedSlackRecipient: null,
              status: "accepted",
              leaseOwner: null,
              leaseEpoch: 0,
              leaseExpiresAt: null,
              linkedRunId: null,
              lastError: null,
              createdAt: closedAt,
              updatedAt: closedAt,
              completedAt: null,
            },
          ],
        },
      });
      expect(priorIntake.ok).toBe(true);
      const priorClaim = operationsStore.claimHarvestLease({
        operationId: "op-already-harvested-1",
        leaseOwner: "prior-watcher",
        nowIso: closedAt,
        leaseExpiresAt: "2026-01-01T00:05:00Z",
      });
      expect(priorClaim).not.toBeNull();
      if (priorClaim) {
        const priorPlan = planHarvestStages({
          terminalEvent: "closed_unmerged",
          phaseIds: ["phase-01"],
          hasSlackTarget: false,
          hasRemoteBranchTarget: false,
        });
        expect(
          operationsStore.initializeHarvestStages({
            fence: priorClaim.fence,
            nowIso: closedAt,
            phaseIds: ["phase-01"],
            hasSlackTarget: false,
            hasRemoteBranchTarget: false,
            stages: priorPlan,
          }).ok,
        ).toBe(true);
        expect(
          operationsStore.transitionHarvestStage({
            fence: priorClaim.fence,
            nowIso: closedAt,
            phaseKey: "phase-01",
            stage: "learning_record",
            status: "running",
          }).ok,
        ).toBe(true);
        expect(
          operationsStore.transitionHarvestStage({
            fence: priorClaim.fence,
            nowIso: closedAt,
            phaseKey: "phase-01",
            stage: "learning_record",
            status: "succeeded",
          }).ok,
        ).toBe(true);
      }

      vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
      fixture.db
        .prepare(`
        INSERT INTO compression (
          feature_id, phase_id, project_id, estimated_hours, actual_coding_hours,
          estimated_days, actual_delivery_days, point_compression, total_compression, merge_timestamp
        ) VALUES ('already-harvested', 'phase-01', ?, 1, 1, 1, 1, 1, 1, ?)
      `)
        .run(projectId, closedAt);
      for (const { id } of features) {
        const runId = startRun(
          {
            feature_id: id,
            phase_id: "phase-01",
            project_id: projectId,
            command: "ship",
            attempt: 1,
          },
          fixture.db,
        );
        if (id === "merged-feature") {
          recordHistory(
            {
              project_id: projectId,
              feature_id: id,
              task_id: "T001",
              to_status: "completed",
              run_id: runId,
            },
            fixture.db,
          );
        }
      }

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

      const pullRequests = features.map(({ id, state }, index) => ({
        repoSlug,
        headRepoSlug: repoSlug,
        prNumber: index + 1,
        prUrl: `https://github.com/${repoSlug}/pull/${index + 1}`,
        state,
        merged: state === "MERGED",
        baseBranch: "develop",
        headBranch: `feat/${id}-phase-01`,
        headSha: null,
        mergeCommitSha: state === "MERGED" ? mergeCommitSha : null,
        mergedAt: state === "MERGED" ? closedAt : null,
        closedAt,
      }));

      stubListener();
      server = await startDurableServerOnFixture(fixture, {
        projectId,
        github: githubPort,
      });
      await vi.waitFor(() => expect(returnPullRequests).toBeDefined());
      returnPullRequests(pullRequests);
      await watcher.mock.results[0]?.value;

      expect(watcher).toHaveBeenCalledOnce();
      expect(getDb).not.toHaveBeenCalled();
      expect(listRuns("pending-harvest", projectId, fixture.db)).toEqual([
        expect.objectContaining({ status: "closed", finished_at: closedAt }),
      ]);
      expect(listRuns("already-harvested", projectId, fixture.db)).toEqual([
        expect.objectContaining({ finished_at: null }),
      ]);
      expect(listRuns("merged-feature", projectId, fixture.db)).toEqual([
        expect.objectContaining({ status: "merged", finished_at: closedAt }),
      ]);
      expect(
        getGateResults("merged-feature", "phase-01", projectId, fixture.db),
      ).toEqual([expect.objectContaining({ task_id: "T001", passed: 1 })]);
      expect(
        getCompressionRecord(
          "merged-feature",
          "phase-01",
          projectId,
          fixture.db,
        ),
      ).toMatchObject({
        feature_id: "merged-feature",
        convergence_first_pass_rate: 50,
      });
    } finally {
      returnPullRequests?.([]);
      try {
        await server?.close();
      } finally {
        await Promise.all([fixture.close(), origin.close()]);
      }
    }
  });

  it("uses scoped SQLite for signed labeled and closed GitHub issues", async () => {
    stubListener();
    const fixture = await createServerFixture("listen");
    const featureId = "webhook-issue";
    const issue = {
      number: 7,
      title: "Fixture issue",
      labels: [{ name: `gwrk:${featureId}` }],
      state: "open",
      created_at: "2026-01-01T00:00:00Z",
    };
    const closedAt = "2026-01-02T00:00:00Z";
    const rows = () => listIssues(featureId, fixture.projectId, fixture.db);
    try {
      const labeled = await injectGitHub(fixture, "issues", {
        action: "labeled",
        issue,
      });
      expect(labeled.statusCode).toBe(200);
      expect(rows()).toEqual([
        expect.objectContaining({ issue_number: 7, state: "open" }),
      ]);

      const closed = await injectGitHub(fixture, "issues", {
        action: "closed",
        issue: { ...issue, state: "closed", closed_at: closedAt },
      });
      expect(closed.statusCode).toBe(200);
      expect(rows()).toEqual([
        expect.objectContaining({ state: "closed", closed_at: closedAt }),
      ]);
      expect(getDb).not.toHaveBeenCalled();
    } finally {
      await fixture.close();
    }
  });

  it.each(["[046]", "046"])(
    "resolves a signed labeled issue titled %s in the server project",
    async (title) => {
      stubListener();
      const fixture = await createServerFixture("listen");
      const checkoutFeature = "046-hermetic-ci";
      const featureId = "046-phase-one-review-fixture";
      try {
        expect(existsSync(join(process.cwd(), "specs", checkoutFeature))).toBe(
          true,
        );
        mkdirSync(join(fixture.projectRoot, "specs", featureId), {
          recursive: true,
        });
        const response = await injectGitHub(fixture, "issues", {
          action: "labeled",
          issue: {
            number: 8,
            title,
            labels: [{ name: "triage" }],
            state: "open",
            created_at: "2026-01-01T00:00:00Z",
          },
        });

        expect(response.statusCode).toBe(200);
        expect.soft(response.json()).toEqual({
          status: "accepted",
          featureId,
          issueNumber: 8,
        });
        expect
          .soft(listIssues(featureId, fixture.projectId, fixture.db))
          .toEqual([
            expect.objectContaining({ issue_number: 8, feature_id: featureId }),
          ]);
        expect(
          listIssues(checkoutFeature, fixture.projectId, fixture.db),
        ).toEqual([]);
        expect(getDb).not.toHaveBeenCalled();
      } finally {
        await fixture.close();
      }
    },
  );

  it("routes a signed opened issue to the fixture and drains delivery on close", async () => {
    const { notifySlack: realNotifier } =
      await vi.importActual<typeof import("./slack-notify.js")>(
        "./slack-notify.js",
      );
    const fixture = await createServerFixture("listen");
    const webhookUrl = "https://fixture.invalid/github-issue";
    const localFetch = globalThis.fetch;
    let release!: (response: Response) => void;
    const delivery = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const provider = vi.fn<typeof fetch>().mockReturnValue(delivery);
    vi.stubGlobal("fetch", provider);
    vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
    vi.stubEnv("SLACK_WEBHOOK_URL", "https://checkout.invalid/github-issue");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", undefined);
    vi.stubEnv("TELEGRAM_CHAT_ID", undefined);
    vi.mocked(notifySlack).mockImplementationOnce(realNotifier);
    try {
      writeFileSync(
        join(fixture.projectRoot, ".gwrkrc.json"),
        JSON.stringify({ project: { name: fixture.projectId } }),
      );
      writeFileSync(
        join(fixture.projectRoot, ".gwrkrc.local.json"),
        JSON.stringify({
          project: { slack: { channelId: "C_FIXTURE", webhookUrl } },
        }),
      );
      const featureId = "webhook-issue";
      const body = JSON.stringify({
        action: "opened",
        issue: {
          number: 9,
          title: "Fixture issue",
          labels: [{ name: `gwrk:${featureId}` }],
          state: "open",
          created_at: "2026-01-01T00:00:00Z",
        },
      });
      const response = localFetch(
        `http://127.0.0.1:${portOf(fixture)}/webhook/github`,
        {
          method: "POST",
          headers: { ...githubHeaders("issues", body), connection: "close" },
          body,
        },
      );
      await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
      const [url, request] = provider.mock.calls[0];
      expect.soft(url).toBe(webhookUrl);
      expect.soft(request?.signal).toBeInstanceOf(AbortSignal);
      expect.soft(notifySlack).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining("Issue #9"),
        }),
        undefined,
        expect.objectContaining({ transportTimeoutMs: 5_000 }),
      );

      const closeListener = vi.spyOn(fixture.app.server, "close");
      const closed = vi.fn();
      const closing = fixture.app.close().then(closed);
      await vi.waitFor(() => expect(request?.signal?.aborted).toBe(true));
      expect(closeListener).not.toHaveBeenCalled();
      expect(closed).not.toHaveBeenCalled();
      expect(existsSync(fixture.pidPath)).toBe(true);

      release(new Response(null, { status: 200 }));
      const result = await response;
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({
        status: "accepted",
        featureId,
        issueNumber: 9,
      });
      await closing;
      expect(existsSync(fixture.pidPath)).toBe(false);
      expect(provider).toHaveBeenCalledOnce();
    } finally {
      release(new Response(null, { status: 200 }));
      await fixture.close();
      vi.unstubAllGlobals();
    }
  });

  it("harvests a signed merged GitHub pull request in scoped SQLite", async () => {
    const repoSlug = "synthetic/webhook-merge";
    const origin = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    let server: FastifyInstance | undefined;
    const featureId = "webhook-merge";
    const phaseId = "phase-01";
    const mergedAt = "2026-01-01T00:00:00Z";
    const baseGithub = createGitHubHarvestAdapter();
    const githubPort: GitHubHarvestPort = {
      verifyWebhookSignature: baseGithub.verifyWebhookSignature,
      listTerminalPullRequests: vi.fn(async () => []),
      getPullRequest: vi.fn(async () => null),
    };
    try {
      const enrolled = enrollFixtureProject(fixture, {
        repoSlug,
        slug: "webhook-merge",
        localOriginPath: origin.projectRoot,
      });
      const projectId = enrolled.projectId;
      fixtureGit(fixture.projectRoot, "fetch", "origin", "develop");
      fixtureGit(fixture.projectRoot, "reset", "--hard", "origin/develop");
      const mergeCommitSha = fixtureGit(
        origin.projectRoot,
        "rev-parse",
        "HEAD",
      );
      stubListener();
      server = await startDurableServerOnFixture(fixture, {
        projectId,
        github: githubPort,
      });
      startRun(
        {
          feature_id: featureId,
          phase_id: phaseId,
          project_id: projectId,
          command: "ship",
        },
        fixture.db,
      );
      const response = await injectGitHub(
        { app: server },
        "pull_request",
        {
          action: "closed",
          repository: { full_name: repoSlug },
          pull_request: {
            number: 8,
            merged: true,
            merged_at: mergedAt,
            merge_commit_sha: mergeCommitSha,
            html_url: `https://github.com/${repoSlug}/pull/8`,
            base: { ref: "develop", repo: { full_name: repoSlug } },
            head: {
              ref: `feat/${featureId}-${phaseId}`,
              sha: null,
              repo: { full_name: repoSlug },
            },
          },
        },
        "delivery-webhook-merge-8",
      );
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        status: "accepted",
        projectId,
        deliveryId: "delivery-webhook-merge-8",
      });
      await server.close();
      expect(getDb).not.toHaveBeenCalled();
      expect(listRuns(featureId, projectId, fixture.db)).toEqual([
        expect.objectContaining({
          merge_commit_sha: mergeCommitSha,
          status: "merged",
          finished_at: mergedAt,
        }),
      ]);
    } finally {
      try {
        await server?.close();
      } finally {
        await Promise.all([fixture.close(), origin.close()]);
      }
    }
  });

  it.each(["webhook", "watcher"] as const)(
    "syncs the scoped checkout during %s harvest with inherited Git selectors",
    async (entryPoint) => {
      const fixtures: ServerFixture[] = [];
      let server: FastifyInstance | undefined;
      const repoSlug = "synthetic/scoped-sync";
      const featureId = "scoped-sync";
      const phaseId = "phase-01";
      const slowPhaseId = "phase-02";
      const mergedAt = "2026-12-01T00:00:00Z";
      const headRef = `feat/${featureId}-${phaseId}`;
      const slowHeadRef = `feat/${featureId}-${slowPhaseId}`;
      const slowCommand = "exec /bin/sleep 1";
      const slowGates = [
        { id: "T003", gateScript: "gates/T003-gate.sh" },
        { id: "T004", gateScript: "gates/slow.sh" },
        { id: "T005", gateScript: slowCommand },
      ];
      const runTaskGate = gateExec.runTaskGate;
      vi.spyOn(gateExec, "runTaskGate").mockImplementation((task, options) =>
        runTaskGate(task, {
          ...options,
          timeoutMs: slowGates.some(({ id }) => id === task.id)
            ? 50
            : undefined,
        }),
      );
      try {
        const origin = await createServerFixture("routes", {
          routes: ["dispatch"],
        });
        fixtures.push(origin);
        const external = await createServerFixture("routes", {
          routes: ["dispatch"],
        });
        fixtures.push(external);
        const fixture = await createServerFixture("routes", {
          routes: ["dispatch"],
        });
        fixtures.push(fixture);

        vi.stubEnv("GWRK_HOME", join(fixture.projectRoot, ".gwrk"));
        const enrolled = enrollFixtureProject(fixture, {
          repoSlug,
          slug: "scoped-sync",
          localOriginPath: origin.projectRoot,
        });
        const projectId = enrolled.projectId;
        for (const { projectRoot } of [fixture, external]) {
          mkdirSync(join(projectRoot, ".git", "info"), { recursive: true });
          writeFileSync(
            join(projectRoot, ".git", "info", "exclude"),
            ".gwrk/\n",
          );
          if (projectRoot === external.projectRoot) {
            fixtureGit(
              projectRoot,
              "remote",
              "add",
              "origin",
              origin.projectRoot,
            );
          }
          fixtureGit(projectRoot, "fetch", "origin", "develop");
          fixtureGit(projectRoot, "reset", "--hard", "origin/develop");
        }
        fixtureGit(external.projectRoot, "switch", "-c", "external");
        writeFileSync(join(external.projectRoot, "untracked"), "external\n");
        const externalBefore = [
          fixtureGit(external.projectRoot, "rev-parse", "HEAD"),
          fixtureGit(external.projectRoot, "show-ref"),
        ];
        const featureDir = join(origin.projectRoot, "specs", featureId);
        writeFileSync(
          join(origin.projectRoot, ".gwrkrc.json"),
          JSON.stringify({ project: { name: projectId } }),
        );
        mkdirSync(join(featureDir, ".gwrk"), { recursive: true });
        mkdirSync(join(featureDir, "gates"));
        writeFileSync(
          join(featureDir, "plan.md"),
          "## Phase 1: Merge (1 SP)\n## Phase 2: Slow Gates (1 SP)\n",
        );
        const gitGate = 'test "$(git log -1 --format=%s)" = "Advance origin"';
        writeFileSync(
          join(featureDir, "gates", "T002-gate.sh"),
          `#!/bin/sh\n${gitGate}\n`,
          {
            mode: 0o755,
          },
        );
        for (const { gateScript } of slowGates.slice(0, 2)) {
          writeFileSync(
            join(featureDir, gateScript),
            `#!/bin/sh\n${slowCommand}\n`,
            {
              mode: 0o700,
            },
          );
        }
        writeFileSync(
          join(featureDir, ".gwrk", "tasks.json"),
          JSON.stringify({
            featureId,
            createdAt: mergedAt,
            phases: [
              {
                id: phaseId,
                title: "Merge",
                tasks: [
                  {
                    id: "T001",
                    title: "Verify inline gate",
                    description: "",
                    status: "open",
                    gateScript: gitGate,
                  },
                  {
                    id: "T002",
                    title: "Verify file gate",
                    description: "",
                    status: "open",
                    gateScript: "gates/T002-gate.sh",
                  },
                ],
              },
              {
                id: slowPhaseId,
                title: "Slow Gates",
                tasks: slowGates.map((gate) => ({
                  ...gate,
                  title: "Verify gate deadline",
                  description: "",
                  status: "open",
                })),
              },
            ],
          }),
        );
        fixtureGit(origin.projectRoot, "add", "--", ".gwrkrc.json", "specs");
        fixtureGit(
          origin.projectRoot,
          "-c",
          "user.name=Gwrk Test",
          "-c",
          "user.email=gwrk-test@example.invalid",
          "commit",
          "--author=Gwrk Test <gwrk-test@example.invalid>",
          "--no-gpg-sign",
          "--date=2026-11-01T00:00:00Z",
          "-m",
          "Advance origin",
        );
        const originHead = fixtureGit(origin.projectRoot, "rev-parse", "HEAD");
        expect(originHead).not.toBe(externalBefore[0]);

        const binDir = join(external.projectRoot, ".git", "fixture-bin");
        const pollObservedPath = join(binDir, "poll-observed.json");
        mkdirSync(binDir);
        const watcherPayload = JSON.stringify([
          {
            number: 9,
            html_url: `https://github.com/${repoSlug}/pull/9`,
            state: "closed",
            merged_at: mergedAt,
            closed_at: mergedAt,
            merge_commit_sha: originHead,
            base: { ref: "develop", repo: { full_name: repoSlug } },
            head: { ref: headRef, sha: null, repo: { full_name: repoSlug } },
          },
          {
            number: 10,
            html_url: `https://github.com/${repoSlug}/pull/10`,
            state: "closed",
            merged_at: mergedAt,
            closed_at: mergedAt,
            merge_commit_sha: originHead,
            base: { ref: "develop", repo: { full_name: repoSlug } },
            head: {
              ref: slowHeadRef,
              sha: null,
              repo: { full_name: repoSlug },
            },
          },
        ]);
        writeFileSync(
          join(binDir, "gh"),
          `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
if (process.env.GIT_DIR || process.env.GIT_WORK_TREE || process.env.GH_REPO) {
  process.exit(1);
}
if (args[0] === "pr" && args[1] === "view" && args[2] === "9") {
  process.stdout.write(${JSON.stringify(`${mergedAt}\n`)});
  process.exit(0);
}
if (args[0] === "api") {
  fs.writeFileSync(
    ${JSON.stringify(pollObservedPath)},
    JSON.stringify({
      cwd: process.cwd(),
      GIT_DIR: process.env.GIT_DIR,
      GIT_WORK_TREE: process.env.GIT_WORK_TREE,
      GH_REPO: process.env.GH_REPO,
    }),
  );
  process.stdout.write(${JSON.stringify(watcherPayload)});
  process.exit(0);
}
process.exit(1);
`,
          { mode: 0o755 },
        );
        vi.stubEnv("GIT_DIR", join(external.projectRoot, ".git"));
        vi.stubEnv("GIT_WORK_TREE", external.projectRoot);
        vi.stubEnv("GH_REPO", "external/repo");
        vi.stubEnv("PATH", `${binDir}:${process.env.PATH}`);

        stubListener();
        const watcher = vi.spyOn(HarvestWatcher.prototype, "runCheck");
        const baseGithub = createGitHubHarvestAdapter();
        server = await startDurableServerOnFixture(fixture, {
          projectId,
          github:
            entryPoint === "webhook"
              ? {
                  verifyWebhookSignature: baseGithub.verifyWebhookSignature,
                  listTerminalPullRequests: vi.fn(async () => []),
                  getPullRequest: vi.fn(async () => null),
                }
              : undefined,
        });

        if (entryPoint === "watcher") {
          await watcher.mock.results[0]?.value;
          expect(watcher).toHaveBeenCalledOnce();
          const observed = JSON.parse(readFileSync(pollObservedPath, "utf8"));
          expect(observed.cwd).toBe(fixture.projectRoot);
          expect(observed.GIT_DIR).toBeUndefined();
          expect(observed.GIT_WORK_TREE).toBeUndefined();
          expect(observed.GH_REPO).toBeUndefined();
        } else {
          const response = await injectGitHub(
            { app: server },
            "pull_request",
            {
              action: "closed",
              repository: { full_name: repoSlug },
              pull_request: {
                number: 9,
                merged: true,
                merged_at: mergedAt,
                merge_commit_sha: originHead,
                html_url: `https://github.com/${repoSlug}/pull/9`,
                base: { ref: "develop", repo: { full_name: repoSlug } },
                head: {
                  ref: headRef,
                  sha: null,
                  repo: { full_name: repoSlug },
                },
              },
            },
            "delivery-scoped-sync-9",
          );
          expect(response.statusCode).toBe(200);
          const slowResponse = await injectGitHub(
            { app: server },
            "pull_request",
            {
              action: "closed",
              repository: { full_name: repoSlug },
              pull_request: {
                number: 10,
                merged: true,
                merged_at: mergedAt,
                merge_commit_sha: originHead,
                html_url: `https://github.com/${repoSlug}/pull/10`,
                base: { ref: "develop", repo: { full_name: repoSlug } },
                head: {
                  ref: slowHeadRef,
                  sha: null,
                  repo: { full_name: repoSlug },
                },
              },
            },
            "delivery-scoped-sync-10",
          );
          expect(slowResponse.statusCode).toBe(200);
        }
        await server.close();

        expect([
          fixtureGit(external.projectRoot, "rev-parse", "HEAD"),
          fixtureGit(external.projectRoot, "show-ref"),
        ]).toEqual(externalBefore);
        expect(
          fixtureGit(fixture.projectRoot, "rev-parse", "origin/develop"),
        ).toBe(originHead);
        expect(listRuns(featureId, projectId, fixture.db)).toEqual([
          expect.objectContaining({
            phase_id: phaseId,
            status: "merged",
            merge_commit_sha: originHead,
          }),
        ]);
        expect
          .soft(getGateResults(featureId, phaseId, projectId, fixture.db))
          .toEqual(
            expect.arrayContaining([
              expect.objectContaining({ task_id: "T001", passed: 1 }),
              expect.objectContaining({ task_id: "T002", passed: 1 }),
            ]),
          );
        expect
          .soft(getGateResults(featureId, slowPhaseId, projectId, fixture.db))
          .toEqual(
            expect.arrayContaining(
              slowGates.map(({ id }) =>
                expect.objectContaining({
                  task_id: id,
                  passed: 0,
                  exit_code: 1,
                  ...(id === "T005"
                    ? {}
                    : {
                        output: expect.stringContaining(
                          "Gate timed out after 50 ms",
                        ),
                      }),
                }),
              ),
            ),
          );
        expect(
          fixture.db
            .prepare(
              "SELECT status FROM harvest_operations WHERE project_id = ? AND feature_id = ? AND phase_id = ?",
            )
            .get(projectId, featureId, slowPhaseId),
        ).toEqual({ status: "gate_failed" });
        expect
          .soft(getCompressionRecord(featureId, phaseId, projectId, fixture.db))
          .toMatchObject({
            merge_timestamp: mergedAt,
          });
        expect(getDb).not.toHaveBeenCalled();
      } finally {
        try {
          await server?.close();
        } finally {
          await Promise.all(fixtures.map((fixture) => fixture.close()));
        }
      }
    },
  );

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
      await fixture.close().catch((error: unknown) => {
        expect(error).toMatchObject({
          message: "fixture ledger update failed",
        });
      });
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

  it("reports a failed worktree journal append on close after teardown", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const append = persistence.persistDispatch;
    let workDir: string | undefined;
    vi.spyOn(persistence, "persistDispatch").mockImplementation(
      (record, root) => {
        if (record.status === "running" && record.workDir) {
          workDir = record.workDir;
          throw new Error("fixture worktree journal append failed");
        }
        append(record, root);
      },
    );

    try {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "journal-failure", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({
          id: response.json().id,
          status: "failed",
        });
      });
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(workDir).toBeDefined();
      expect(existsSync(workDir ?? "")).toBe(false);
      expect(
        fixtureGit(fixture.projectRoot, "worktree", "list", "--porcelain"),
      ).not.toContain(workDir);
      const queue = await fixture.app.inject("/api/dispatch/queue");
      expect(queue.json().active).toEqual([]);
      await expect(fixture.app.close()).rejects.toThrow(
        "fixture worktree journal append failed",
      );
    } finally {
      await fixture.close();
    }
  });

  it.each([0, 1_200])(
    "isolates fixture Git setup and worktrees from inherited repository selectors after %i ms",
    async (startupDelay) => {
      const { ShipOrchestrator: RealShipOrchestrator } = await vi.importActual<
        typeof import("../engine/ship-orchestrator.js")
      >("../engine/ship-orchestrator.js");
      const external = await createServerFixture("routes", {
        routes: ["dispatch"],
      });
      let fixture: ServerFixture | undefined;
      let finishShip!: (exitCode: number) => void;
      const ship = new Promise<number>((resolve) => {
        finishShip = resolve;
      });
      const branchSetup = vi.fn();
      let recordBranchSetup!: (error?: unknown) => void;
      const branchSetupResult = new Promise<unknown>((resolve) => {
        recordBranchSetup = resolve;
      });
      const stopAfterBranchSetup = new Error("Branch setup completed");
      vi.mocked(ShipOrchestrator).mockImplementationOnce((config) => {
        const orchestrator = new RealShipOrchestrator(config);
        orchestrator.on("ship:stage", ({ stage }: { stage: ShipStage }) => {
          if (stage === ShipStage.ACTIVATE_TESTS) {
            branchSetup();
            recordBranchSetup();
            throw stopAfterBranchSetup;
          }
        });
        return {
          async run() {
            if (startupDelay > 0)
              await new Promise((resolve) => setTimeout(resolve, startupDelay));
            try {
              const exitCode = await orchestrator.run();
              recordBranchSetup(
                new Error(`Ship exited ${exitCode} before branch setup`),
              );
              return exitCode;
            } catch (error) {
              if (error !== stopAfterBranchSetup) {
                recordBranchSetup(error);
                throw error;
              }
              return ship;
            }
          },
          getResult: () => ({}),
        } as ShipOrchestrator;
      });
      const snapshot = () => [
        fixtureGit(external.projectRoot, "rev-parse", "HEAD"),
        fixtureGit(external.projectRoot, "status", "--porcelain"),
        fixtureGit(external.projectRoot, "config", "--local", "--list"),
        fixtureGit(external.projectRoot, "show-ref"),
        fixtureGit(external.projectRoot, "worktree", "list", "--porcelain"),
      ];
      try {
        writeFileSync(join(external.projectRoot, "untracked.txt"), "dirty");
        const branch = "feat/probe-phase-01";
        fixtureGit(external.projectRoot, "branch", branch);
        const original = snapshot();
        vi.stubEnv("GIT_DIR", join(external.projectRoot, ".git"));
        vi.stubEnv("GIT_WORK_TREE", external.projectRoot);
        vi.stubEnv("GIT_DEFAULT_HASH", "invalid-gwrk-probe");
        vi.stubEnv("GIT_COMMITTER_DATE", "invalid-fixture-date");
        vi.stubEnv("GIT_AUTHOR_DATE", "invalid-fixture-date");
        vi.stubEnv("GIT_AUTHOR_NAME", "Inherited Author");
        vi.stubEnv("GIT_AUTHOR_EMAIL", "author@example.invalid");
        vi.stubEnv("GIT_COMMITTER_NAME", "Inherited Committer");
        vi.stubEnv("GIT_COMMITTER_EMAIL", "inherited@example.invalid");
        fixture = await createServerFixture("routes", { routes: ["dispatch"] });
        const { projectRoot } = fixture;
        fixtureGit(
          projectRoot,
          "remote",
          "add",
          "origin",
          external.projectRoot,
        );
        expect(existsSync(join(projectRoot, ".git"))).toBe(true);
        expect(
          fixtureGit(projectRoot, "rev-parse", "--show-object-format"),
        ).toBe("sha1");
        expect(fixtureGit(projectRoot, "log", "-1", "--format=%s")).toBe(
          "Initialize fixture",
        );
        expect(
          fixtureGit(projectRoot, "log", "-1", "--format=%an|%ae|%cn|%ce"),
        ).toBe(
          "Gwrk Test|gwrk-test@example.invalid|Gwrk Test|gwrk-test@example.invalid",
        );
        expect(fixtureGit(projectRoot, "log", "-1", "--format=%at %ct")).toBe(
          "946684800 946684800",
        );
        writeFileSync(
          join(projectRoot, ".gwrkrc.json"),
          JSON.stringify({
            project: { name: fixture.projectId, toolchain: { test: null } },
          }),
        );
        fixtureGit(projectRoot, "add", ".gwrkrc.json");
        fixtureGit(projectRoot, "commit", "-m", "Declare Git-only fixture");
        const worktrees = () =>
          fixtureGit(projectRoot, "worktree", "list", "--porcelain").match(
            /^worktree .+$/gm,
          );
        const response = await fixture.app.inject({
          method: "POST",
          url: "/api/dispatch",
          payload: { featureId: "probe", phaseId: "phase-01" },
        });
        expect(response.statusCode).toBe(201);
        expect(await branchSetupResult).toBeUndefined();
        expect(branchSetup).toHaveBeenCalledOnce();
        const workDir = fixture.journal().at(-1)?.workDir;
        expect(workDir).toBeDefined();
        expect(worktrees()).toEqual([
          `worktree ${projectRoot}`,
          `worktree ${workDir}`,
        ]);
        expect(snapshot()).toEqual(original);
        expect(fixtureGit(projectRoot, "branch", "--list", branch)).toContain(
          branch,
        );
        expect(fixtureGit(projectRoot, "rev-parse", `origin/${branch}`)).toBe(
          original[0],
        );

        finishShip(0);
        await fixture.app.close();
        expect(fixture.journal().at(-1)?.status).toBe("completed");
        expect(existsSync(workDir ?? "")).toBe(false);
        expect(worktrees()).toEqual([`worktree ${projectRoot}`]);
        expect(snapshot()).toEqual(original);
      } finally {
        finishShip(0);
        try {
          await Promise.all([fixture?.close(), external.close()]);
        } finally {
          vi.unstubAllEnvs();
        }
      }
    },
  );

  it("pins fixture Git reference storage despite an invalid inherited format", async () => {
    vi.stubEnv("GIT_DEFAULT_REF_FORMAT", "invalid-gwrk-probe");
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    try {
      expect(
        existsSync(
          join(fixture.projectRoot, ".git", "refs", "heads", "develop"),
        ),
      ).toBe(true);
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "probe", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await fixture.app.close();
      expect(fixture.journal().at(-1)?.status).toBe("completed");
    } finally {
      await fixture.close();
    }
  });

  it("ignores inherited Git trace destinations through fixture close", async () => {
    const external = mkdtempSync(join(tmpdir(), "gwrk-git-trace-"));
    const trace = join(external, "trace.json");
    let fixture: ServerFixture | undefined;
    try {
      vi.stubEnv("GIT_TRACE2_EVENT", trace);
      fixture = await createServerFixture("routes", { routes: ["dispatch"] });
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "trace-probe", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await fixture.app.close();
      expect(fixture.journal().at(-1)?.status).toBe("completed");
      expect(existsSync(trace)).toBe(false);
    } finally {
      try {
        await fixture?.close();
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    }
  });

  it("stops polling while server close drains an active dispatch", async () => {
    stubListener();
    const stopMonitor = vi.spyOn(SystemMonitor.prototype, "stopPolling");
    const stopHarvest = vi.spyOn(HarvestWatcher.prototype, "stop");
    const fixture = await createServerFixture("listen");
    let finishShip!: (exitCode: number) => void;
    const ship = new Promise<number>((resolve) => {
      finishShip = resolve;
    });
    const run = vi.fn(() => ship);
    vi.mocked(ShipOrchestrator).mockImplementationOnce(
      () => ({ run, getResult: () => ({}) }) as ShipOrchestrator,
    );
    let close: Promise<void> | undefined;
    try {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "shutdown-drain", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

      const closed = vi.fn();
      close = fixture.app.close().then(closed);
      await vi.waitFor(() => {
        expect(stopMonitor).toHaveBeenCalledOnce();
        expect(stopHarvest).toHaveBeenCalledOnce();
      });
      expect(closed).not.toHaveBeenCalled();
      expect(readIfPresent(fixture.pidPath)).toBe(String(process.pid));
      expect(listRuns("shutdown-drain", fixture.projectId, fixture.db)).toEqual(
        [expect.objectContaining({ finished_at: null })],
      );

      finishShip(0);
      await close;
      expect(fixture.journal().at(-1)?.status).toBe("completed");
      expect(listRuns("shutdown-drain", fixture.projectId, fixture.db)).toEqual(
        [expect.objectContaining({ exit_code: 0 })],
      );
      expect(existsSync(fixture.pidPath)).toBe(false);
    } finally {
      finishShip(0);
      try {
        await close;
      } finally {
        await fixture.close();
      }
    }
  });

  it("retries a dispatch after the first journal append fails", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const journal = join(fixture.projectRoot, ".gwrk", "dispatches.jsonl");
    const request = {
      method: "POST" as const,
      url: "/api/dispatch",
      payload: { featureId: "retry-append", phaseId: "phase-01" },
    };
    try {
      mkdirSync(journal);
      expect((await fixture.app.inject(request)).statusCode).toBe(500);
      const queue = await fixture.app.inject("/api/dispatch/queue");
      expect(queue.json()).toMatchObject({ active: [], queued: [] });
      rmSync(journal, { recursive: true });

      const retry = await fixture.app.inject(request);
      expect(retry.statusCode).toBe(201);
      const { id } = retry.json();
      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({
          id,
          status: "completed",
        });
      });
      expect(
        fixture.journal().filter(({ status }) => status === "queued"),
      ).toHaveLength(1);
      expect(ShipOrchestrator).toHaveBeenCalledOnce();
    } finally {
      await fixture.close();
    }
  });

  it("retains a locked dispatch worktree and reports the removal failure on close", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    let lockedWorktree: string | undefined;
    const run = vi.fn(async () => {
      const workDir = fixture.journal().at(-1)?.workDir;
      if (!workDir) throw new Error("Expected a dispatch worktree");
      fixtureGit(fixture.projectRoot, "worktree", "lock", workDir);
      lockedWorktree = workDir;
      return 0;
    });
    vi.mocked(ShipOrchestrator).mockImplementationOnce(
      () => ({ run, getResult: () => ({}) }) as unknown as ShipOrchestrator,
    );
    try {
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "locked-worktree", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();
      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({
          id,
          status: "completed",
        });
      });
      expect(lockedWorktree).toBeDefined();
      expect(fixture.journal().at(-1)?.workDir).toBe(lockedWorktree);
      expect(existsSync(lockedWorktree ?? "")).toBe(true);
      expect(
        fixtureGit(fixture.projectRoot, "worktree", "list", "--porcelain"),
      ).toContain(`worktree ${lockedWorktree}\n`);
      const queue = await fixture.app.inject("/api/dispatch/queue");
      expect(queue.json().active).toEqual([]);
      await expect(fixture.app.close()).rejects.toMatchObject({
        message: expect.stringContaining(
          `Failed to remove worktree ${lockedWorktree}`,
        ),
        cause: expect.objectContaining({
          message: expect.stringContaining(
            "cannot remove a locked working tree",
          ),
        }),
      });
    } finally {
      try {
        if (lockedWorktree) {
          fixtureGit(fixture.projectRoot, "worktree", "unlock", lockedWorktree);
          fixtureGit(
            fixture.projectRoot,
            "worktree",
            "remove",
            "--force",
            lockedWorktree,
          );
        }
      } finally {
        await fixture.close();
      }
    }
  });

  it("removes a missing worktree registration and reuses its dispatch branch", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const dispatch = {
      method: "POST" as const,
      url: "/api/dispatch",
      payload: { featureId: "missing-worktree", phaseId: "phase-01" },
    };
    vi.mocked(ShipOrchestrator).mockImplementationOnce(
      ({ cwd }) =>
        ({
          run: vi.fn(async () => {
            rmSync(cwd, { recursive: true, force: true });
            return 0;
          }),
          getResult: () => ({}),
        }) as unknown as ShipOrchestrator,
    );
    try {
      for (let i = 0; i < 2; i++) {
        const response = await fixture.app.inject(dispatch);
        expect(response.statusCode).toBe(201);
        await vi.waitFor(() => {
          expect(fixture.journal().at(-1)).toMatchObject({
            id: response.json().id,
            status: "completed",
          });
        });
        expect(
          fixtureGit(
            fixture.projectRoot,
            "worktree",
            "list",
            "--porcelain",
          ).match(/^worktree .+$/gm),
        ).toEqual([`worktree ${fixture.projectRoot}`]);
      }
      expect(ShipOrchestrator).toHaveBeenCalledTimes(2);
    } finally {
      await fixture.close();
    }
  });

  it("keeps machine Git hooks out of fixture setup and dispatch", async () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk-git-config-"));
    const marker = join(parent, "fsmonitor-ran");
    const hook = join(parent, "fsmonitor");
    const globalConfig = join(parent, "gitconfig");
    let fixture: ServerFixture | undefined;
    try {
      writeFileSync(
        hook,
        `#!/bin/sh\nprintf "ran" > '${marker.replaceAll("'", "'\\''")}'\n`,
        { mode: 0o700 },
      );
      execFileSync("git", [
        "config",
        "--file",
        globalConfig,
        "core.fsmonitor",
        hook,
      ]);
      vi.stubEnv("GIT_CONFIG_GLOBAL", globalConfig);
      fixture = await createServerFixture("routes", { routes: ["dispatch"] });
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "isolated-config", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await fixture.app.close();
      expect(fixture.journal().at(-1)?.status).toBe("completed");
      expect(existsSync(marker)).toBe(false);
    } finally {
      try {
        await fixture?.close();
      } finally {
        vi.unstubAllEnvs();
        rmSync(parent, { recursive: true, force: true });
      }
    }
  });

  it("completes a dispatch with spaces in its temporary directory", async () => {
    const parent = mkdtempSync(join(tmpdir(), "gwrk fixture space "));
    let fixture: ServerFixture | undefined;
    const run = vi.fn(async () => 0);
    vi.mocked(ShipOrchestrator).mockImplementationOnce(
      () => ({ run, getResult: () => ({}) }) as unknown as ShipOrchestrator,
    );
    try {
      vi.stubEnv("TMPDIR", parent);
      fixture = await createServerFixture("routes", { routes: ["dispatch"] });
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "spaces", phaseId: "phase-01" },
      });
      expect(response.statusCode).toBe(201);
      await fixture.app.close();
      expect(run).toHaveBeenCalledOnce();
      expect(fixture.journal().at(-1)).toMatchObject({
        id: response.json().id,
        status: "completed",
      });
      const workDir = fixture
        .journal()
        .find((record) => record.workDir)?.workDir;
      expect(workDir).toContain("gwrk fixture space ");
      expect(existsSync(workDir ?? "")).toBe(false);
      expect(
        fixtureGit(
          fixture.projectRoot,
          "worktree",
          "list",
          "--porcelain",
        ).match(/^worktree .+$/gm),
      ).toEqual([`worktree ${fixture.projectRoot}`]);
    } finally {
      try {
        await fixture?.close();
      } finally {
        vi.unstubAllEnvs();
        rmSync(parent, { recursive: true, force: true });
      }
    }
  });

  it("keeps an existing PID record when a second startup cannot acquire it", async () => {
    const fixture = await createServerFixture("routes", {
      routes: ["dispatch"],
    });
    const first = fastify();
    const second = fastify();
    for (const app of [first, second]) {
      vi.spyOn(app, "listen").mockResolvedValue("http://127.0.0.1:0");
    }
    vi.mocked(fastify).mockReturnValueOnce(first).mockReturnValueOnce(second);
    const config = GwrkConfigSchema.parse({
      project: { name: "pid ownership" },
      server: { host: "127.0.0.1", port: 0 },
    });
    const pid = {
      writePid(pid: number) {
        writeFileSync(fixture.pidPath, String(pid), { flag: "wx" });
      },
      removePid() {
        if (readIfPresent(fixture.pidPath) === String(process.pid)) {
          rmSync(fixture.pidPath);
        }
      },
    };
    const options = {
      projectRoot: fixture.projectRoot,
      handleSignals: false,
      pid,
      ledger: { projectId: fixture.projectId, db: fixture.db },
    };
    try {
      await startServer(config, options);
      await expect(startServer(config, options)).rejects.toMatchObject({
        code: "EEXIST",
      });
      expect.soft(readIfPresent(fixture.pidPath)).toBe(String(process.pid));
      await first.close();
      expect(existsSync(fixture.pidPath)).toBe(false);
      expect(getDb).not.toHaveBeenCalled();
    } finally {
      await first.close();
      await fixture.close();
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
