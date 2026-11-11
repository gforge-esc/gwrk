/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type ServerFixture,
  createServerFixture,
  fixtureGit,
} from "../../../tests/helpers/server-fixture.js";
import { listRuns } from "../../db/runs.js";
import { ShipOrchestrator } from "../../engine/ship-orchestrator.js";
import { SystemMonitor } from "../monitor.js";

vi.mock("../slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(),
}));
vi.mock("../../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/index.js")>()),
  getDb: () => {
    throw new Error("Unexpected access to the default SQLite connection");
  },
}));

describe("dispatch routes", () => {
  let fixture: ServerFixture;

  beforeEach(async () => {
    vi.spyOn(SystemMonitor.prototype, "isThrottled").mockReturnValue(false);
    vi.mocked(ShipOrchestrator).mockImplementation(
      () =>
        ({
          run: async () => 0,
          getResult: () => ({ prNumber: 42 }),
        }) as ShipOrchestrator,
    );
    fixture = await createServerFixture("routes", { routes: ["dispatch"] });
  });

  afterEach(async () => {
    try {
      await fixture?.close();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("should enqueue a dispatch via POST /api/dispatch", async () => {
    const server = fixture.app;

    const response = await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    expect(response.statusCode).toBe(201);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");
    expect(json.status).toBeDefined();
  });

  it("should return the queue status via GET /api/dispatch/queue", async () => {
    const server = fixture.app;

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/queue",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.active).toBeDefined();
    expect(json.queued).toBeDefined();
  });

  it("should return a specific dispatch via GET /api/dispatch/:feature/:phase", async () => {
    const server = fixture.app;

    // First enqueue it
    await server.inject({
      method: "POST",
      url: "/api/dispatch",
      payload: {
        featureId: "feat-1",
        phaseId: "phase-1",
      },
    });

    const response = await server.inject({
      method: "GET",
      url: "/api/dispatch/feat-1/phase-1",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.featureId).toBe("feat-1");
    expect(json.phaseId).toBe("phase-1");
  });
  it.each([
    { exitCode: 0, status: "completed" },
    { exitCode: 1, status: "failed" },
  ])(
    "persists a $status dispatch only in its fixture",
    async ({ exitCode, status }) => {
      vi.mocked(ShipOrchestrator).mockImplementationOnce(
        () =>
          ({
            run: async () => exitCode,
            getResult: () => ({}),
          }) as ShipOrchestrator,
      );
      const response = await fixture.app.inject({
        method: "POST",
        url: "/api/dispatch",
        payload: { featureId: "feat-1", phaseId: "phase-1" },
      });
      expect(response.statusCode).toBe(201);
      const { id } = response.json();

      await vi.waitFor(() => {
        expect(fixture.journal().at(-1)).toMatchObject({ id, status });
      });
      expect(listRuns("feat-1", fixture.projectId, fixture.db)).toEqual([
        expect.objectContaining({
          exit_code: exitCode,
          finished_at: expect.any(String),
        }),
      ]);
      expect(
        fixtureGit(
          fixture.projectRoot,
          "worktree",
          "list",
          "--porcelain",
        ).match(/^worktree /gm),
      ).toHaveLength(1);
      expect(fixtureGit(fixture.projectRoot, "remote")).toBe("");
    },
  );
});
