/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Backend selection lives in one function, and this test keeps it there.
 *
 * The duplicated form was `loadConfig(x)` then `config.agents.define` then
 * `resolveModelForTask(...)`, repeated at nine sites, and it drifted at every
 * one. `define ontology` skipped the config read entirely, so a project
 * configured for claude dispatched to the hardcoded "agy" in `agent.ts`.
 * `implement` and `ship` honoured `--agent`; six define commands ignored it.
 * `adr` passed `cwd` where `loadConfig` needed the project root.
 *
 * Every one of those was found by a user hitting it in a real project. A grep
 * that fails the build is cheaper than the next report.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** Deriving a pillar backend from config. The thing that must be centralized. */
const PILLAR_ACCESS = /config\.agents\.(define|implement)\b/;

/**
 * Files allowed to touch `agents.define` / `agents.implement` directly, and why.
 * Add an entry only for a file that manages the config block itself, never for a
 * command that dispatches work.
 */
const ALLOWED = new Map<string, string>([
  ["src/utils/resolve-agent.ts", "the resolver itself"],
  ["src/commands/init.ts", "writes the agents block"],
  ["src/commands/status.ts", "displays the agents block"],
]);

const SRC = path.join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "builtins") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".d.ts")) continue;
    out.push(full);
  }
  return out;
}

describe("config resolution is centralized", () => {
  it("no dispatching command derives a pillar backend from config itself", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = path.relative(process.cwd(), file);
      if (ALLOWED.has(rel)) continue;
      const body = fs.readFileSync(file, "utf-8");
      const line = body
        .split("\n")
        .findIndex((l) => PILLAR_ACCESS.test(l) && !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//"));
      if (line !== -1) offenders.push(`${rel}:${line + 1}`);
    }

    expect(
      offenders,
      `Use resolveAgent(pillar, projectRoot, { agent, model }) from src/utils/resolve-agent.ts instead of reading config.agents.<pillar>:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every allowlisted file still exists", () => {
    // A stale allowlist entry hides a real offender behind a deleted path.
    const missing = [...ALLOWED.keys()].filter(
      (rel) => !fs.existsSync(path.join(process.cwd(), rel)),
    );

    expect(missing).toEqual([]);
  });
});
