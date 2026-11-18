/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let root: string;
const cli = resolve("dist/cli.js");
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-discover-readiness-cli-"));
  writeFileSync(
    join(root, ".gwrkrc.json"),
    JSON.stringify({
      project: {
        name: "readiness-fixture",
        type: "generic",
        design: {
          architecture: "hexagonal-functional",
          principles: ["functional-core"],
          templateVersion: "1.0.0",
        },
      },
    }),
  );
  mkdirSync(join(root, ".gwrk"));
  writeFileSync(
    join(root, ".gwrk/architecture.md"),
    "# Target\nContext only. Code conformance remains unassessed.\n",
  );
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(args: string[]) {
  const env = {
    ...process.env,
    GWRK_HOME: join(root, "home"),
    GWRK_DIR: join(root, "runtime"),
    GWRK_DB_PATH: join(root, "must-not-create.db"),
  };
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 20_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stderr.match(/\[exit:0 \| [\d.]+(?:ms|s)\]/g)).toHaveLength(1);
  expect(existsSync(env.GWRK_DB_PATH)).toBe(false);
  return result.stdout;
}
describe("architecture readiness discovery CLI", () => {
  it.each([
    { args: ["project", "discover", "--format", "json"] },
    { args: ["--format", "json", "project", "discover"] },
    { args: ["--agent", "project", "discover", "--format", "json"] },
  ])("reports additive JSON evidence with %j", ({ args }) => {
    const result = JSON.parse(run(args));
    expect(result.project.name).toBe("readiness-fixture");
    expect(result.architectureReadiness).toMatchObject({
      target: {
        selection: { architecture: "hexagonal-functional" },
        path: ".gwrk/architecture.md",
      },
      context: {
        status: "incomplete",
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ".gwrk/context-manifest.json",
            kind: "missing",
          }),
        ]),
      },
      assessment: { latest: null },
    });
  });
  it("names context issues and missing assessment without a conformance claim", () => {
    const text = run(["project", "discover"]);
    expect(text).toContain("Architecture target: hexagonal-functional");
    expect(text).toContain("Code conformance: unassessed");
    expect(text).toContain(".gwrk/context-manifest.json: missing");
    expect(text).toContain("gwrk init");
    expect(text).toContain("gwrk assess");
  });
});
