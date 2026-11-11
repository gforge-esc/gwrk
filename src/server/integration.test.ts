/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, sep } from "node:path";
import fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
  fixtureGit,
} from "../../tests/helpers/server-fixture.js";
import { listRuns } from "../db/runs.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import { execCommand } from "../utils/exec.js";
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
vi.mock("../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../db/index.js")>()),
  getDb: () => {
    throw new Error("Unexpected access to the default SQLite connection");
  },
}));
vi.mock("../utils/exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/exec.js")>()),
  execCommand: vi.fn(),
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

describe("Server E2E Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);
    vi.spyOn(NetworkMonitor.prototype, "isOnline").mockReturnValue(true);
    vi.spyOn(PlanHeartbeat.prototype, "runCheck").mockResolvedValue(undefined);
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
