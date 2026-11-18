/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installArchitectureContext } from "../adapters/architecture/context-files.js";
import { resolveDesign } from "../domain/architecture-context.js";
import type { ProjectProfile } from "../domain/types.js";
import { WorkflowRuntime } from "../plugins/workflow-runtime.js";
import { dispatchToAgent, SAFE_AGENT_ENV } from "./agent.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gwrk-policy-binding-"));
  writeFileSync(join(root, ".gwrkrc.json"), JSON.stringify({ project: { name: "binding-fixture", type: "nodejs", stack: { language: "TypeScript", framework: "Fastify" } } }));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function prompt(
  workflow: string,
  profile: ProjectProfile,
  type = workflow.includes("review") ? "review" : "workflow",
) {
  const template = "Trusted workflow\n<code_quality>\n{{enforcement}}\n</code_quality>";
  const result = await dispatchToAgent({
    agent: "agy",
    workflow,
    profile,
    type,
    workDir: root,
    stdin: template,
    promptParts: { template, userInput: "<user_input>Keep task text</user_input>" },
    dryRun: true,
    quiet: true,
  });
  return JSON.parse(result.stdout).message.content as string;
}
describe("shared effective policy dispatch", () => {
  it("uses the owning worktree policy and grounding for a registered workspace", async () => {
    const worktree = join(root, "worktree");
    const workspace = join(worktree, "services/api");
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: root,
        env: { ...process.env, ...SAFE_AGENT_ENV },
        stdio: "pipe",
      });
    git("init");
    git(
      "-c", "user.name=Test",
      "-c", "user.email=test@example.com",
      "-c", "commit.gpgsign=false",
      "-c", "core.hooksPath=/dev/null",
      "commit", "--author=Test <test@example.com>", "--no-edit", "--allow-empty",
      "-m", "Fixture",
    );
    git("worktree", "add", "--detach", worktree, "HEAD");

    const design = resolveDesign({ architecture: "hexagonal-functional" });
    const projectStack = { language: "TypeScript", framework: "Fastify" };
    const workspaceStack = { language: "Python", framework: "FastAPI" };
    writeFileSync(
      join(worktree, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "binding-fixture", type: "nodejs", stack: projectStack, design },
        workspaces: { "services/api": { type: "python", stack: workspaceStack } },
      }),
    );
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "requirements.txt"), "fastapi\n");
    await installArchitectureContext(worktree, {
      projectName: "binding-fixture",
      design,
      ...projectStack,
      decisionsDir: "docs/decisions",
    });
    const index = "# Architecture Decision Index\n\nWorktree decisions for the fixture API.\n";
    mkdirSync(join(worktree, ".gwrk/decisions"), { recursive: true });
    writeFileSync(join(worktree, ".gwrk/decisions/index.md"), index);
    const pack = join(worktree, ".gwrk/plugins/skills/fixture-fastapi");
    mkdirSync(pack, { recursive: true });
    writeFileSync(
      join(pack, "manifest.yaml"),
      [
        "type: skill",
        "name: fixture-fastapi",
        "version: 1.0.0",
        "description: Fixture FastAPI policy",
        "tier: enforcement",
        "scope: implementation",
        "language: Python",
        "framework: FastAPI",
      ].join("\n"),
    );
    const packRules = "Fixture FastAPI pack requires typed response models.";
    writeFileSync(join(pack, "SKILL.md"), packRules);

    const { taskResult } = await new WorkflowRuntime().executeWorkflow(
      "gwrk-implement",
      "Keep workspace task text.",
      {
        projectRoot: workspace,
        agent: "agy",
        nativeOnly: true,
        quiet: true,
        dispatcher: (task) => {
          expect(task.workDir).toBe(workspace);
          expect(task.profile?.stack).toMatchObject(workspaceStack);
          expect(task.profile?.design).toEqual(design);
          return dispatchToAgent({ ...task, dryRun: true });
        },
      },
    );
    expect(taskResult.exitCode).toBe(0);
    const rendered: string = JSON.parse(taskResult.stdout).message.content;
    const policy = rendered.match(/<code_quality>\s*<effective_policy>([\s\S]*?)<\/effective_policy>\s*<\/code_quality>/)?.[1];
    expect(policy).toContain("FastAPI routers");
    expect.soft(policy).toContain(packRules);
    const target = rendered.match(/<architecture_target>\n([\s\S]*?)\n<\/architecture_target>/)?.[1];
    expect.soft(target ?? "").toContain("Domain policy MUST depend inward");
    expect.soft(rendered).toContain(`<architecture_decisions>\n${index}\n</architecture_decisions>`);
  });

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

  it.each([
    { workflow: "fixture-workflow", type: "define", expected: "define" },
    { workflow: "fixture-preview", type: "define", expected: "define" },
    { workflow: "gwrk-plan-fixture", type: "implement", expected: "implementation" },
    { workflow: "gwrk-specify", type: "workflow", expected: "define" },
    { workflow: "gwrk-implement", type: "workflow", expected: "implementation" },
    { workflow: "gwrk-review-code", type: "workflow", expected: "review" },
  ])("uses $expected policy for $workflow with task type $type", async ({ workflow, type, expected }) => {
    for (const [scope, rules] of [
      ["define", "Fixture define policy."],
      ["implementation", "Fixture implementation policy."],
      ["review", "Fixture review policy."],
    ]) {
      const name = `fixture-${scope}`;
      const pack = join(root, ".gwrk/plugins/skills", name);
      mkdirSync(pack, { recursive: true });
      writeFileSync(
        join(pack, "manifest.yaml"),
        `type: skill\nname: ${name}\nversion: 1.0.0\ndescription: Fixture policy\ntier: enforcement\nscope: ${scope}\n`,
      );
      writeFileSync(join(pack, "SKILL.md"), rules);
    }

    const rendered = await prompt(
      workflow,
      { type: "nodejs", stack: { language: "TypeScript" } },
      type,
    );
    const policy = rendered.match(/<effective_policy>\n([\s\S]*?)\n<\/effective_policy>/)?.[1];
    expect(policy?.match(/Fixture (?:define|implementation|review) policy\./g)).toEqual([
      `Fixture ${expected} policy.`,
    ]);
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

it.each([
  {
    initialPack: "no pack",
    gap: "No bundled framework binding or policy for FixtureFramework.",
  },
  {
    initialPack: "a Python-only pack",
    gap: "No compatible policy found for framework FixtureFramework.",
  },
])("refreshes a saved framework gap from $initialPack after installing compatible rules", async ({ initialPack, gap }) => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  const stack = { language: "TypeScript", framework: "FixtureFramework" };
  const profile: ProjectProfile = { type: "nodejs", stack, design };
  const pack = join(root, ".gwrk/plugins/skills/fixture-framework");
  const installPack = (language: string, rules: string) => {
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "manifest.yaml"), `type: skill\nname: fixture-framework\nversion: 1.0.0\ndescription: Fixture framework policy\ntier: enforcement\nscope: all\nlanguage: ${language}\nframework: FixtureFramework\n`);
    writeFileSync(join(pack, "SKILL.md"), rules);
  };
  if (initialPack === "a Python-only pack") {
    installPack("Python", "Python-only fixture framework rules.");
  }
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    ...stack,
    decisionsDir: "docs/decisions",
  });
  const decisions = join(root, ".gwrk/decisions/index.md");
  const decisionIndex = "Human decision index remains intact.";
  mkdirSync(join(root, ".gwrk/decisions"), { recursive: true });
  writeFileSync(decisions, decisionIndex);
  const target = join(root, ".gwrk/architecture.md");
  const original = readFileSync(target, "utf8");
  expect(original).toContain(`- ${gap}\n`);
  const before = await prompt("gwrk-implement", profile);
  expect.soft(before.split(gap).length - 1).toBe(1);
  expect(before.match(/<effective_policy>\n([\s\S]*?)\n<\/effective_policy>/)?.[1]).toContain(gap);
  expect(before).not.toContain("Python-only fixture framework rules.");

  installPack("TypeScript", "Compatible fixture framework rules.");
  const after = await prompt("gwrk-implement", profile);
  expect.soft(after).toContain("Compatible fixture framework rules.");
  expect.soft(after).not.toContain(gap);
  expect(after.split("Domain policy MUST depend inward").length - 1).toBe(1);
  expect(after).toContain(decisionIndex);
  expect(readFileSync(target, "utf8")).toBe(original);
  expect(readFileSync(decisions, "utf8")).toBe(decisionIndex);
  const template = "Read the target without a policy expansion.";
  const unexpanded = await dispatchToAgent({ workflow: "gwrk-implement", profile, workDir: root, stdin: template, promptParts: { template, userInput: "" }, dryRun: true, quiet: true });
  expect(unexpanded.stdout).toContain(gap);
});

it("refreshes a saved gap for a secondary language after installing compatible rules", async () => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  const stack = { language: "TypeScript", languages: ["TypeScript", "COBOL"] };
  const profile: ProjectProfile = { type: "polyglot-monorepo", stack, design };
  writeFileSync(
    join(root, ".gwrkrc.json"),
    JSON.stringify({ project: { name: "binding-fixture", ...profile } }),
  );
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    language: stack.language,
    decisionsDir: "docs/decisions",
  });
  const gap = "No bundled language binding or selected policy for COBOL. Assess language-specific boundaries explicitly.";
  const target = join(root, ".gwrk/architecture.md");
  const original = readFileSync(target, "utf8");
  expect(original).toContain(`- ${gap}\n`);

  const before = await prompt("gwrk-implement", profile);
  expect.soft(before.split(gap).length - 1).toBe(1);
  expect(before.match(/<effective_policy>\n([\s\S]*?)\n<\/effective_policy>/)?.[1]).toContain(gap);

  const pack = join(root, ".gwrk/plugins/skills/fixture-cobol");
  mkdirSync(pack, { recursive: true });
  writeFileSync(
    join(pack, "manifest.yaml"),
    "type: skill\nname: fixture-cobol\nversion: 1.0.0\ndescription: Fixture COBOL policy\ntier: enforcement\nscope: all\nlanguage: COBOL\n",
  );
  writeFileSync(join(pack, "SKILL.md"), "Compatible COBOL rules.");

  const after = await prompt("gwrk-implement", profile);
  expect(after).toContain("Compatible COBOL rules.");
  expect.soft(after).not.toContain(gap);
  expect(readFileSync(target, "utf8")).toBe(original);
});

it("omits the incompatible Django root gap and fallback from a FastAPI workspace prompt", async () => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    language: "TypeScript",
    framework: "Django",
    decisionsDir: "docs/decisions",
  });
  const target = join(root, ".gwrk/architecture.md");
  const original = readFileSync(target, "utf8");
  const gap = "No compatible policy found for framework Django.";
  const fallback = "No bundled framework binding. Framework compatibility remains unassessed.";
  expect(original).toContain(gap);
  expect(original).toContain(fallback);

  const rendered = await prompt("gwrk-implement", {
    type: "python",
    stack: { language: "Python", framework: "FastAPI" },
    design,
  });
  expect(rendered).toContain("FastAPI routers");
  expect(rendered).not.toContain(gap);
  expect(rendered).not.toContain(fallback);
  expect(readFileSync(target, "utf8")).toBe(original);
});

async function installPolyglotTarget(language: "none" | "unspecified") {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  const stack = { language, languages: ["Python", "Go"] };
  writeFileSync(
    join(root, ".gwrkrc.json"),
    JSON.stringify({ project: { name: "binding-fixture", type: "polyglot-monorepo", stack, design } }),
  );
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    language,
    decisionsDir: "docs/decisions",
  });
  return {
    target: join(root, ".gwrk/architecture.md"),
    profile: { type: "go", stack: { language: "Go" }, design } satisfies ProjectProfile,
  };
}

it.each(["absent", "none", "unspecified"] as const)(
  "omits generated Python guidance from a Go workspace when the saved primary is %s",
  async (primary) => {
    const { target, profile } = await installPolyglotTarget(primary === "unspecified" ? primary : "none");
    if (primary === "absent") {
      writeFileSync(target, readFileSync(target, "utf8").replace(/^- Language: none\n/m, ""));
    }
    const original = readFileSync(target);
    expect(original.toString()).toContain("Use typing.Protocol for ports.");

    const rendered = await prompt("gwrk-implement", profile);
    expect.soft(rendered).toContain("Define small consumer-owned interfaces.");
    expect.soft(rendered).not.toContain("Use typing.Protocol for ports.");
    expect(readFileSync(target)).toEqual(original);
  },
);

it("preserves edited and quoted Python guidance when the saved primary is unset", async () => {
  const { target, profile } = await installPolyglotTarget("none");
  const original = readFileSync(target, "utf8");
  const guidance = original.match(/## Language guidance\n\n([^\n]+)\n\n/)?.[1];
  expect(guidance).toContain("Use typing.Protocol for ports.");
  const section = [
    `${guidance}\nUse SPDX license headers on new workspace modules.`,
    `\`\`\`markdown\n## Language guidance\n\n${guidance}\n\`\`\``,
    `> ${guidance}`,
  ].join("\n\n");
  const edited = original.replace(`\n\n${guidance}\n\n`, `\n\n${section}\n\n`);
  writeFileSync(target, edited);

  const rendered = await prompt("gwrk-implement", profile);
  const injected = rendered.match(/<architecture_target>\n([\s\S]*?)\n<\/architecture_target>/)?.[1];
  expect(injected).toContain(`## Language guidance\n\n${section}\n\n`);
  expect(rendered).toContain("Define small consumer-owned interfaces.");
  expect(readFileSync(target, "utf8")).toBe(edited);
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

it("reads projection fields from the active Selection section", async () => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    language: "TypeScript",
    framework: "Fastify",
    decisionsDir: "docs/decisions",
  });
  const target = join(root, ".gwrk/architecture.md");
  const maintainerNote = [
    "## Rules",
    "",
    "- Preserve maintainer policy.",
    "",
    "## Maintainer notes",
    "",
    "- Language: Go",
    "- Framework: Gin",
    "",
    "```markdown",
    "## Selection",
    "- Language: Go",
    "- Framework: Gin",
    "```",
  ].join("\n");
  const original = Buffer.from(
    readFileSync(target, "utf8").replace(
      /^## Selection$/m,
      `${maintainerNote}\n\n## Selection`,
    ),
  );
  writeFileSync(target, original);
  expect(original.toString()).toContain("Use interfaces for ports");
  expect(original.toString()).toContain("Fastify routes");

  const rendered = await prompt("gwrk-implement", {
    type: "python",
    stack: { language: "Python", framework: "FastAPI" },
    design,
  });
  expect(rendered).toContain(maintainerNote);
  expect.soft(rendered.split("Domain policy MUST depend inward").length - 1).toBe(1);
  expect(rendered).toContain("FastAPI routers");
  expect.soft(rendered).not.toContain("Use interfaces for ports");
  expect.soft(rendered).not.toContain("Fastify routes");
  expect(readFileSync(target)).toEqual(original);
});

it.each([
  { separator: " ", edit: "on the same line" },
  { separator: "\n", edit: "on a continuation line" },
])("preserves the full language paragraph edited $edit and a continued gap item", async ({ separator }) => {
  const design = resolveDesign({ architecture: "hexagonal-functional" });
  await installArchitectureContext(root, {
    projectName: "binding-fixture",
    design,
    language: "TypeScript",
    framework: "Django",
    decisionsDir: "docs/decisions",
  });
  const path = join(root, ".gwrk/architecture.md");
  const guidance = "Use interfaces for ports. Inject effectful services. Keep framework types outside domain signatures.";
  const editedGuidance = `${guidance}${separator}Use SPDX license headers on new workspace modules.`;
  const gap = "- No compatible policy found for framework Django.";
  const editedGap = `${gap}\n  Keep this note for migrations.`;
  const target = readFileSync(path, "utf8").replace(guidance, editedGuidance).replace(gap, editedGap);
  writeFileSync(path, target);

  const rendered = await prompt("gwrk-implement", {
    type: "python",
    stack: { language: "Python", framework: "FastAPI" },
    design,
  });
  const injected = rendered.match(/<architecture_target>\n([\s\S]*?)\n<\/architecture_target>/)?.[1];
  expect.soft(injected?.match(/## Language guidance\n\n([\s\S]*?)\n\n/)?.[1]).toBe(editedGuidance);
  expect.soft(injected).toContain(`## Policy gaps\n\n${editedGap}\n\n`);
  expect(rendered).toContain("typing.Protocol");
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
