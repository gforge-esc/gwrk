/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectProfile } from "../domain/types.js";
import * as detector from "../engine/profile-detector.js";
import * as agents from "../utils/agent.js";
import { WorkflowRuntime } from "./workflow-runtime.js";

const dispatch = agents.dispatchToAgent;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gwrk-governance-delivery-"));
  await mkdir(join(root, ".gwrk"));
  await writeFile(join(root, ".gwrk/plugins.json"), '{"inherits": false}');
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function captureDispatch(workflow: string, profile?: ProjectProfile) {
  if (profile) vi.spyOn(detector, "detectProfile").mockResolvedValue(profile);
  let captured = "";
  const transport = vi
    .spyOn(agents, "dispatchToAgent")
    .mockImplementation(async (task) => {
      const result = await dispatch({
        ...task,
        agent: "codex",
        dryRun: true,
        quiet: true,
      });
      captured = result.stdout;
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Captured delivery",
          verdict: "GO",
          reopenedTasks: [],
          intents: [],
        }),
        stderr: "",
        durationS: 0,
      };
    });
  await new WorkflowRuntime().executeWorkflow(
    workflow,
    "Use the project decisions.",
    { projectRoot: root, quiet: true },
  );
  expect(transport).toHaveBeenCalledOnce();
  transport.mockRestore();
  return captured;
}

const decisionIndex = [
  "# Decisions",
  "",
  "Proposed: move repository reads into the domain.",
  "Decided: keep repository reads in the filesystem adapter.",
  "Superseded: let use cases read files directly.",
  "",
].join("\n");

const nativeReviewCommands = [
  "pnpm build",
  "pnpm lint",
  "pnpm exec biome lint --write .",
  "TEST_FILES=$(",
  "pnpm vitest run $TEST_FILES",
];
const nativeReviewCommandPattern =
  /\bpnpm (?:exec |run )?(?:build|lint|test|vitest)\b|\bbiome lint --write\b|TEST_FILES=\$\(/g;

const hostReviewGuidance = [
  "Read the host repository's verification instructions",
  "Run the repository's documented build check",
  "Run the repository's documented lint check",
  "Use the repository's test command for the current phase's files.",
  "project's verification commands and schema validation standards",
];

describe("governance prompt delivery", () => {
  it.each(["gwrk-specify", "gwrk-plan", "review-code-cli"])(
    "delivers project guidance and decision authority through %s",
    async (workflow) => {
      await mkdir(join(root, ".gwrk/decisions"), { recursive: true });
      await writeFile(join(root, ".gwrk/decisions/index.md"), decisionIndex);
      await writeFile(
        join(root, ".gwrk/architecture.md"),
        "Proposed target: move repository reads into the domain. Existing code conformance remains unassessed.",
      );
      const captured = await captureDispatch(workflow, {
        type: "python",
        stack: { language: "Python", framework: "FastAPI" },
        layout: "src-layout",
      });
      expect(captured).toContain(
        `<architecture_decisions>\n${decisionIndex}\n</architecture_decisions>`,
      );
      expect(captured.match(/<decision_authority>/g)).toHaveLength(1);
      expect(captured).toContain(
        "Proposed targets require human ratification.",
      );
      expect(captured).toContain("They do not supersede Decided constraints.");
      expect(captured).toContain(
        "Superseded records preserve history and lineage.",
      );
      expect(captured).toContain(
        "Existing code conformance remains unassessed.",
      );
      expect(captured).toContain("Use the project decisions.");
      if (workflow !== "review-code-cli") {
        expect(captured).toContain('language="Python"');
        expect(captured).not.toContain("src/application/");
      }
      const authority = captured.match(
        /<decision_authority>([\s\S]*?)<\/decision_authority>/,
      )?.[1];
      expect(authority).toMatch(
        /\b(?:record|document|note)\b[^.!?]*\b(?:conflicts?|it)\b[^.!?]*\b(?:in|under)\s+(?:the\s+)?plan(?:\.md)?\b/i,
      );
    },
  );

  it.each(["review-code-cli", "review-code-webapp"])(
    "delivers project verification and reporting rules to Python %s",
    async (workflow) => {
      await writeFile(
        join(root, "pyproject.toml"),
        '[project]\nname = "host"\nversion = "0.1.0"\n',
      );

      const captured = await captureDispatch(workflow);

      expect.soft(captured).toContain('language="Python"');
      expect
        .soft(captured)
        .toContain("<!-- enforcement-skill: python-standards -->");
      for (const instruction of hostReviewGuidance) {
        expect.soft(captured).toContain(instruction);
      }
      expect
        .soft(captured)
        .toMatch(
          /start every PR comment with `\*\*From: Principal Engineer\*\*`/i,
        );
      expect
        .soft(captured)
        .toMatch(
          /tag `@\[PROJECT_LEAD\]` when (?:the )?rules, guardrails or architecture are ambiguous/i,
        );
      expect.soft(captured.match(nativeReviewCommandPattern) ?? []).toEqual([]);
    },
  );

  it.each(["review-code-cli", "review-code-webapp"])(
    "delivers host review guidance when %s has an unknown profile",
    async (workflow) => {
      const captured = await captureDispatch(workflow);

      for (const instruction of hostReviewGuidance) {
        expect.soft(captured).toContain(instruction);
      }
      expect.soft(captured.match(nativeReviewCommandPattern) ?? []).toEqual([]);
      expect
        .soft(captured)
        .not.toMatch(/\[type:[^\]]*\]|\[\/type\]|<project_profile\b/);
    },
  );

  it.each(["review-code-cli", "review-code-webapp"])(
    "retains native commands in %s for @gwrk/cli",
    async (workflow) => {
      await writeFile(join(root, "package.json"), '{"name":"@gwrk/cli"}');

      const captured = await captureDispatch(workflow);

      expect.soft(captured).toContain('language="TypeScript"');
      for (const command of nativeReviewCommands) {
        expect.soft(captured).toContain(command);
      }
    },
  );

  it.each([
    {
      workflow: "gwrk-specify",
      guidance: ["host repository's dependency evidence"],
    },
    {
      workflow: "gwrk-plan",
      guidance: [
        "Read the host repository's architecture and planning documents",
        "Use the host repository's verification commands in each gate.",
      ],
    },
    { workflow: "review-code-cli", guidance: hostReviewGuidance },
    { workflow: "review-code-webapp", guidance: hostReviewGuidance },
  ])(
    "TR-012: uses the configured Python profile in $workflow with docs/architecture.md and no language manifest",
    async ({ workflow, guidance }) => {
      await mkdir(join(root, "docs"));
      await writeFile(join(root, "docs/architecture.md"), "# Host architecture\n");
      await writeFile(
        join(root, ".gwrkrc.json"),
        JSON.stringify({ project: { name: "host", type: "python" } }),
      );

      const captured = await captureDispatch(workflow);

      expect.soft(captured).toContain('language="Python"');
      expect
        .soft(captured)
        .toContain("<!-- enforcement-skill: python-standards -->");
      for (const instruction of guidance) {
        expect.soft(captured).toContain(instruction);
      }
      for (const nativeContent of [
        "docs/grounding/architecture.md",
        "specs/000-build-plan.md",
        "<!-- enforcement-skill: typescript-standards -->",
        "<!-- enforcement-skill: gwrk-conventions -->",
      ]) {
        expect.soft(captured).not.toContain(nativeContent);
      }
      expect.soft(captured.match(nativeReviewCommandPattern) ?? []).toEqual([]);
    },
  );

  it("delivers project-local enforcement inside both definition prompts", async () => {
    const policyDir = join(root, ".gwrk/plugins/skills/phase-01-policy");
    await mkdir(policyDir, { recursive: true });
    await writeFile(
      join(policyDir, "manifest.yaml"),
      "type: skill\nname: phase-01-policy\nversion: 1.0.0\ndescription: Phase 1 test policy\ntier: enforcement\nscope: all\n",
    );
    const rule = "Record dependency provenance in the release checklist.";
    await writeFile(join(policyDir, "SKILL.md"), `${rule}\n`);

    for (const workflow of ["gwrk-specify", "gwrk-plan"]) {
      const captured = await captureDispatch(workflow, { type: "unknown" });
      const codeQuality =
        captured.match(/<code_quality>([\s\S]*?)<\/code_quality>/)?.[1] ?? "";
      expect.soft(codeQuality, workflow).toContain(rule);
    }
  });

  it.each([
    {
      workflow: "gwrk-specify",
      guidance: ["host repository's dependency evidence"],
    },
    {
      workflow: "gwrk-plan",
      guidance: [
        "Read the host repository's architecture and planning documents",
        "Use the host repository's verification commands in each gate.",
        "**Done When** uses a fenced `bash` code block.",
        "#### Done When\n```bash\npython -m pytest tests/test_phase.py\n```",
      ],
    },
  ])(
    "uses the detected Python profile in $workflow with docs/architecture.md",
    async ({ workflow, guidance }) => {
      await writeFile(
        join(root, "pyproject.toml"),
        '[project]\nname = "host"\nversion = "0.1.0"\n',
      );
      await mkdir(join(root, "docs"));
      await writeFile(
        join(root, "docs/architecture.md"),
        "# Host architecture\n",
      );

      const captured = await captureDispatch(workflow);

      expect.soft(captured).toContain('language="Python"');
      for (const instruction of guidance) {
        expect.soft(captured).toContain(instruction);
      }
      const codeQuality = captured.match(
        /<code_quality>([\s\S]*?)<\/code_quality>/,
      )?.[1];
      expect
        .soft(codeQuality)
        .toContain("<!-- enforcement-skill: python-standards -->");
      expect
        .soft(codeQuality)
        .not.toContain("<!-- enforcement-skill: gwrk-conventions -->");
      for (const nativeContent of [
        "docs/grounding/architecture.md",
        "specs/000-build-plan.md",
        "<!-- enforcement-skill: typescript-standards -->",
        "pnpm run build",
      ]) {
        expect.soft(captured).not.toContain(nativeContent);
      }
    },
  );

  it.each([
    {
      language: "Rust",
      manifest: "Cargo.toml",
      contents: '[package]\nname = "host"\nversion = "0.1.0"\n',
    },
    {
      language: "Go",
      manifest: "go.mod",
      contents: "module example.com/host\n",
    },
  ])(
    "uses the detected $language profile in both definition workflows with docs/architecture.md",
    async ({ language, manifest, contents }) => {
      await writeFile(join(root, manifest), contents);
      await mkdir(join(root, "docs"));
      await writeFile(
        join(root, "docs/architecture.md"),
        "# Host architecture\n",
      );

      for (const [workflow, guidance] of [
        ["gwrk-specify", "host repository's dependency evidence"],
        [
          "gwrk-plan",
          "Use the host repository's verification commands in each gate.",
        ],
      ]) {
        const captured = await captureDispatch(workflow);
        const codeQuality = captured.match(
          /<code_quality>([\s\S]*?)<\/code_quality>/,
        )?.[1];

        expect.soft(captured, workflow).toContain(`language="${language}"`);
        expect.soft(captured, workflow).toContain(guidance);
        expect
          .soft(codeQuality, workflow)
          .toContain(
            `<!-- enforcement-skill: ${language.toLowerCase()}-standards -->`,
          );
        expect
          .soft(captured, workflow)
          .not.toMatch(
            /docs\/grounding\/architecture\.md|specs\/000-build-plan\.md|pnpm run build|<!-- enforcement-skill: typescript-standards -->/,
          );
      }
    },
  );

  it.each([
    {
      workflow: "gwrk-specify",
      guidance: [
        "host repository's dependency evidence",
        "existing directory structure",
      ],
    },
    {
      workflow: "gwrk-plan",
      guidance: [
        "Read the host repository's architecture and planning documents",
        "Use the host repository's verification commands in each gate.",
        "**Done When** uses a fenced `bash` code block.",
      ],
    },
  ])(
    "uses host guidance in $workflow when the profile is unknown",
    async ({ workflow, guidance }) => {
      const captured = await captureDispatch(workflow, { type: "unknown" });
      for (const instruction of guidance) {
        expect(captured).toContain(instruction);
      }
      const excluded = captured.match(
        /docs\/grounding\/architecture\.md|specs\/000-build-plan\.md|pnpm run build|python -m pytest|\[type:[^\]]*\]|\[\/type\]|<project_profile\b/g,
      );
      expect(excluded ?? []).toEqual([]);
      for (const language of ["typescript", "python", "rust", "go"])
        expect(captured).not.toContain(
          `<!-- enforcement-skill: ${language}-standards -->`,
        );
    },
  );
});
