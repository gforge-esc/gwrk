/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { persistDispatch } from "./persistence.js";
import type { DispatchRecord } from "./types.js";

describe("persistDispatch (T032)", () => {
  let tmpBase: string;
  let alphaRoot: string;
  let betaRoot: string;

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-persist-test-"));
    alphaRoot = path.join(tmpBase, "alpha");
    betaRoot = path.join(tmpBase, "beta");
    fs.mkdirSync(alphaRoot, { recursive: true });
    fs.mkdirSync(betaRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it("writes snapshot to record.projectRoot/.gwrk/dispatches.jsonl when no explicit projectRoot is passed", () => {
    const record: DispatchRecord = {
      id: "dispatch-alpha-1",
      projectId: "proj-alpha",
      featureId: "048-shared",
      phaseId: "phase-01",
      backend: "claude",
      status: "queued",
      branchName: "feat/048-shared-phase-01",
      projectRoot: alphaRoot,
      trunkBranch: "main",
      recipient: {
        projectId: "proj-alpha",
        surface: "slack",
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        threadTs: "1700000001.000100",
        actorUserId: "U-ALPHA",
      },
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T12:00:00.000Z",
    };

    persistDispatch(record);

    const alphaFile = path.join(alphaRoot, ".gwrk", "dispatches.jsonl");
    expect(fs.existsSync(alphaFile)).toBe(true);

    const lines = fs
      .readFileSync(alphaFile, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as DispatchRecord);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      id: "dispatch-alpha-1",
      projectId: "proj-alpha",
      projectRoot: alphaRoot,
      trunkBranch: "main",
      recipient: {
        projectId: "proj-alpha",
        surface: "slack",
        workspaceId: "W-ALPHA",
        channelId: "C-ALPHA",
        threadTs: "1700000001.000100",
        actorUserId: "U-ALPHA",
      },
    });
  });

  it("isolates persisted snapshots between separate project roots", () => {
    const alphaRecord: DispatchRecord = {
      id: "dispatch-alpha",
      projectId: "proj-alpha",
      featureId: "001-common",
      phaseId: "phase-01",
      backend: "claude",
      status: "running",
      branchName: "feat/001-common-phase-01",
      projectRoot: alphaRoot,
      trunkBranch: "main",
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T12:00:00.000Z",
    };
    const betaRecord: DispatchRecord = {
      id: "dispatch-beta",
      projectId: "proj-beta",
      featureId: "001-common",
      phaseId: "phase-01",
      backend: "agy",
      status: "completed",
      branchName: "feat/001-common-phase-01",
      projectRoot: betaRoot,
      trunkBranch: "release",
      recipient: {
        projectId: "proj-beta",
        surface: "slack",
        workspaceId: "W-BETA",
        channelId: "C-BETA",
      },
      attempts: [],
      tasks: [],
      createdAt: "2026-11-18T12:01:00.000Z",
    };

    persistDispatch(alphaRecord);
    persistDispatch(betaRecord);

    const alphaLines = fs
      .readFileSync(path.join(alphaRoot, ".gwrk", "dispatches.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as DispatchRecord);
    const betaLines = fs
      .readFileSync(path.join(betaRoot, ".gwrk", "dispatches.jsonl"), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as DispatchRecord);

    expect(alphaLines).toHaveLength(1);
    expect(alphaLines[0].projectId).toBe("proj-alpha");
    expect(alphaLines[0].trunkBranch).toBe("main");

    expect(betaLines).toHaveLength(1);
    expect(betaLines[0].projectId).toBe("proj-beta");
    expect(betaLines[0].trunkBranch).toBe("release");
    expect(betaLines[0].recipient?.channelId).toBe("C-BETA");
  });
});
