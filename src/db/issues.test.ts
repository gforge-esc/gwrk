import { describe, expect, it, beforeEach } from "vitest";
import { getTestDb } from "./index.js";
import { saveIssue, updateIssue, listIssues, type IssueRecord } from "./issues.js";
import type Database from "better-sqlite3";

describe("FR-H14: Issues Ledger", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = getTestDb();
  });

  it("US-H07: saveIssue inserts a new issue record", () => {
    const issue: IssueRecord = {
      issue_number: 101,
      feature_id: "011-harvest",
      title: "Post-ship bug",
      body: "Found a bug after shipping",
      state: "open",
      created_at: new Date().toISOString(),
      author: "tester"
    };

    const id = saveIssue(issue, db);
    expect(id).toBeGreaterThan(0);

    const issues = listIssues("011-harvest", db);
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
      author: "tester"
    };

    saveIssue(issue, db);
    updateIssue(102, { state: "closed", closed_at: new Date().toISOString() }, db);

    const issues = listIssues("011-harvest", db);
    expect(issues[0].state).toBe("closed");
    expect(issues[0].closed_at).toBeDefined();
  });
});
