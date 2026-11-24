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
import { getTestDb, openDatabase } from "./index.js";
import {
  type IssueRecord,
  listIssues,
  updateIssue,
  upsertIssue,
} from "./issues.js";
import { createProjectRegistry } from "./project-registry.js";

describe("FR-H14: Issues Ledger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  describe.each([false, true])(
    "issue writes with enrollment first = %s",
    (enrollmentFirst) => {
      it.each(["upsert", "update"])(
        "keeps the latest %s closure",
        (mutation) => {
          const checkout = mkdtempSync(join(tmpdir(), "gwrk-write-order-"));
          onTestFinished(() =>
            rmSync(checkout, { recursive: true, force: true }),
          );
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
          const issue: IssueRecord = {
            issue_number: 7,
            feature_id: "shared",
            title: "Issue",
            body: null,
            state: "open",
            created_at: project.createdAt,
            author: "tester",
          };
          upsertIssue(issue, localId, writer);
          upsertIssue(issue, remoteId, other);
          if (enrollmentFirst) enroll();

          let writerLocked = false;
          const method = mutation === "upsert" ? "get" : "run";
          const prepare = writer.prepare.bind(writer);
          const spy = vi.spyOn(writer, "prepare").mockImplementation(((
            sql: string,
          ) => {
            const statement = prepare(sql);
            if (
              !enrollmentFirst &&
              /^(?:INSERT INTO|UPDATE) issues/.test(sql.trim())
            ) {
              const execute = statement[method].bind(statement);
              vi.spyOn(statement, method).mockImplementationOnce((...args) => {
                try {
                  enroll();
                } catch (error) {
                  if ((error as Database.SqliteError).code !== "SQLITE_BUSY")
                    throw error;
                  writerLocked = true;
                }
                return execute(...args);
              });
            }
            return statement;
          }) as typeof writer.prepare);
          try {
            if (mutation === "upsert") {
              upsertIssue({ ...issue, state: "closed" }, localId, writer);
            } else {
              updateIssue(7, localId, { state: "closed" }, writer);
            }
          } finally {
            spy.mockRestore();
          }
          if (!enrollmentFirst) {
            expect.soft(writerLocked).toBe(true);
            if (writerLocked) enroll();
          }

          for (const id of [localId, remoteId]) {
            expect
              .soft(listIssues("shared", id, other))
              .toMatchObject([{ issue_number: 7, state: "closed" }]);
          }
        },
      );
    },
  );

  it("US-H07: upsertIssue inserts a new issue record", () => {
    const issue: IssueRecord = {
      issue_number: 101,
      feature_id: "011-harvest",
      title: "Post-ship bug",
      body: "Found a bug after shipping",
      state: "open",
      created_at: new Date().toISOString(),
      author: "tester",
    };

    const id = upsertIssue(issue, "test-project", db);
    expect(id).toBeGreaterThan(0);

    const issues = listIssues("011-harvest", "test-project", db);
    expect(issues.length).toBe(1);
    expect(issues[0].issue_number).toBe(101);
  });

  it("lists a moved issue under its canonical feature", () => {
    const issue: IssueRecord = {
      issue_number: 7,
      feature_id: "old-feature",
      title: "Moved issue",
      body: null,
      state: "open",
      created_at: "2026-11-11",
      author: "tester",
    };
    upsertIssue(issue, "alias", db);
    upsertIssue({ ...issue, feature_id: "new-feature" }, "canonical", db);
    db.exec(`
      INSERT INTO projects (id, name, path) VALUES ('canonical', 'Canonical', '');
      INSERT INTO project_aliases (alias_id, project_id) VALUES ('alias', 'canonical');
    `);

    expect(listIssues("old-feature", "canonical", db)).toEqual([]);
    expect(listIssues("new-feature", "canonical", db)).toMatchObject([
      { issue_number: 7, project_id: "canonical" },
    ]);
  });

  it("should update issue status", () => {
    const issue: IssueRecord = {
      issue_number: 102,
      feature_id: "011-harvest",
      title: "Another bug",
      body: "...",
      state: "open",
      created_at: new Date().toISOString(),
      author: "tester",
    };

    upsertIssue(issue, "test-project", db);
    updateIssue(
      102,
      "test-project",
      { state: "closed", closed_at: new Date().toISOString() },
      db,
    );

    const issues = listIssues("011-harvest", "test-project", db);
    expect(issues[0].state).toBe("closed");
    expect(issues[0].closed_at).toBeDefined();
  });
});
