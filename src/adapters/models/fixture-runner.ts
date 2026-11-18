/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  ModelCandidate,
  ModelRole,
} from "../../domain/model-qualification.js";
import { PluginLoader } from "../../plugins/loader.js";
import {
  WorkflowRuntime,
  extractJsonFromOutput,
} from "../../plugins/workflow-runtime.js";
import type {
  FixtureRepeatEvidence,
  FixtureRepeatRequest,
  JudgeVerdictPacket,
  PromotionJudgePort,
  QualificationRunnerPort,
  StructuredJudgeVerdict,
} from "../../ports/model-qualification-port.js";
import {
  type TaskDispatch,
  type TaskResult,
  dispatchToAgent,
} from "../../utils/agent.js";

const execFileAsync = promisify(execFile);

const JudgeOutput = z.object({
  summary: z.string().min(1),
  intents: z.array(z.never()).max(0),
  winner: z.enum(["A", "B", "tie"]),
  optionARegression: z.boolean(),
  optionBRegression: z.boolean(),
  scores: z.object({
    optionA: z.number().finite(),
    optionB: z.number().finite(),
  }),
  citations: z.array(
    z.object({
      inputRef: z.string().min(1),
      outputRef: z.string().min(1),
      gateRef: z.string().min(1),
      claim: z.string().min(1),
    }),
  ),
});

const ROLE_WORKFLOWS: Record<ModelRole, string> = {
  define: "gwrk-plan",
  implement: "gwrk-implement",
  review: "gwrk-review-code",
};

async function readOptionalFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export interface FixtureRunnerOptions {
  readonly fixturesDir?: string;
  readonly workflowRuntime?: WorkflowRuntime;
  readonly dispatcher?: (task: TaskDispatch) => Promise<TaskResult>;
  readonly timeoutMs?: number;
}

interface FixtureManifest {
  readonly schemaVersion: number;
  readonly id: string;
  readonly roles: readonly ModelRole[];
  readonly prompt: string;
  readonly files: Record<string, string>;
  readonly gates?: {
    readonly command?: readonly string[];
    readonly baselineExitCode?: number;
    readonly candidateExitCode?: number;
    readonly allowedChangedPaths?: readonly string[];
    readonly requiredOutputs?: readonly string[];
    readonly requiredSpecReferences?: readonly string[];
    readonly requiredPlanReferences?: readonly string[];
    readonly reviewRequiredReopenedTasks?: readonly string[];
    readonly reviewForbiddenReopenedTasks?: readonly string[];
  };
}

export class FixtureRunner
  implements QualificationRunnerPort, PromotionJudgePort
{
  private readonly fixturesDir: string;
  private readonly workflowRuntime?: WorkflowRuntime;
  private readonly dispatcher: (task: TaskDispatch) => Promise<TaskResult>;
  private readonly timeoutMs: number;

  constructor(options: FixtureRunnerOptions = {}) {
    this.fixturesDir =
      options.fixturesDir ??
      resolve(process.cwd(), "tests/fixtures/model-qualification");
    this.workflowRuntime = options.workflowRuntime;
    this.dispatcher = options.dispatcher ?? dispatchToAgent;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async readSuite() {
    const content = await readOptionalFile(
      join(this.fixturesDir, "suite.json"),
    );
    const suite =
      content === undefined
        ? undefined
        : (JSON.parse(content) as {
            fixtures: readonly { id: string; manifest?: string }[];
          });
    const manifests = (suite?.fixtures ?? []).map(({ id, manifest }) => ({
      id,
      path: join(this.fixturesDir, manifest ?? join(id, "fixture.json")),
    }));
    return { content, manifests };
  }

  async loadSuite(): Promise<{
    fixtures: readonly { id: string; roles: readonly ModelRole[] }[];
  }> {
    const { manifests } = await this.readSuite();
    const fixtures = await Promise.all(
      manifests.map(async ({ id, path }) => {
        const manifest = JSON.parse(
          await readFile(path, "utf8"),
        ) as FixtureManifest;
        return { id, roles: manifest.roles };
      }),
    );
    return { fixtures };
  }

  async computeSuiteHashes(): Promise<{
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
  }> {
    const { content, manifests } = await this.readSuite();
    const suiteHasher = createHash("sha256").update(content ?? "");
    for (const { path } of manifests) {
      suiteHasher.update(await readFile(path, "utf8"));
    }
    const fixtureSuiteHash = suiteHasher.digest("hex");

    const projectRoot = process.cwd();
    const governancePaths = [
      "AGENTS.md",
      ".gwrk/agent-context.md",
      ".gwrk/architecture.md",
      ".gwrk/ontology/domain.md",
      ".gwrk/perspective/hierarchy.md",
      ".gwrk/perspective/ux-posture.md",
      ".gwrk/decisions/index.md",
    ];
    for (const directory of [".gwrk/rules", "docs/decisions"]) {
      const path = join(projectRoot, directory);
      if (!existsSync(path)) continue;
      const entries = await readdir(path, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          governancePaths.push(join(directory, entry.name));
        }
      }
    }
    const governance = await Promise.all(
      governancePaths
        .sort()
        .map(async (path) => [
          path,
          await readOptionalFile(join(projectRoot, path)),
        ]),
    );

    const loader = new PluginLoader();
    const hashPrompt = async (workflowName: string): Promise<string> => {
      const { path, manifest } = await loader.resolvePlugin(workflowName);
      if (manifest.type !== "workflow")
        throw new Error(`Not a workflow: ${workflowName}`);
      const promptFile = resolve(path, manifest.prompt || "PROMPT.md");
      let prompt = await readFile(promptFile, "utf8");
      const includes = /<!--\s*@include\s+([^\s]+)\s*-->/g;
      for (const match of [...prompt.matchAll(includes)]) {
        const target = resolve(dirname(promptFile), match[1]);
        const included = await readFile(target, "utf8");
        prompt = prompt.replace(match[0], () => included);
      }
      return createHash("sha256")
        .update(JSON.stringify([prompt, governance]))
        .digest("hex");
    };

    const workflowPromptHashes: Record<string, string> = {};
    for (const [role, workflowName] of Object.entries(ROLE_WORKFLOWS)) {
      const hash = await hashPrompt(workflowName);
      workflowPromptHashes[role] = hash;
      workflowPromptHashes[workflowName] = hash;
    }

    return { fixtureSuiteHash, workflowPromptHashes };
  }

  async runFixtureRepeat(
    request: FixtureRepeatRequest,
  ): Promise<FixtureRepeatEvidence> {
    if (request.handoffArtifactDir && request.role !== "implement") {
      throw new Error("handoffArtifactDir is only valid for implement");
    }
    const suite = await this.readSuite();
    const declared = suite.manifests.find(({ id }) => id === request.fixtureId);
    if (suite.content !== undefined && !declared) {
      throw new Error(`Fixture not declared in suite: ${request.fixtureId}`);
    }
    const fixturePath =
      declared?.path ??
      join(this.fixturesDir, request.fixtureId, "fixture.json");
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture not found: ${fixturePath}`);
    }

    const fixtureRaw = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(fixtureRaw) as FixtureManifest;
    if (!fixture.roles.includes(request.role)) {
      throw new Error(
        `Fixture ${request.fixtureId} does not declare role ${request.role}`,
      );
    }
    const workspaceDir = await mkdtemp(
      join(tmpdir(), "gwrk-model-fixture-ws-"),
    );

    try {
      await execFileAsync("git", ["init", "--quiet", workspaceDir], {
        timeout: 5000,
      });
      await execFileAsync("git", [
        "-C",
        workspaceDir,
        "config",
        "user.name",
        "Fixture Runner",
      ]);
      await execFileAsync("git", [
        "-C",
        workspaceDir,
        "config",
        "user.email",
        "runner@example.com",
      ]);

      for (const [relPath, content] of Object.entries(fixture.files)) {
        const absPath = join(workspaceDir, relPath);
        await mkdir(dirname(absPath), { recursive: true });
        await writeFile(absPath, content, "utf8");
      }

      if (request.handoffArtifactDir) {
        const planContent = await readOptionalFile(
          join(request.handoffArtifactDir, "plan.md"),
        );
        const workspacePlan = join(workspaceDir, "plan.md");
        if (!planContent?.trim()) {
          await rm(workspacePlan, { force: true });
          return {
            fixtureId: request.fixtureId,
            repeatIndex: request.repeatIndex,
            requestedModel: request.route.modelId,
            observedModel: "unknown",
            deterministicGatesPassed: false,
            gateChecks: [
              {
                checkId: "handoff-plan",
                passed: false,
                detail: "Candidate handoff plan is missing or blank",
              },
            ],
            durationMs: 0,
            retries: 0,
            sanitizedOutput: "",
          };
        }
        await writeFile(workspacePlan, planContent, "utf8");
      }

      await execFileAsync("git", ["-C", workspaceDir, "add", "-A"]);
      await execFileAsync("git", [
        "-C",
        workspaceDir,
        "commit",
        "-m",
        "Initial fixture baseline",
        "--quiet",
      ]);
      const { stdout: baselineShaOut } = await execFileAsync("git", [
        "-C",
        workspaceDir,
        "rev-parse",
        "HEAD",
      ]);
      const baselineSha = baselineShaOut.trim();

      const gateChecks: { checkId: string; passed: boolean; detail: string }[] =
        [];

      if (fixture.gates?.command) {
        let baselineExitCode: number;
        try {
          const [cmd, ...args] = fixture.gates.command;
          await execFileAsync(cmd, args, {
            cwd: workspaceDir,
            timeout: 10_000,
          });
          baselineExitCode = 0;
        } catch (error: unknown) {
          const err = error as { code?: number; status?: number };
          baselineExitCode =
            typeof err.code === "number" ? err.code : (err.status ?? 1);
        }

        if (fixture.gates.baselineExitCode !== undefined) {
          const baselineMatches =
            baselineExitCode === fixture.gates.baselineExitCode;
          gateChecks.push({
            checkId: "baseline-gate",
            passed: baselineMatches,
            detail: baselineMatches
              ? `Baseline exit code matched expected ${baselineExitCode}`
              : `Baseline expected ${fixture.gates.baselineExitCode}, observed ${baselineExitCode}`,
          });
        }
      }

      const runtime = this.workflowRuntime ?? new WorkflowRuntime();
      let taskResult: TaskResult;
      try {
        const execution = await runtime.executeWorkflow(
          ROLE_WORKFLOWS[request.role],
          fixture.prompt,
          {
            nativeOnly: true,
            projectRoot: workspaceDir,
            taskType: "model-fixture-repeat",
            agent: request.route.backend,
            model: request.route.modelId,
            effort: request.route.effort,
            quiet: true,
            dispatcher: (task) =>
              this.dispatcher({
                ...task,
                effort: request.route.effort,
                routeMode: "pinned",
                timeoutMs: this.timeoutMs,
                logPath: join(workspaceDir, ".runs", "repeat.log"),
                includeExternalContext: false,
              }),
          },
        );
        taskResult = execution.taskResult;
      } catch (error: unknown) {
        const err = error as { message?: string };
        taskResult = {
          exitCode: 1,
          stdout: "",
          stderr: err.message ?? "Workflow dispatch failed",
          durationS: 0,
          durationMs: 0,
          status: "failure",
          observedModel: "unknown",
        };
      }

      const { stdout: trackedChanges } = await execFileAsync("git", [
        "-C",
        workspaceDir,
        "diff",
        "--no-renames",
        "--name-only",
        "-z",
        baselineSha,
        "--",
      ]);
      const { stdout: untrackedChanges } = await execFileAsync("git", [
        "-C",
        workspaceDir,
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
      ]);
      const changedFiles = [
        ...new Set(
          `${trackedChanges}${untrackedChanges}`
            .split("\0")
            .filter(Boolean)
            .filter((path) => !path.startsWith(".runs/")),
        ),
      ];

      const allowedChangedPaths =
        request.role === "review"
          ? ["tasks.md"]
          : fixture.gates?.allowedChangedPaths;
      if (allowedChangedPaths) {
        const allowed = new Set(allowedChangedPaths);
        const forbidden = changedFiles.filter((path) => !allowed.has(path));
        if (forbidden.length > 0) {
          gateChecks.push({
            checkId: "forbidden-file-mutation",
            passed: false,
            detail: `Forbidden file mutations: ${forbidden.join(", ")}`,
          });
        } else {
          gateChecks.push({
            checkId: "forbidden-file-mutation",
            passed: true,
            detail: "All changed paths permitted",
          });
        }
      }

      if (request.role === "implement") {
        if (fixture.gates?.command) {
          let candidateExitCode: number;
          try {
            const [cmd, ...args] = fixture.gates.command;
            await execFileAsync(cmd, args, {
              cwd: workspaceDir,
              timeout: 10_000,
            });
            candidateExitCode = 0;
          } catch (error: unknown) {
            const err = error as { code?: number; status?: number };
            candidateExitCode =
              typeof err.code === "number" ? err.code : (err.status ?? 1);
          }
          const expectedCode = fixture.gates.candidateExitCode ?? 0;
          const passed = candidateExitCode === expectedCode;
          gateChecks.push({
            checkId: "candidate-gate",
            passed,
            detail: passed
              ? `Candidate command exited with expected code ${candidateExitCode}`
              : `Candidate expected ${expectedCode}, observed ${candidateExitCode}`,
          });
        }
      } else if (request.role === "review") {
        if (fixture.gates?.command) {
          let reviewExitCode: number;
          try {
            const [cmd, ...args] = fixture.gates.command;
            await execFileAsync(cmd, args, {
              cwd: workspaceDir,
              timeout: 10_000,
            });
            reviewExitCode = 0;
          } catch (error: unknown) {
            const err = error as { code?: number; status?: number };
            reviewExitCode =
              typeof err.code === "number" ? err.code : (err.status ?? 1);
          }
          const expectedCode = fixture.gates.baselineExitCode ?? 1;
          const passed = reviewExitCode === expectedCode;
          gateChecks.push({
            checkId: "review-baseline-preserved",
            passed,
            detail: passed
              ? `Review command exit code matched baseline ${reviewExitCode}`
              : `Review expected baseline ${expectedCode}, observed ${reviewExitCode}`,
          });
        }
      }

      if (Array.isArray(fixture.gates?.requiredOutputs)) {
        for (const file of fixture.gates.requiredOutputs) {
          const target = join(workspaceDir, file);
          let existsAndNonEmpty = false;
          try {
            if (existsSync(target)) {
              const text = await readFile(target, "utf8");
              existsAndNonEmpty = text.trim().length > 0;
            }
          } catch {}
          gateChecks.push({
            checkId: `required-output-${file}`,
            passed: existsAndNonEmpty,
            detail: existsAndNonEmpty
              ? `Required output ${file} exists`
              : `Missing required output ${file}`,
          });
        }
      }

      if (Array.isArray(fixture.gates?.requiredSpecReferences)) {
        const specPath = join(workspaceDir, "spec.md");
        let specText = "";
        try {
          if (existsSync(specPath)) {
            specText = await readFile(specPath, "utf8");
          }
        } catch {}
        for (const ref of fixture.gates.requiredSpecReferences) {
          const present = specText.includes(ref);
          gateChecks.push({
            checkId: `spec-ref-${ref}`,
            passed: present,
            detail: present
              ? `Spec reference ${ref} present`
              : `Missing spec reference ${ref}`,
          });
        }
      }

      if (Array.isArray(fixture.gates?.requiredPlanReferences)) {
        const planPath = join(workspaceDir, "plan.md");
        let planText = "";
        try {
          if (existsSync(planPath)) {
            planText = await readFile(planPath, "utf8");
          }
        } catch {}
        for (const ref of fixture.gates.requiredPlanReferences) {
          const present = planText.includes(ref);
          gateChecks.push({
            checkId: `plan-ref-${ref}`,
            passed: present,
            detail: present
              ? `Plan reference ${ref} present`
              : `Missing plan reference ${ref}`,
          });
        }
      }

      const reopenedTasks = new Set<string>();
      if (request.role === "review") {
        try {
          const parsed =
            taskResult.structuredOutput ??
            extractJsonFromOutput(
              taskResult.unwrappedStdout ?? taskResult.stdout,
            );
          if (
            parsed &&
            typeof parsed === "object" &&
            "reopenedTasks" in parsed &&
            Array.isArray(parsed.reopenedTasks)
          ) {
            for (const task of parsed.reopenedTasks) {
              if (typeof task === "string") reopenedTasks.add(task);
            }
          }
        } catch {
          // Missing structured evidence leaves the required-task gate failing.
        }

        try {
          const { stdout: diffOut } = await execFileAsync("git", [
            "-C",
            workspaceDir,
            "diff",
            baselineSha,
            "--",
            "tasks.md",
          ]);
          for (const line of diffOut.split("\n")) {
            if (line.startsWith("+") && !line.startsWith("+++")) {
              if (/\b(?:reopen|reopened|open)\b/i.test(line)) {
                const matches = line.match(/\bT\d+\b/g);
                if (matches) {
                  for (const m of matches) {
                    reopenedTasks.add(m);
                  }
                }
              }
            }
          }
        } catch {}
      }

      if (
        request.role === "review" &&
        Array.isArray(fixture.gates?.reviewRequiredReopenedTasks)
      ) {
        for (const task of fixture.gates.reviewRequiredReopenedTasks) {
          const reopened = reopenedTasks.has(task);
          gateChecks.push({
            checkId: `review-required-${task}`,
            passed: reopened,
            detail: reopened
              ? `Task ${task} was reopened`
              : `Task ${task} was not reopened`,
          });
        }
      }

      if (
        request.role === "review" &&
        Array.isArray(fixture.gates?.reviewForbiddenReopenedTasks)
      ) {
        for (const task of fixture.gates.reviewForbiddenReopenedTasks) {
          const forbidden = reopenedTasks.has(task);
          gateChecks.push({
            checkId: `review-forbidden-${task}`,
            passed: !forbidden,
            detail: !forbidden
              ? `Task ${task} remained closed`
              : `Forbidden task ${task} was reopened`,
          });
        }
      }

      const deterministicGatesPassed =
        gateChecks.length > 0 && gateChecks.every((check) => check.passed);

      let sanitizedOutput = "";
      if (request.role === "define") {
        if (request.artifactOutputDir) {
          await mkdir(request.artifactOutputDir, { recursive: true });
        }
        const parts: string[] = [];
        for (const file of ["spec.md", "plan.md"]) {
          const content = await readOptionalFile(join(workspaceDir, file));
          if (content !== undefined) parts.push(content);
          if (request.artifactOutputDir) {
            const destination = join(request.artifactOutputDir, file);
            if (content === undefined) {
              await rm(destination, { force: true });
            } else {
              await writeFile(destination, content, "utf8");
            }
          }
        }
        sanitizedOutput = parts.join("\n\n");
      } else {
        await execFileAsync("git", ["-C", workspaceDir, "add", "-A"]);
        const { stdout: diffOut } = await execFileAsync("git", [
          "-C",
          workspaceDir,
          "diff",
          "--cached",
          baselineSha,
          "--",
          ".",
          ":!.runs",
        ]);
        const agentReport = taskResult.unwrappedStdout ?? taskResult.stdout;
        sanitizedOutput = `## Diff\n${diffOut}\n\n## Agent report\n${agentReport}`;
      }

      return {
        fixtureId: request.fixtureId,
        repeatIndex: request.repeatIndex,
        requestedModel: request.route.modelId,
        observedModel: taskResult.observedModel ?? "unknown",
        deterministicGatesPassed,
        gateChecks,
        durationMs: taskResult.durationMs ?? taskResult.durationS * 1000,
        retries: 0,
        sanitizedOutput,
      };
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  }

  async judgeComparison(
    judge: ModelCandidate,
    packet: JudgeVerdictPacket,
  ): Promise<StructuredJudgeVerdict> {
    const judgeDir = await mkdtemp(join(tmpdir(), "gwrk-model-judge-ws-"));
    const workflowDir = join(
      judgeDir,
      ".gwrk",
      "plugins",
      "workflows",
      "gwrk-model-judge",
    );

    try {
      await execFileAsync("git", ["init", "--quiet", judgeDir], {
        timeout: 5000,
      });
      await execFileAsync("git", [
        "-C",
        judgeDir,
        "config",
        "user.name",
        "Fixture Runner",
      ]);
      await execFileAsync("git", [
        "-C",
        judgeDir,
        "config",
        "user.email",
        "runner@example.com",
      ]);
      await execFileAsync("git", [
        "-C",
        judgeDir,
        "commit",
        "--allow-empty",
        "-m",
        "init",
        "--quiet",
      ]);

      await mkdir(workflowDir, { recursive: true });

      const manifestYaml = [
        "type: workflow",
        "name: gwrk-model-judge",
        "version: 0.1.0",
        "description: Blinded two-judge evaluation",
        "enforceOutputSchema: true",
        "prompt: PROMPT.md",
        "outputSchema:",
        "  type: object",
        "  properties:",
        "    summary:",
        "      type: string",
        "    intents:",
        "      type: array",
        "      maxItems: 0",
        "    winner:",
        "      type: string",
        '      enum: ["A", "B", "tie"]',
        "    optionARegression:",
        "      type: boolean",
        "    optionBRegression:",
        "      type: boolean",
        "    scores:",
        "      type: object",
        "      properties:",
        "        optionA:",
        "          type: number",
        "        optionB:",
        "          type: number",
        "      required: [optionA, optionB]",
        "    citations:",
        "      type: array",
        "      items:",
        "        type: object",
        "        properties:",
        "          inputRef:",
        "            type: string",
        "          outputRef:",
        "            type: string",
        "          gateRef:",
        "            type: string",
        "          claim:",
        "            type: string",
        "        required: [inputRef, outputRef, gateRef, claim]",
        "  required: [summary, intents, winner, optionARegression, optionBRegression, scores, citations]",
      ].join("\n");

      await writeFile(join(workflowDir, "manifest.yaml"), manifestYaml, "utf8");
      await writeFile(
        join(workflowDir, "PROMPT.md"),
        [
          "# Model Judge Prompt",
          "",
          "Evaluate the blinded options. Cite a fixture ID from the fixture summary, `optionA` or `optionB`, and a gate check ID from the gate evidence summary.",
        ].join("\n"),
        "utf8",
      );

      const judgePromptInput = [
        `Comparison ID: ${packet.comparisonId}`,
        `Role: ${packet.role}`,
        `Fixture Summary: ${packet.fixtureSummary}`,
        `Gate Evidence Summary: ${packet.gateEvidenceSummary}`,
        "",
        "Option A:",
        packet.optionA,
        "",
        "Option B:",
        packet.optionB,
      ].join("\n");

      const loader = new PluginLoader({ projectDir: judgeDir });
      const runtime = new WorkflowRuntime(loader);

      let observedJudgeModel = "unknown";
      const execution = await runtime.executeWorkflow(
        "gwrk-model-judge",
        judgePromptInput,
        {
          projectRoot: judgeDir,
          reportOnly: true,
          agent: judge.backend,
          model: judge.modelId,
          effort: judge.effort,
          quiet: true,
          dispatcher: async (task) => {
            const tr = await this.dispatcher({
              ...task,
              effort: judge.effort,
              routeMode: "pinned",
              timeoutMs: this.timeoutMs,
              logPath: join(judgeDir, ".runs", "judge.log"),
              includeExternalContext: false,
            });
            observedJudgeModel = tr.observedModel ?? "unknown";
            return tr;
          },
        },
      );

      const parsed = JudgeOutput.parse(execution.output);

      return {
        judgeBackend: judge.backend,
        judgeProvider: judge.provider,
        judgeFamily: judge.family,
        judgeModelId: judge.modelId,
        observedJudgeModel,
        winner: parsed.winner,
        optionARegression: parsed.optionARegression,
        optionBRegression: parsed.optionBRegression,
        scores: parsed.scores,
        citations: parsed.citations,
      };
    } finally {
      await rm(judgeDir, { recursive: true, force: true });
    }
  }
}

export function createFixtureRunner(
  options?: FixtureRunnerOptions,
): FixtureRunner {
  return new FixtureRunner(options);
}
