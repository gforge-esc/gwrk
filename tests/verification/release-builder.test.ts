/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("production release build preflight", () => {
  it("preserves native data and budget exclusion while supervising descendant timeouts", () => {
    const result = spawnSync(
      "python3",
      ["tests/verification/native-lifecycle.test.py"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
  it("preserves supervisor ownership, leases, retention receipts and filesystem budgets", () => {
    const result = spawnSync(
      "python3",
      ["tests/verification/release-build-guard.test.py"],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });
  it("stops the actual builder before archive, dependency install or compilation on low space", () => {
    const root = realpathSync(
      mkdtempSync(join(tmpdir(), "gwrk-release-guard-test-")),
    );
    try {
      const bin = join(root, "bin");
      mkdirSync(bin);
      const log = join(root, "commands");
      for (const command of ["git", "pnpm", "npm", "tar"]) {
        writeFileSync(
          join(bin, command),
          '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$BUILD_COMMAND_LOG"\nexit 1\n',
          { mode: 0o755 },
        );
      }
      const result = spawnSync(
        process.execPath,
        [
          resolve("scripts/release/build-linux-release.mjs"),
          join(root, "output"),
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            BUILD_COMMAND_LOG: log,
            GWRK_RELEASE_BUILDS_ROOT: join(root, "runs"),
            GWRK_RELEASE_CACHE: join(root, "cache"),
            GWRK_RELEASE_WORKSPACE_BYTES: "9007199254740991",
          },
        },
      );
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/Insufficient disk space/);
      expect(existsSync(log)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("has no candidate dependency in the supervisor", () => {
    const script = readFileSync("scripts/release/build-preflight.py", "utf8");
    expect(script).not.toMatch(/node_modules|dist\//);
  });
});
