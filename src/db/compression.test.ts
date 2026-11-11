/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { resolveProjectId } from "../adapters/git/project-id.js";
import type { CompressionReport } from "../engine/types.js";
import {
  getCompressionRecord,
  listCompressionRecords,
  recordCompression,
} from "./compression.js";
import { getTestDb, openDatabase } from "./index.js";
import { createProjectRegistry } from "./project-registry.js";

describe("FR-H06: Compression recording", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it.each([false, true])(
    "keeps the latest report with enrollment first = %s",
    (enrollmentFirst) => {
      const checkout = mkdtempSync(join(tmpdir(), "gwrk-write-order-"));
      onTestFinished(() => rmSync(checkout, { recursive: true, force: true }));
      execFileSync("git", ["init", "--quiet", checkout]);
      const dbPath = join(checkout, "ledger.sqlite");
      const writer = openDatabase({ dbPath });
      onTestFinished(() => {
        writer.close();
      });
      const other = openDatabase({ dbPath });
      onTestFinished(() => {
        other.close();
      });
      other.pragma("busy_timeout = 0");
      const registry = createProjectRegistry(other, () => {});
      const localId = resolveProjectId(checkout);
      const project = {
        projectId: localId,
        slug: "checkout",
        name: "Checkout",
        repoSlug: null,
        trunkBranch: "develop",
        localRoot: checkout,
        mirrorPath: null,
        runnerPolicy: { allowedKinds: ["local" as const] },
        slack: null,
        legacyProjectIds: [],
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      };
      registry.enrollProject(project);
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "git@github.com:example/checkout.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      const enroll = () =>
        registry.enrollProject({
          ...project,
          projectId: remoteId,
          repoSlug: "example/checkout",
        });
      const report: CompressionReport = {
        featureId: "list-feat",
        phaseId: "p1",
        generatedAt: new Date().toISOString(),
        forecast: {
          totalSP: 1,
          roles: [],
          estimatedHours: 10,
          estimatedDays: 1,
        },
        actuals: {
          specCreatedAt: "2026-03-01T08:00:00Z",
          firstImplCommit: "2026-03-01T10:00:00Z",
          lastImplCommit: "2026-03-02T09:00:00Z",
          prMergedAt: "2026-03-02T10:00:00Z",
          dormancyDays: 0,
          activeCodingMinutes: 60,
          sessionCount: 1,
          deliveryWindowHours: 24,
        },
        compression: {
          pointCompression: 10,
          totalCompression: 1,
          dormancyDays: 0,
        },
      };

      recordCompression(report, remoteId, other);
      const updated = {
        ...report,
        actuals: { ...report.actuals, activeCodingMinutes: 120 },
      };
      let raced = false;
      const prepare = writer.prepare.bind(writer);
      const spy = vi.spyOn(writer, "prepare").mockImplementation(((
        sql: string,
      ) => {
        const statement = prepare(sql);
        if (sql.includes("INSERT OR REPLACE INTO compression")) {
          const run = statement.run.bind(statement);
          vi.spyOn(statement, "run").mockImplementationOnce((...args) => {
            raced = true;
            if (enrollmentFirst) enroll();
            return run(...args);
          });
        }
        return statement;
      }) as typeof writer.prepare);
      let id: number;
      try {
        id = recordCompression(updated, localId, writer);
      } finally {
        spy.mockRestore();
      }
      if (!enrollmentFirst) enroll();
      expect(raced).toBe(true);
      expect(
        other
          .prepare("SELECT project_id FROM compression WHERE id = ?")
          .get(id),
      ).toEqual({ project_id: enrollmentFirst ? remoteId : localId });
      for (const projectId of [localId, remoteId]) {
        const winner = getCompressionRecord(
          "list-feat",
          "p1",
          projectId,
          other,
        );
        expect.soft(winner).toMatchObject({ id, actual_coding_hours: 2 });
        expect
          .soft(listCompressionRecords("list-feat", projectId, other))
          .toEqual([winner]);
      }
    },
  );

  it("US-H04: recordCompression correctly inserts record", async () => {
    const report: CompressionReport = {
      featureId: "011-harvest",
      phaseId: "phase-1",
      generatedAt: new Date().toISOString(),
      forecast: {
        totalSP: 10,
        roles: [],
        estimatedHours: 100,
        estimatedDays: 12.5,
      },
      actuals: {
        specCreatedAt: "2026-03-01T08:00:00Z",
        firstImplCommit: "2026-03-01T10:00:00Z",
        lastImplCommit: "2026-03-02T09:00:00Z",
        prMergedAt: "2026-03-02T10:00:00Z",
        dormancyDays: 5,
        activeCodingMinutes: 120,
        sessionCount: 2,
        deliveryWindowHours: 24,
      },
      compression: {
        pointCompression: 50,
        totalCompression: 12.5,
        dormancyDays: 5,
      },
    };

    const id = recordCompression(report, "test-project", db);
    expect(id).toBeDefined();
    expect(typeof id).toBe("number");

    const record = getCompressionRecord(
      "011-harvest",
      "phase-1",
      "test-project",
      db,
    );
    expect(record).toBeDefined();
    expect(record?.estimated_hours).toBe(100);
    expect(record?.actual_coding_hours).toBe(2); // 120 minutes / 60
  });

  it("should fail if report is missing mandatory fields", () => {
    // @ts-ignore
    const report: Partial<CompressionReport> = {
      featureId: "011-harvest",
    };

    expect(() => {
      // @ts-ignore
      recordCompression(report, "test-project", db);
    }).toThrow();
  });

  it("should list compression records for a feature", () => {
    const report: CompressionReport = {
      featureId: "list-feat",
      phaseId: "p1",
      generatedAt: new Date().toISOString(),
      forecast: { totalSP: 1, roles: [], estimatedHours: 10, estimatedDays: 1 },
      actuals: {
        specCreatedAt: "2026-03-01T08:00:00Z",
        firstImplCommit: "2026-03-01T10:00:00Z",
        lastImplCommit: "2026-03-02T09:00:00Z",
        prMergedAt: "2026-03-02T10:00:00Z",
        dormancyDays: 0,
        activeCodingMinutes: 60,
        sessionCount: 1,
        deliveryWindowHours: 24,
      },
      compression: {
        pointCompression: 10,
        totalCompression: 1,
        dormancyDays: 0,
      },
    };

    db.prepare(
      "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)",
    ).run("test-project", "Checkout", "/fixtures/previous", "example/checkout");
    recordCompression(report, "test-project", db);

    const records = listCompressionRecords("list-feat", "test-project", db);
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBe(1);
    expect(records[0].feature_id).toBe("list-feat");

    const checkout = mkdtempSync(join(tmpdir(), "gwrk-compression-checkout-"));
    onTestFinished(() => rmSync(checkout, { recursive: true, force: true }));
    execFileSync("git", ["init", "--quiet", checkout], { stdio: "ignore" });
    execFileSync("git", [
      "-C",
      checkout,
      "remote",
      "add",
      "origin",
      "https://github.com/example/checkout.git",
    ]);
    const canonicalId = resolveProjectId(checkout);
    createProjectRegistry(db, () => {}).enrollProject({
      projectId: canonicalId,
      slug: "checkout",
      name: "Checkout",
      repoSlug: "example/checkout",
      trunkBranch: "develop",
      localRoot: checkout,
      mirrorPath: null,
      runnerPolicy: { allowedKinds: ["local"] },
      slack: null,
      legacyProjectIds: ["test-project"],
      createdAt: report.generatedAt,
      updatedAt: report.generatedAt,
    });
    const id = recordCompression(report, canonicalId, db);
    for (const projectId of ["test-project", canonicalId]) {
      const winner = getCompressionRecord("list-feat", "p1", projectId, db);
      expect(winner?.id).toBe(id);
      expect(listCompressionRecords("list-feat", projectId, db)).toEqual([
        winner,
      ]);
    }
  });
});
