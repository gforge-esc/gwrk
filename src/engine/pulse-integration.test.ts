import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
// src/engine/pulse-integration.test.ts
// Integration tests for 006-pulse
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanRepository } from "./pulse.js";
import { PulseSnapshotSchema } from "./types.js";

describe("TR-007: Integration test — real git repo", () => {
  let repoDir: string;

  beforeAll(() => {
    // Create a real temp git repo with commits across 3 weeks
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-integration-"));

    execSync("git init", { cwd: repoDir });
    execSync('git config user.email "test@test.com"', { cwd: repoDir });
    execSync('git config user.name "Test"', { cwd: repoDir });

    // Week 1: Jan 6, 2026 (Monday)
    fs.writeFileSync(
      path.join(repoDir, "file1.ts"),
      'export const a = "hello";\nexport const b = "world";\n',
    );
    execSync("git add -A", { cwd: repoDir });
    execSync(
      'GIT_AUTHOR_DATE="2026-01-06T10:00:00Z" GIT_COMMITTER_DATE="2026-01-06T10:00:00Z" git commit -m "week 1: initial"',
      { cwd: repoDir, shell: "/bin/bash" },
    );

    // Week 2: Jan 13, 2026 (Monday)
    fs.writeFileSync(
      path.join(repoDir, "file2.ts"),
      'export const c = "foo";\nexport const d = "bar";\nexport const e = "baz";\n',
    );
    execSync("git add -A", { cwd: repoDir });
    execSync(
      'GIT_AUTHOR_DATE="2026-01-13T10:00:00Z" GIT_COMMITTER_DATE="2026-01-13T10:00:00Z" git commit -m "week 2: add file2"',
      { cwd: repoDir, shell: "/bin/bash" },
    );

    // Week 3: Jan 20, 2026 (Monday)
    fs.writeFileSync(
      path.join(repoDir, "file3.ts"),
      'export const f = "qux";\n',
    );
    // Also modify file1 to test add/delete tracking
    fs.writeFileSync(
      path.join(repoDir, "file1.ts"),
      'export const a = "hello updated";\n',
    );
    execSync("git add -A", { cwd: repoDir });
    execSync(
      'GIT_AUTHOR_DATE="2026-01-20T10:00:00Z" GIT_COMMITTER_DATE="2026-01-20T10:00:00Z" git commit -m "week 3: add file3, modify file1"',
      { cwd: repoDir, shell: "/bin/bash" },
    );

    // Create a feature branch with draft work
    execSync("git checkout -b feature/draft", { cwd: repoDir });
    fs.writeFileSync(
      path.join(repoDir, "draft.ts"),
      'export const draft = "wip";\nexport const draft2 = "wip2";\n',
    );
    execSync("git add -A", { cwd: repoDir });
    execSync(
      'GIT_AUTHOR_DATE="2026-01-21T10:00:00Z" GIT_COMMITTER_DATE="2026-01-21T10:00:00Z" git commit -m "draft: wip"',
      { cwd: repoDir, shell: "/bin/bash" },
    );

    // Return to main
    execSync("git checkout main", { cwd: repoDir });
  });

  afterAll(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it("VR-001: scans real repo and produces valid PulseSnapshot", () => {
    const snapshot = scanRepository(repoDir);
    expect(() => PulseSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.repoPath).toBe(repoDir);
    expect(snapshot.defaultBranch).toBe("main");
  });

  it("VR-004: determinism — two scans produce identical output", () => {
    const snapshot1 = scanRepository(repoDir);
    const snapshot2 = scanRepository(repoDir);
    const withoutTimestamp = (s: any) => {
      const { scannedAt, ...rest } = s;
      return rest;
    };
    expect(withoutTimestamp(snapshot1)).toEqual(withoutTimestamp(snapshot2));
  });
});

describe("Performance & Scale", () => {
  it("US-007: Performance benchmark — 100 commits", () => {
    const perfRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-perf-"));
    execSync("git init", { cwd: perfRepoDir });
    execSync('git config user.email "perf@test.com"', { cwd: perfRepoDir });
    execSync('git config user.name "Perf Test"', { cwd: perfRepoDir });

    // Create 100 small commits using a bash loop for speed
    execSync(`
      for i in {1..100}; do
        echo "line $i" > "file$i.ts"
        git add "file$i.ts"
        git commit -m "feat: commit $i" --quiet
      done
    `, { cwd: perfRepoDir, shell: "/bin/bash" });

    const start = performance.now();
    const snapshot = scanRepository(perfRepoDir);
    const end = performance.now();
    const duration = end - start;

    expect(snapshot.mainLoc).toBeGreaterThanOrEqual(100);
    expect(snapshot.weeklyBuckets.length).toBeGreaterThan(0);
    
    // Efficiency check: 100 commits should be very fast (< 1 second)
    expect(duration).toBeLessThan(1000);

    fs.rmSync(perfRepoDir, { recursive: true, force: true });
  }, 60000); // 60s timeout for repo creation
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
    expect(() => scanRepository("/tmp/path-does-not-exist-xyz")).toThrow(
      /Path not found/,
    );
  });
});

