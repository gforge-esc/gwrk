/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
