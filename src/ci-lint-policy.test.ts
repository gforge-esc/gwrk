/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { parse } from "yaml";

const repo = fileURLToPath(new URL("..", import.meta.url));
const workflow = parse(
  readFileSync(join(repo, ".github/workflows/ci.yml"), "utf8"),
);
const job = workflow.jobs.ci;
const lint = job.steps.find((step: { run?: string }) =>
  /^pnpm (?:run )?lint$/.test(step.run ?? ""),
);

it("requires lint failure in both protected CI matrix checks", () => {
  expect(job.strategy.matrix["node-version"]).toEqual([20, 22]);
  expect([undefined, false]).toContain(job["continue-on-error"]);
  expect(job.if).toBeUndefined();
  expect(lint).toBeDefined();
  expect([undefined, false]).toContain(lint["continue-on-error"]);
  expect(lint.if).toBeUndefined();
  expect(
    job.steps.some((step: { run?: string }) => step.run === "pnpm build"),
  ).toBe(true);
  expect(
    job.steps.some(
      (step: { run?: string }) =>
        step.run === "node dist/cli.js define adr --check",
    ),
  ).toBe(true);
});

it("runs the CI lint command against clean and defective tracked source", () => {
  expect(lint).toBeDefined();
  const root = mkdtempSync(join(tmpdir(), "gwrk-ci-lint-"));
  try {
    const manifest = JSON.parse(
      readFileSync(join(repo, "package.json"), "utf8"),
    );
    writeFileSync(
      join(root, "package.json"),
      `${JSON.stringify(
        { private: true, scripts: { lint: manifest.scripts.lint } },
        null,
        2,
      )}\n`,
    );
    copyFileSync(join(repo, "biome.json"), join(root, "biome.json"));
    symlinkSync(join(repo, "node_modules"), join(root, "node_modules"), "dir");
    writeFileSync(
      join(root, ".gitignore"),
      ".gwrkrc.local.json\nnode_modules\n",
    );
    writeFileSync(
      join(root, ".gwrkrc.local.json"),
      "{ invalid ignored machine config",
    );
    mkdirSync(join(root, "src"));
    const source = join(root, "src/value.ts");
    writeFileSync(source, "export const value = 1;\n");
    for (const args of [
      ["init", "-q"],
      ["add", "src/value.ts"],
    ]) {
      const result = spawnSync("git", args, {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
        env: { PATH: process.env.PATH, HOME: tmpdir() },
      });
      expect(result.status, result.stderr).toBe(0);
    }
    const run = () => {
      const result = spawnSync("pnpm", lint.run.split(" ").slice(1), {
        cwd: root,
        encoding: "utf8",
        timeout: 15000,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      return result;
    };
    const clean = run();
    expect(clean.status, clean.stdout + clean.stderr).toBe(0);
    writeFileSync(source, "export  const value=1;\n");
    const defective = run();
    expect(defective.status, defective.stdout + defective.stderr).not.toBe(0);
    expect(defective.stdout + defective.stderr).toContain("src/value.ts");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
