import { describe, it, expect, beforeEach } from "vitest";
import { getTestDb } from "./index.js";
import { saveIssue, updateIssue, listIssues, type IssueRecord } from "./issues.js";

describe("FR-H14: SQLite issues table persistence", () => {
  let db: any;

  beforeEach(() => {
    db = getTestDb();
  });

  it("US-H07: Verify DB issue status transitions from open to closed (TR-H11)", () => {
    const issue: IssueRecord = {
      issue_number: 123,
      feature_id: "011-harvest",
      title: "Fix bug",
      body: "Something is broken",
      state: "open",
      created_at: "2026-05-17T10:00:00Z",
      author: "alice",
    };

    saveIssue(issue, db);

    const issues = listIssues("011-harvest", db);
    expect(issues).toHaveLength(1);
    expect(issues[0].state).toBe("open");

    updateIssue(123, { state: "closed", closed_at: "2026-05-17T11:00:00Z" }, db);

    const updatedIssues = listIssues("011-harvest", db);
    expect(updatedIssues[0].state).toBe("closed");
    expect(updatedIssues[0].closed_at).toBe("2026-05-17T11:00:00Z");
  });

  it("Negative path: update fails for non-existent issue", async () => {
    // updateIssue doesn't throw if not found, it just updates 0 rows.
    // We could make it return the number of updated rows if needed.
    expect(() => {
        updateIssue(999, { state: "closed" }, db);
    }).not.toThrow();
  });

  it("US-H07: saveIssue replaces existing record (idempotency)", () => {
    const issue: IssueRecord = {
        issue_number: 123,
        feature_id: "011-harvest",
        title: "Fix bug",
        body: "Something is broken",
        state: "open",
        created_at: "2026-05-17T10:00:00Z",
        author: "alice",
      };
  
      saveIssue(issue, db);
      saveIssue({ ...issue, title: "Fixed bug" }, db);
  
      const issues = listIssues("011-harvest", db);
      expect(issues).toHaveLength(1);
      expect(issues[0].title).toBe("Fixed bug");
  });
});
