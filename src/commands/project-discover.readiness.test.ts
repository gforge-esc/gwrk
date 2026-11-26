/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const project = { name: "readiness-fixture", type: "generic" };
const targetPath = ".gwrk/architecture.md";
const target = "# Target\nContext only. Code conformance remains unassessed.\n";
const jsonInvocations = [
  { args: ["project", "discover", "--format", "json"] },
  { args: ["--format", "json", "project", "discover"] },
  { args: ["--agent", "project", "discover", "--format", "json"] },
];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-discover-readiness-cli-"));
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
  expect(result.stderr.match(/\[exit:\d+ \| [\d.]+(?:ms|s)\]/g)).toHaveLength(1);
  expect(result.stderr.trimEnd()).toMatch(/\[exit:0 \| [\d.]+(?:ms|s)\]$/);
  expect(existsSync(env.GWRK_DB_PATH)).toBe(false);
  return result.stdout;
}
describe("project discovery with architecture evidence", () => {
  beforeEach(() => {
    writeFileSync(
      join(root, ".gwrkrc.json"),
      JSON.stringify({
        project: {
          ...project,
          design: {
            architecture: "hexagonal-functional",
            principles: ["functional-core"],
            templateVersion: "1.0.0",
          },
        },
      }),
    );
    mkdirSync(join(root, ".gwrk"));
    writeFileSync(join(root, targetPath), target);
  });

  it.each(jsonInvocations)("reports additive JSON evidence with %j", ({ args }) => {
    const result = JSON.parse(run(args));
    expect(result.project.name).toBe(project.name);
    expect(result.architecture).toMatchObject({
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

  it("suppresses the init hint when the manifest is invalid and the decision index is missing", () => {
    writeFileSync(
      join(root, ".gwrk/context-manifest.json"),
      JSON.stringify({
        version: 1,
        files: { [targetPath]: createHash("sha256").update(target).digest("hex") },
      }),
    );

    const text = run(["project", "discover"]);
    expect(text).toContain(".gwrk/context-manifest.json: invalid");
    expect(text).toContain(".gwrk/decisions/index.md: missing");
    expect(text).not.toContain("gwrk init");
  });

  it.each([".gwrk/context-manifest.json", ".gwrk/architecture.md", ".gwrk/decisions/index.md"])("suppresses the init hint when managed input %s is unreadable", (input) => {
    const file = join(root, input);
    rmSync(file, { force: true });
    mkdirSync(file, { recursive: true });
    const text = run(["project", "discover"]);
    expect(text).toContain(`${input}: unreadable`);
    expect(text).not.toContain("gwrk init");
  });

  it("reports assessment scope alongside incomplete context in text and JSON", () => {
    const archive = "docs/architecture/assessments/2026-11-18";
    const reportPath = `${archive}/report.md`;
    const scope = {
      inspected: ["src/domain"],
      limitations: ["Adapters unreviewed"],
    };
    mkdirSync(join(root, archive), { recursive: true });
    writeFileSync(join(root, reportPath), "# Scoped assessment\n");
    writeFileSync(
      join(root, archive, "assessment.json"),
      JSON.stringify({
        overview: "Scoped assessment",
        ...scope,
        findings: [],
        features: [],
        reconciliation: [],
      }),
    );

    const text = run(["project", "discover"]);
    expect(text).toContain("Architecture context: incomplete");
    expect(text).toContain(`Latest assessment: ${reportPath}`);
    expect(text).toContain("Assessment inspected: src/domain");
    expect(text).toContain("Assessment limitations: Adapters unreviewed");
    expect(text).not.toContain("Run gwrk assess");

    const result = JSON.parse(run(["project", "discover", "--format", "json"]));
    expect(result.architecture).toMatchObject({
      context: { status: "incomplete" },
      assessment: { latest: { reportPath, scope } },
    });
  });
});

describe("project discovery with only project config", () => {
  beforeEach(() => {
    writeFileSync(join(root, ".gwrkrc.json"), JSON.stringify({ project }));
  });

  it("shows guidance for missing context and assessment", () => {
    const text = run(["project", "discover"]);
    expect(text).toContain("gwrk init");
    expect(text).toContain("gwrk assess");
  });

  it.each(jsonInvocations)("omits architecture from JSON with %j", ({ args }) => {
    const result = JSON.parse(run(args));
    expect(result.project.name).toBe(project.name);
    expect(result).not.toHaveProperty("architecture");
  });
});
