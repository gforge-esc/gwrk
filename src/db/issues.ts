/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import type Database from "better-sqlite3";
import { getDb } from "./index.js";
import { firstPerKey, projectScope } from "./project-registry.js";

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

function issueProjectId(
  conn: Database.Database,
  projectId: string,
  issueNumber: number,
): string {
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const row = conn
    .prepare(`
    SELECT project_id FROM issues WHERE issue_number = ? AND project_id IN (${placeholders})
    ORDER BY project_id = ? DESC, project_id LIMIT 1
  `)
    .get(issueNumber, ...ids, canonical) as { project_id: string } | undefined;
  return row?.project_id ?? canonical;
}

/**
 * Upsert an issue by project and issue number.
 */
export function upsertIssue(
  issue: IssueRecord,
  projectId: string,
  db?: Database.Database,
): number {
  const conn = db ?? getDb();
  const result = conn
    .prepare(
      `INSERT INTO issues (
        issue_number, feature_id, title, body, state, html_url, project_id, created_at, closed_at, author
      )
      VALUES (
        @issue_number, @feature_id, @title, @body, @state, @html_url, @project_id, @created_at, @closed_at, @author
      )
      ON CONFLICT(project_id, issue_number) DO UPDATE SET
        feature_id = excluded.feature_id, title = excluded.title, body = excluded.body,
        state = excluded.state, html_url = excluded.html_url, created_at = excluded.created_at,
        closed_at = excluded.closed_at, author = excluded.author
      RETURNING id`,
    )
    .get({
      issue_number: issue.issue_number,
      feature_id: issue.feature_id,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state,
      html_url: issue.html_url ?? null,
      project_id: issueProjectId(conn, projectId, issue.issue_number),
      created_at: issue.created_at,
      closed_at: issue.closed_at ?? null,
      author: issue.author,
    }) as { id: number };
  return result.id;
}

/**
 * Update an existing issue by issue_number and project_id.
 */
export function updateIssue(
  issueNumber: number,
  projectId: string,
  updates: Partial<IssueRecord>,
  db?: Database.Database,
): void {
  const conn = db ?? getDb();

  const fields = Object.keys(updates)
    .filter((k) => k !== "issue_number" && k !== "id" && k !== "project_id")
    .map((k) => `${k} = @${k}`)
    .join(", ");

  if (!fields) return;

  conn
    .prepare(
      `UPDATE issues SET ${fields} WHERE issue_number = @issue_number AND project_id = @project_id`,
    )
    .run({
      ...updates,
      issue_number: issueNumber,
      project_id: issueProjectId(conn, projectId, issueNumber),
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
  const { canonical, ids, placeholders } = projectScope(conn, projectId);
  const rows = conn
    .prepare(`
      SELECT * FROM issues WHERE feature_id = ? AND project_id IN (${placeholders})
      ORDER BY project_id = ? DESC, project_id
    `)
    .all(featureId, ...ids, canonical) as IssueRecord[];
  return firstPerKey(rows, (row) => row.issue_number).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
  );
}
