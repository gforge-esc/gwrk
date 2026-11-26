/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const feature = process.env.GWRK_GATE_REVIEW_SOURCE
  ? path.resolve(process.env.GWRK_GATE_REVIEW_SOURCE)
  : path.resolve("specs/051-hosted-aws-pilot");
const plan = fs.readFileSync(path.join(feature, "plan.md"), "utf8");

function approvedCommands(phase) {
  const heading = new RegExp(`^### Phase ${phase}:`, "m").exec(plan);
  assert.ok(heading, `Approved plan must define phase ${phase}`);
  const rest = plan.slice(heading.index + heading[0].length);
  const nextHeading = /^### Phase \d+:|^## Coverage Matrix/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  const done = /#### Done When\s+```bash\s*([\s\S]*?)```/.exec(section);
  assert.ok(done, `Phase ${phase} must declare executable acceptance commands`);
  return done[1]
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function vitestTargets(commands) {
  const selected = commands.filter((line) =>
    line.startsWith("pnpm exec vitest run "),
  );
  assert.equal(
    selected.length,
    1,
    "Derive targets from one approved Vitest command",
  );
  const targets = selected[0].split(/\s+/).slice(4);
  assert.ok(targets.length > 0);
  assert.ok(
    targets.every((target) => /^(src|tests)\/[\w./-]+\.test\.ts$/.test(target)),
  );
  return targets;
}

function explicitRequiredFiles(gate) {
  const files = [];
  for (const match of gate.matchAll(/\[\[\s*!\s*-f\s+([\w./-]+)\s*\]\]/g)) {
    files.push(match[1]);
  }
  for (const match of gate.matchAll(
    /(?:required_targets|vitest_targets)=\(([\s\S]*?)\)/g,
  )) {
    files.push(...(match[1].match(/(?:src|tests|dist)\/[\w./-]+/g) ?? []));
  }
  return files;
}

function runFixture(phase, commands, omitted, authority) {
  const gate = fs.readFileSync(
    path.join(feature, "gates", `phase-${String(phase).padStart(2, "0")}.sh`),
    "utf8",
  );
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "gwrk-authored-gate-"),
  );
  try {
    const nodeFiles = commands
      .filter((line) => line.startsWith("node "))
      .map((line) => line.split(/\s+/)[1]);
    const selected = phase === 9 ? [] : vitestTargets(commands);
    const files = new Set([
      ...selected,
      ...nodeFiles,
      ...explicitRequiredFiles(gate),
    ]);
    for (const name of files) {
      const destination = path.join(directory, name);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(
        destination,
        "// Synthetic fixture; child commands are intercepted.\n",
      );
    }
    if (omitted) fs.rmSync(path.join(directory, omitted));
    const bin = path.join(directory, "bin");
    const log = path.join(directory, "children.jsonl");
    fs.mkdirSync(bin);
    const stub = `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
fs.appendFileSync(process.env.GWRK_GATE_CHILD_LOG, JSON.stringify({command: path.basename(process.argv[1]), args: process.argv.slice(2)}) + "\\n");
`;
    for (const name of ["pnpm", "node"])
      fs.writeFileSync(path.join(bin, name), stub, { mode: 0o755 });
    const script = path.join(directory, "phase.sh");
    fs.writeFileSync(script, gate);
    const env = {
      PATH: `${bin}:/usr/bin:/bin`,
      LANG: "C",
      GWRK_GATE_CHILD_LOG: log,
    };
    if (authority !== undefined) env.GWRK_OPERATOR_LIVE_ACCEPTANCE = authority;
    const result = spawnSync("/bin/bash", [script], {
      cwd: directory,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(
      typeof result.status,
      "number",
      "The gate must complete with an exit status",
    );
    const children = fs.existsSync(log)
      ? fs
          .readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    return { ...result, children };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

for (let phase = 2; phase <= 8; phase++) {
  const commands = approvedCommands(phase);
  for (const omitted of vitestTargets(commands)) {
    test(`phase ${phase} denies missing ${omitted} before any child executes`, () => {
      const result = runFixture(phase, commands, omitted);
      assert.notEqual(
        result.status,
        0,
        `Missing ${omitted} must fail before behavioral commands`,
      );
      assert.deepEqual(
        result.children,
        [],
        "Missing coverage must deny build and all behavioral children",
      );
    });
  }
  test(`phase ${phase} complete fixtures execute the approved behavioral commands`, () => {
    const result = runFixture(phase, commands);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(
      result.children,
      commands.map((line) => {
        const [command, ...args] = line.split(/\s+/);
        return { command, args };
      }),
    );
  });
}

test("phase 9 denies absent operator authority before any child executes", () => {
  const result = runFixture(9, approvedCommands(9));
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /live acceptance requires the authorized coordinator/,
  );
  assert.deepEqual(result.children, []);
});

for (const phase of [7, 8]) {
  test(`phase ${phase} portable gate verifies evidence without directly launching legacy Docker proof`, () => {
    const commands = approvedCommands(phase);
    const result = runFixture(phase, commands);
    assert.equal(result.status, 0, result.stderr);
    const invokedLegacyDirectly = result.children.some(
      (child) =>
        child.command === "node" &&
        child.args[0] === "tests/hosted-auth-proof/gateway-proof.mjs",
    );
    assert.equal(
      invokedLegacyDirectly,
      false,
      `phase ${phase} portable gate must not directly start legacy Docker proof`,
    );
    const invokedPortableVerifier = result.children.some(
      (child) =>
        child.command === "node" &&
        child.args[0] === "tests/hosted-pilot/gateway-production.mjs",
    );
    assert.equal(
      invokedPortableVerifier,
      true,
      `phase ${phase} portable gate must invoke gateway-production.mjs`,
    );
    const vitestCommand = result.children.find(
      (child) =>
        child.command === "pnpm" &&
        child.args[0] === "exec" &&
        child.args[1] === "vitest",
    );
    assert.ok(
      vitestCommand?.args.includes(
        "tests/hosted-pilot/native-evidence.test.ts",
      ),
      `phase ${phase} portable gate must run native-evidence.test.ts negative controls`,
    );
  });

  test(`phase ${phase} denies missing unchanged legacy proof target before any child executes`, () => {
    const commands = approvedCommands(phase);
    const result = runFixture(
      phase,
      commands,
      "tests/hosted-auth-proof/gateway-proof.mjs",
    );
    assert.notEqual(
      result.status,
      0,
      `phase ${phase} must keep tests/hosted-auth-proof/gateway-proof.mjs in required_targets`,
    );
    assert.deepEqual(
      result.children,
      [],
      "missing legacy target must fail before any child runs",
    );
  });
}

test("all nine Phase 7 task gates delegate to phase-07.sh", () => {
  for (let taskNum = 36; taskNum <= 44; taskNum++) {
    const gatePath = path.join(
      feature,
      "gates",
      `T${String(taskNum).padStart(3, "0")}-gate.sh`,
    );
    assert.equal(
      fs.existsSync(gatePath),
      true,
      `Missing Phase 7 task delegate ${gatePath}`,
    );
    const content = fs.readFileSync(gatePath, "utf8");
    assert.match(
      content,
      /exec bash "\$\{gate_dir\}\/phase-07\.sh"/,
      `${gatePath} must delegate to phase-07.sh`,
    );
  }
});
