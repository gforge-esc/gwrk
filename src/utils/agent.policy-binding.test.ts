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
  const result = await dispatchToAgent({
    agent: "agy",
    workflow,
    profile,
    type: workflow.includes("review") ? "review" : "workflow",
    workDir: root,
    stdin: template,
    promptParts: { template, userInput: "<user_input>Keep task text</user_input>" },
    dryRun: true,
    quiet: true,
  });
  return JSON.parse(result.stdout).message.content as string;
}
describe("shared effective policy dispatch", () => {
  it.each(["gwrk-spec", "gwrk-implement", "review-code-cli"])(
    "binds the selected workspace profile once in %s without launching an agent",
    async (workflow) => {
      const design = resolveDesign({ architecture: "hexagonal-functional" });
      await installArchitectureContext(root, {
        projectName: "binding-fixture",
        design,
        language: "TypeScript",
        framework: "Fastify",
        decisionsDir: "docs/decisions",
      });
      const target = join(root, ".gwrk/architecture.md");
      const original = readFileSync(target, "utf8");
      expect(original).toContain("Use interfaces for ports");
      expect(original).toContain("Fastify routes");

      const rendered = await prompt(workflow, {
        type: "python",
        stack: { language: "Python", framework: "FastAPI" },
        design,
      });
      expect(rendered.match(/<effective_policy>/g)).toHaveLength(1);
      expect(rendered).toContain("Domain policy MUST depend inward");
      expect(rendered).toContain("typing.Protocol");
      expect(rendered).toContain("FastAPI routers");
      expect.soft(rendered).not.toContain("Use interfaces for ports");
      expect.soft(rendered).not.toContain("Fastify routes");
      expect(rendered).not.toContain("TypeScript Standards");
      expect(rendered).toContain("Initialization does not assess code conformance");
      expect(rendered).toContain("<user_input>Keep task text</user_input>");
      expect(rendered).toContain("## Project decisions");
      expect(readFileSync(target, "utf8")).toBe(original);
    },
  );
  it("reports incompatible framework guidance without injecting its binding", async () => {
    const rendered = await prompt("gwrk-spec", { type: "nodejs", stack: { language: "TypeScript", framework: "Django" }, design: resolveDesign({ architecture: "hexagonal-functional" }) });
    expect(rendered).toContain("## Policy gaps");
    expect(rendered).toContain("No compatible policy found for framework Django");
    expect(rendered).not.toContain("Keep Django ORM models");
  });
});

it("preserves every byte of a target without generated policy sections", async () => {
  const target = [
    "# Project architecture target",
    "",
    "## Rules",
    "",
    "- Preserve the literal `$$` in Make recipes.",
    "",
    "```markdown",
    "## Language guidance",
    "## Framework guidance",
    "## Policy gaps",
    "```",
    "",
  ].join("\n");
  mkdirSync(join(root, ".gwrk"), { recursive: true });
  writeFileSync(join(root, ".gwrk/architecture.md"), target);

  const rendered = await prompt("gwrk-implement", {
    type: "nodejs",
    stack: { language: "TypeScript", framework: "Fastify" },
    design: resolveDesign({ architecture: "hexagonal-functional" }),
  });
  expect(rendered).toContain("<effective_policy>");
  const injected = rendered.match(
    /<architecture_target>\n([\s\S]*?)\n<\/architecture_target>/,
  );
  expect(injected?.[1]).toBe(target);
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

it("preserves maintainer additions while replacing generated root stack guidance", async () => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  await installArchitectureContext(root, { projectName: "binding-fixture", design, language: "TypeScript", framework: "Fastify", decisionsDir: "docs/decisions" });
  const path = join(root, ".gwrk/architecture.md");
  const target = readFileSync(path, "utf8").replace("## Framework guidance", "Use SPDX license headers on new workspace modules.\n\n## Framework guidance");
  writeFileSync(path, target);
  const rendered = await prompt("gwrk-implement", { type: "python", stack: { language: "Python", framework: "FastAPI" }, design });
  expect.soft(rendered).toContain("Use SPDX license headers on new workspace modules.");
  expect.soft(rendered).not.toContain("Use interfaces for ports");
  expect.soft(rendered).toContain("typing.Protocol");
  expect(readFileSync(path, "utf8")).toBe(target);
});

it.each(["fence", "comment"])("retains active policy when the target only quotes the rule in a %s", async (kind) => {
  const rule = "Domain policy MUST depend inward. Ports declare boundaries. Adapters implement effects. Composition wires dependencies.";
  const example = `## Rules\n\n- ${rule}`;
  const target = kind === "fence" ? `# Target\n\n\`\`\`markdown\n${example}\n\`\`\`\n` : `# Target\n\n<!--\n${example}\n-->\n`;
  mkdirSync(join(root, ".gwrk"), { recursive: true });
  writeFileSync(join(root, ".gwrk/architecture.md"), target);
  const rendered = await prompt("gwrk-implement", { type: "nodejs", stack: { language: "TypeScript" }, design: resolveDesign({ architecture: "hexagonal-functional" }) });
  const policy = rendered.match(/<effective_policy>\n([\s\S]*?)\n<\/effective_policy>/)?.[1];
  expect(policy).toContain(`- ${rule}`);
  expect(readFileSync(join(root, ".gwrk/architecture.md"), "utf8")).toBe(target);
});
