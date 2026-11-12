/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCompressionRecord } from "../../db/compression.js";
import type { CompressionReport } from "../../domain/types.js";
import { PlanStore } from "../../engine/plan-store.js";
import {
  createSqlitePlanStoreAdapter,
  createSqliteRunStoreAdapter,
} from "./index.js";

vi.mock("../../db/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../db/index.js")>()),
  getDb: () => {
    throw new Error("Unexpected access to the default SQLite connection");
  },
}));

describe("SQLite store isolation", () => {
  let dir: string;
  let first: Database.Database;
  let second: Database.Database;
  const projectId = "same-project";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-store-isolation-"));
    first = new Database(path.join(dir, "first.db"));
    second = new Database(path.join(dir, "second.db"));
    const migrations = path.join(process.cwd(), "src/db/migrations");
    for (const name of fs
      .readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      const sql = fs.readFileSync(path.join(migrations, name), "utf8");
      first.exec(sql);
      second.exec(sql);
    }
  });

  afterEach(() => {
    first.close();
    second.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps writes and reads on the bound plan connection", () => {
    const firstStore = new PlanStore(projectId, first);
    const secondStore = new PlanStore(projectId, second);
    firstStore.addFeature({
      id: "feature",
      name: "First",
      status: "DEFINED",
      sp_total: 1,
    });
    secondStore.addFeature({
      id: "feature",
      name: "Second",
      status: "PLANNED",
      sp_total: 2,
    });
    expect(firstStore.getPlanStatus().features.map(({ name }) => name)).toEqual(
      ["First"],
    );
    expect(
      secondStore.getPlanStatus().features.map(({ name }) => name),
    ).toEqual(["Second"]);
  });

  it("initializes and renders an owned plan database", async () => {
    const root = path.join(dir, "specs", "042-boundary");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "spec.md"), "# Boundary");
    fs.writeFileSync(path.join(root, "plan.md"), "### Phase 1: Boundary");
    const adapter = createSqlitePlanStoreAdapter({
      projectId,
      dbPath: path.join(dir, "nested state", "plan.db"),
    });

    try {
      await expect(adapter.initFromSpecs(path.dirname(root))).resolves.toEqual({
        added: 1,
        skipped: 0,
        phases: 1,
      });
      const rendered = path.join(dir, "plan.md");
      await adapter.renderToMarkdown(rendered);
      expect(fs.readFileSync(rendered, "utf8")).toContain("042-boundary");
    } finally {
      adapter.close();
    }
    await expect(adapter.initFromSpecs(path.dirname(root))).rejects.toThrow();
  });

  it("keeps compression writes on the bound run connection", () => {
    const firstStore = createSqliteRunStoreAdapter({ db: first });
    const secondStore = createSqliteRunStoreAdapter({ db: second });
    const timestamp = "2026-11-11T00:00:00.000Z";
    const report: CompressionReport = {
      featureId: "feature",
      phaseId: "phase-01",
      generatedAt: timestamp,
      forecast: { totalSP: 1, roles: [], estimatedHours: 2, estimatedDays: 1 },
      actuals: {
        specCreatedAt: timestamp,
        firstImplCommit: timestamp,
        lastImplCommit: timestamp,
        prMergedAt: timestamp,
        dormancyDays: 0,
        activeCodingMinutes: 120,
        sessionCount: 1,
        deliveryWindowHours: 2,
      },
      compression: {
        pointCompression: 1,
        totalCompression: 1,
        dormancyDays: 0,
      },
    };
    firstStore.recordCompression(report, projectId);
    secondStore.recordCompression(
      {
        ...report,
        actuals: { ...report.actuals, activeCodingMinutes: 60 },
      },
      projectId,
    );
    firstStore.close();
    secondStore.close();
    expect(first.open && second.open).toBe(true);
    expect(
      getCompressionRecord("feature", "phase-01", projectId, first)
        ?.actual_coding_hours,
    ).toBe(2);
    expect(
      getCompressionRecord("feature", "phase-01", projectId, second)
        ?.actual_coding_hours,
    ).toBe(1);
  });
});
