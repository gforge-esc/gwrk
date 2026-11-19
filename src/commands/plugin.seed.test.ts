/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
let root: string;
const cli = resolve("dist/cli.js");
beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), "gwrk-seed-cli-"))); writeFileSync(join(root, ".gwrkrc.json"), JSON.stringify({ project: { id: "seed-fixture", name: "Seed fixture" } })); });
afterEach(() => rmSync(root, { recursive: true, force: true }));
function run(...args: string[]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GWRK_") && !key.startsWith("SLACK_") && !key.startsWith("TELEGRAM")));
  return spawnSync(process.execPath, [cli, "plugin", "seed", ...args], {
    cwd: root, env: { ...env, HOME: root, GWRK_HOME: join(root, ".gwrk"), GWRK_DB_PATH: join(root, "ledger.sqlite") }, encoding: "utf8", timeout: 15000,
  });
}
it("returns one failing signal with the input path and repair hint", () => {
  const result = run("--taxonomy", "missing.md");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(join(root, "missing.md"));
  expect(result.stderr).toContain("--taxonomy");
  expect(result.stderr.match(/\[exit:1 \|/g)).toHaveLength(1);
  expect(existsSync(join(root, ".gwrk/plugins/skills"))).toBe(false);
});
it("resolves relative taxonomy input from the invocation directory in a valid dry run", () => {
  writeFileSync(join(root, "taxonomy.md"), 'Reasoning Modes\n\n1. **Analytical** - Inspect structure.\n    > "ANALYZE THIS"\n');
  const result = run("--taxonomy", "taxonomy.md", "--dry-run");
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("[DRY RUN]");
  expect(result.stdout).toContain("analytical");
  expect(result.stderr.match(/\[exit:0 \|/g)).toHaveLength(1);
  expect(existsSync(join(root, ".gwrk/plugins/skills"))).toBe(false);
});
