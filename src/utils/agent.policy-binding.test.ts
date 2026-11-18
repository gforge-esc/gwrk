/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installArchitectureContext } from "../adapters/architecture/context-files.js";
import { resolveDesign } from "../domain/architecture-context.js";
import type { ProjectProfile } from "../domain/types.js";
import { dispatchToAgent } from "./agent.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-policy-binding-"));
  writeFileSync(join(root, ".gwrkrc.json"), JSON.stringify({ project: { name: "binding-fixture", type: "nodejs", stack: { language: "TypeScript", framework: "Fastify" } } }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function prompt(workflow: string, profile: ProjectProfile) {
  const template = "Trusted workflow\n<code_quality>\n{{enforcement}}\n</code_quality>";
  const task = { workflow, profile, type: workflow.includes("review") ? "review" : "workflow", workDir: root, stdin: template, promptParts: { template, userInput: "<user_input>Keep task text</user_input>" }, dryRun: true, quiet: true };
  return (await dispatchToAgent(task)).stdout;
}
describe("shared effective policy dispatch", () => {
  it.each(["gwrk-spec", "gwrk-implement", "review-code-cli"])(
    "binds the selected workspace profile once in %s without launching an agent",
    async (workflow) => {
      const rendered = await prompt(workflow, { type: "python", stack: { language: "Python", framework: "FastAPI" }, design: resolveDesign({ architecture: "hexagonal-functional" }) });
      expect(rendered.match(/<effective_policy>/g)).toHaveLength(1);
      expect(rendered).toContain("Domain policy MUST depend inward");
      expect(rendered).toContain("typing.Protocol");
      expect(rendered).toContain("FastAPI routers");
      expect(rendered).not.toContain("Fastify routes");
      expect(rendered).not.toContain("TypeScript Standards");
      expect(rendered).toContain("Initialization does not assess code conformance");
      expect(rendered).toContain("<user_input>Keep task text</user_input>");
    },
  );
  it("reports incompatible framework guidance without injecting its binding", async () => {
    const rendered = await prompt("gwrk-spec", { type: "nodejs", stack: { language: "TypeScript", framework: "Django" }, design: resolveDesign({ architecture: "hexagonal-functional" }) });
    expect(rendered).toContain("## Policy gaps");
    expect(rendered).toContain("No compatible policy found for framework Django");
    expect(rendered).not.toContain("Keep Django ORM models");
  });
});

it("refreshes dynamic framework gaps while preserving the target file and decision index", async () => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  const profile: ProjectProfile = { type: "nodejs", stack: { language: "TypeScript", framework: "FixtureFramework" }, design };
  await installArchitectureContext(root, { projectName: "binding-fixture", design, language: "TypeScript", framework: "FixtureFramework", decisionsDir: "docs/decisions" });
  mkdirSync(join(root, ".gwrk/decisions"), { recursive: true });
  writeFileSync(join(root, ".gwrk/decisions/index.md"), "Human decision index remains intact.");
  const target = join(root, ".gwrk/architecture.md");
  const original = readFileSync(target, "utf8");
  const gap = "No bundled framework binding or policy for FixtureFramework.";
  const before = await prompt("gwrk-implement", profile);
  expect.soft(before.split(gap).length - 1).toBe(1);
  const pack = join(root, ".gwrk/plugins/skills/fixture-framework");
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(pack, "manifest.yaml"), "type: skill\nname: fixture-framework\nversion: 1.0.0\ndescription: Fixture framework policy\ntier: enforcement\nscope: all\nlanguage: TypeScript\nframework: FixtureFramework\n");
  writeFileSync(join(pack, "SKILL.md"), "Compatible fixture framework rules.");
  const after = await prompt("gwrk-implement", profile);
  expect.soft(after).toContain("Compatible fixture framework rules.");
  expect.soft(after).not.toContain(gap);
  expect(after.split("Domain policy MUST depend inward").length - 1).toBe(1);
  expect(after).toContain("Human decision index remains intact.");
  expect(readFileSync(target, "utf8")).toBe(original);
  const template = "Read the target without a policy expansion.";
  const unexpanded = await dispatchToAgent({ workflow: "gwrk-implement", profile, workDir: root, stdin: template, promptParts: { template, userInput: "" }, dryRun: true, quiet: true });
  expect(unexpanded.stdout).toContain(gap);
});
