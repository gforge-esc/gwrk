/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";
import { expect, it } from "vitest";

const repo = fileURLToPath(new URL("..", import.meta.url));
const vitest = join(repo, "node_modules/vitest/vitest.mjs");
const formerQuarantine = [
  "src/server/e2e.test.ts",
  "src/server/integration.test.ts",
  "src/server/routes/dispatch.test.ts",
  "src/server/routes/notify.test.ts",
  "src/cli.pulse.e2e.test.ts",
  "src/engine/pulse-integration.test.ts",
];

function runVitest(root: string, args: string[], legacyFlag: boolean) {
  const env = {
    ...process.env,
    CI: "true",
    FORCE_COLOR: "1",
    NO_COLOR: undefined,
    GWRK_SKIP_INTEGRATION: legacyFlag ? "1" : undefined,
  };
  const result = spawnSync(
    process.execPath,
    [
      vitest,
      ...args,
      "--root",
      root,
      "--config",
      join(repo, "vitest.config.ts"),
    ],
    { cwd: root, env, encoding: "utf8", timeout: 15_000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return {
    status: result.status,
    output: stripVTControlCharacters(result.stdout + result.stderr),
  };
}

it.each([false, true])(
  "discovers every former quarantine path with legacy flag set to %s",
  (legacyFlag) => {
    const root = mkdtempSync(join(tmpdir(), "gwrk-test-selection-"));
    try {
      for (const file of formerQuarantine) {
        const fixture = join(root, file);
        mkdirSync(dirname(fixture), { recursive: true });
        writeFileSync(
          fixture,
          "test('fixture', () => expect(true).toBe(true));",
        );
      }
      const result = runVitest(root, ["list", "--filesOnly"], legacyFlag);
      expect(result.status, result.output).toBe(0);
      for (const file of formerQuarantine) {
        expect.soft(result.output).toContain(file);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

it("fails the CI command when a passing test has an unhandled rejection", () => {
  const root = mkdtempSync(join(tmpdir(), "gwrk-test-worker-"));
  try {
    const fixture = join(root, "probe.test.ts");
    const args = ["run", "probe.test.ts", "--globals", "--maxWorkers", "1"];
    writeFileSync(fixture, "test('fixture', () => expect(true).toBe(true));");
    const control = runVitest(root, args, true);
    expect(control.status, control.output).toBe(0);

    writeFileSync(
      fixture,
      `test("fixture", async () => {
        setTimeout(() => Promise.reject(new Error("fixture-worker-rejection")), 0);
        await new Promise(resolve => setTimeout(resolve, 25));
        expect(true).toBe(true);
      });`,
    );
    const result = runVitest(root, args, true);
    expect(result.output).toContain("fixture-worker-rejection");
    expect(result.output).toMatch(/Tests\s+1 passed/);
    expect(result.status, result.output).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
