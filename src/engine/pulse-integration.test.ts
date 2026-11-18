/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// src/engine/pulse-integration.test.ts
// Integration tests for 006-pulse
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPulseGitFixture,
  stubPulseGitEnv,
} from "../../tests/helpers/pulse-git-fixture.js";
import { scanRepository } from "./pulse.js";
import { PulseSnapshotSchema } from "./types.js";

describe("TR-007: Integration test — real git repo", () => {
  let fixture: Awaited<ReturnType<typeof createPulseGitFixture>>;

  beforeAll(async () => {
    fixture = await createPulseGitFixture("branches");
    stubPulseGitEnv(fixture.env);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fixture?.cleanup();
  });

  it("VR-001: scans real repo and produces valid PulseSnapshot", () => {
    const snapshot = scanRepository(fixture.repoDir);
    expect(() => PulseSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.repoPath).toBe(fixture.repoDir);
    expect(snapshot.defaultBranch).toBe("main");
    expect(snapshot.mainLoc).toBe(5);
    expect(snapshot.draftLoc).toBe(2);
    expect(snapshot.weeklyBuckets).toEqual([
      {
        weekStart: "2026-01-05T00:00:00.000Z",
        totalMain: 2,
        totalDrafts: 0,
        added: 2,
        deleted: 0,
      },
      {
        weekStart: "2026-01-12T00:00:00.000Z",
        totalMain: 5,
        totalDrafts: 0,
        added: 3,
        deleted: 0,
      },
      {
        weekStart: "2026-01-19T00:00:00.000Z",
        totalMain: 5,
        totalDrafts: 2,
        added: 4,
        deleted: 2,
      },
    ]);
  });

  it("VR-004: determinism — two scans produce identical output", () => {
    const snapshot1 = scanRepository(fixture.repoDir);
    const snapshot2 = scanRepository(fixture.repoDir);
    const withoutTimestamp = (s: ReturnType<typeof scanRepository>) => {
      const { scannedAt, ...rest } = s;
      return rest;
    };
    expect(withoutTimestamp(snapshot1)).toEqual(withoutTimestamp(snapshot2));
  });

  describe("FR-002: Error handling for invalid paths", () => {
    it("VR-002: throws for non-git-repo path", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "not-a-repo-"));
      try {
        expect(() => scanRepository(tempDir)).toThrow(/Not a git repository/);
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("FR-002 error state: throws for non-existent path", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-missing-"));
      try {
        expect(() => scanRepository(path.join(tempDir, "missing"))).toThrow(
          /Path not found/,
        );
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});

describe("Pulse scan scale", () => {
  let fixture: Awaited<ReturnType<typeof createPulseGitFixture>>;

  beforeAll(async () => {
    fixture = await createPulseGitFixture("scale");
    stubPulseGitEnv(fixture.env);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fixture?.cleanup();
  });

  it("scans 100 commits", () => {
    const snapshot = scanRepository(fixture.repoDir);
    expect(snapshot.mainLoc).toBe(100);
    expect(snapshot.weeklyBuckets).toEqual([
      {
        weekStart: "2026-01-05T00:00:00.000Z",
        totalMain: 100,
        totalDrafts: 0,
        added: 100,
        deleted: 0,
      },
    ]);
  });
});
