/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

const schemaDocument = new URL(
  "../../specs/049-durable-dispatch-harvest/data-model.md",
  import.meta.url,
);
const now = "2026-11-11T12:00:00.000Z";
const slackRoute = JSON.stringify({
  projectId: "project-a",
  surface: "slack",
  workspaceId: "W1",
  channelId: "C2",
  threadTs: "2.1",
});

it("preserves ordered delivery scopes, replay identity and aliases after reopening SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "gwrk-harvest-schema-"));
  const ledgerPath = join(directory, "ledger.sqlite");
  const db = new Database(ledgerPath);
  try {
    db.pragma("foreign_keys = ON");
    db.exec(
      "CREATE TABLE projects(id TEXT PRIMARY KEY); CREATE TABLE runs(id INTEGER PRIMARY KEY);",
    );
    const schema = /\x60\x60\x60sql\n([\s\S]*?)\n\x60\x60\x60/.exec(
      readFileSync(schemaDocument, "utf-8"),
    )?.[1];
    if (!schema) throw new Error("Missing published SQLite schema");
    db.exec(schema);
    db.exec("INSERT INTO projects VALUES ('project-a'), ('project-b')");
    const operation = db.prepare(`
      INSERT INTO harvest_operations (
        operation_id, project_id, work_key, repo_slug, head_repo_slug,
        trunk_branch, feature_id, phase_id, pr_number, terminal_event,
        terminal_at, status, created_at, updated_at
      ) VALUES (?, ?, ?, 'acme/a', 'acme/a', 'develop', '049-example', ?, 42, 'merged',
                ?, 'pending', ?, ?)
    `);
    const delivery = db.prepare(`
      INSERT INTO harvest_deliveries (
        source, delivery_id, project_id, repo_slug, payload_digest, event_type,
        outcome, received_at
      ) VALUES ('github_webhook', ?, 'project-a', 'acme/a', 'digest-a', 'merged',
                'accepted', ?)
    `);
    const link = db.prepare(`
      INSERT INTO harvest_delivery_operations (source, delivery_id, project_id, position, operation_id)
      VALUES ('github_webhook', ?, 'project-a', ?, ?)
    `);
    const alias = db.prepare(`
      INSERT INTO harvest_work_key_aliases (project_id, work_key, operation_id)
      VALUES (?, ?, ?)
    `);
    db.transaction(() => {
      operation.run("op-1", "project-a", "pull-1", "phase-01", now, now, now);
      operation.run("op-2", "project-a", "pull-2", "phase-02", now, now, now);
      operation.run(
        "foreign",
        "project-b",
        "pull-2",
        "phase-02",
        now,
        now,
        now,
      );
      delivery.run("delivery-42", now);
      link.run("delivery-42", 1, "op-1");
      link.run("delivery-42", 0, "op-2");
      alias.run("project-a", "local-2", "op-2");
      db.prepare(
        "UPDATE harvest_operations SET planned_slack_recipient_json = ? WHERE operation_id = ?",
      ).run(slackRoute, "op-2");
    }).immediate();
    expect(() =>
      db
        .transaction(() => {
          delivery.run("invalid-delivery", now);
          link.run("invalid-delivery", 0, "foreign");
        })
        .immediate(),
    ).toThrow(/foreign key/i);
    expect(() => alias.run("project-a", "foreign", "foreign")).toThrow(
      /foreign key/i,
    );
    db.close();

    const reopened = new Database(ledgerPath);
    try {
      const replay = reopened
        .prepare(`
        SELECT operation_id FROM harvest_deliveries
        JOIN harvest_delivery_operations USING (source, delivery_id, project_id)
        WHERE source = ? AND delivery_id = ? AND repo_slug = ? AND payload_digest = ?
        ORDER BY position
      `)
        .pluck();
      expect(
        replay.all("github_webhook", "delivery-42", "acme/a", "digest-a"),
      ).toEqual(["op-2", "op-1"]);
      expect(
        replay.all("github_webhook", "delivery-42", "acme/a", "other-digest"),
      ).toEqual([]);
      expect(
        replay.all("github_webhook", "delivery-42", "other/repo", "digest-a"),
      ).toEqual([]);
      expect(
        reopened
          .prepare("SELECT delivery_id FROM harvest_deliveries")
          .pluck()
          .all(),
      ).toEqual(["delivery-42"]);
      const workAlias = reopened
        .prepare(`
        SELECT operation_id FROM harvest_work_key_aliases WHERE project_id = ? AND work_key = ?
      `)
        .pluck();
      expect(workAlias.get("project-a", "local-2")).toBe("op-2");
      expect(workAlias.get("project-b", "local-2")).toBeUndefined();
      const savedSlackRoute = reopened
        .prepare(
          "SELECT planned_slack_recipient_json FROM harvest_operations WHERE operation_id = ?",
        )
        .pluck();
      expect(savedSlackRoute.get("op-2")).toBe(slackRoute);
      expect(savedSlackRoute.get("op-1")).toBeNull();
    } finally {
      reopened.close();
    }
  } finally {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
