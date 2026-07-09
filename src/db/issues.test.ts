/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { getTestDb } from "./index.js";
import {
  type IssueRecord,
  listIssues,
  updateIssue,
  upsertIssue,
} from "./issues.js";

describe("FR-H14: Issues Ledger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

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
