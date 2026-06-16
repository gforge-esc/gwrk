/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";

export interface IssueRecord {
  id?: number;
  issue_number: number;
  feature_id: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url?: string | null;
  project_id?: string;
  created_at: string;
  closed_at?: string | null;
  author: string;
}

/**
 * Save a new issue record or replace if it already exists (by issue_number).
 */
export function saveIssue(
  issue: IssueRecord,
  projectId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(
      `INSERT OR REPLACE INTO issues (
        issue_number, feature_id, title, body, state, html_url, project_id, created_at, closed_at, author
      )
      VALUES (
        @issue_number, @feature_id, @title, @body, @state, @html_url, @project_id, @created_at, @closed_at, @author
      )`,
    )
    .run({
      issue_number: issue.issue_number,
      feature_id: issue.feature_id,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state,
      html_url: issue.html_url ?? null,
      project_id: projectId,
      created_at: issue.created_at,
      closed_at: issue.closed_at ?? null,
      author: issue.author,
    });
  return Number(result.lastInsertRowid);
}


/**
 * Update an existing issue by issue_number.
 */
export function updateIssue(
  issueNumber: number,
  updates: Partial<IssueRecord>,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();

  const fields = Object.keys(updates)
    .filter((k) => k !== "issue_number" && k !== "id")
    .map((k) => `${k} = @${k}`)
    .join(", ");

  if (!fields) return;

  conn
    .prepare(`UPDATE issues SET ${fields} WHERE issue_number = @issue_number`)
    .run({
      ...updates,
      issue_number: issueNumber,
    });
}

/**
 * List all issues for a feature.
 */
export function listIssues(
  featureId: string,
  projectId: string,
  db?: Database.Database,
): IssueRecord[] {
  const conn = db ?? getDb();
  return conn
    .prepare(
      "SELECT * FROM issues WHERE feature_id = ? AND project_id = ? ORDER BY created_at DESC",
    )
    .all(featureId, projectId) as IssueRecord[];
}

