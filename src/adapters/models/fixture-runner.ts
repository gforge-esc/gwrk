/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { ModelCandidate } from "../../domain/model-qualification.js";
import { PluginLoader } from "../../plugins/loader.js";
import { WorkflowRuntime } from "../../plugins/workflow-runtime.js";
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

export interface FixtureRunnerOptions {
  readonly fixturesDir?: string;
  readonly workflowRuntime?: WorkflowRuntime;
  readonly dispatcher?: (task: TaskDispatch) => Promise<TaskResult>;
  readonly timeoutMs?: number;
}

interface FixtureManifest {
  readonly schemaVersion: number;
  readonly id: string;
  readonly roles: readonly string[];
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

  async computeSuiteHashes(): Promise<{
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
  }> {
    const suitePath = join(this.fixturesDir, "suite.json");
    const suiteContent = existsSync(suitePath)
      ? await readFile(suitePath, "utf8")
      : "";

    const definePath = join(
      this.fixturesDir,
      "define-long-context",
      "fixture.json",
    );
    const defineContent = existsSync(definePath)
      ? await readFile(definePath, "utf8")
      : "";

    const implementPath = join(
      this.fixturesDir,
      "implement-seeded-defect",
      "fixture.json",
    );
    const implementContent = existsSync(implementPath)
      ? await readFile(implementPath, "utf8")
      : "";

    const fixtureSuiteHash = createHash("sha256")
      .update(suiteContent)
      .update(defineContent)
      .update(implementContent)
      .digest("hex");

    const workflowsDir = resolve(
      process.cwd(),
      "src/plugins/builtins/workflows",
    );

    const hashPrompt = async (workflowName: string): Promise<string> => {
      const promptFile = join(workflowsDir, workflowName, "PROMPT.md");
      if (!existsSync(promptFile)) {
        return createHash("sha256").update(workflowName).digest("hex");
      }
      let content = await readFile(promptFile, "utf8");
      const includes = /<!--\s*@include\s+([^\s]+)\s*-->/g;
      for (const match of [...content.matchAll(includes)]) {
        const target = resolve(dirname(promptFile), match[1]);
        if (existsSync(target)) {
          const included = await readFile(target, "utf8");
          content = content.replace(match[0], () => included);
        }
      }
      return createHash("sha256").update(content).digest("hex");
    };

    const defineHash = await hashPrompt("gwrk-plan");
    const implementHash = await hashPrompt("gwrk-implement");
    const reviewHash = await hashPrompt("gwrk-review-code");

    const workflowPromptHashes: Record<string, string> = {
      define: defineHash,
      implement: implementHash,
      review: reviewHash,
      "gwrk-plan": defineHash,
      "gwrk-implement": implementHash,
      "gwrk-review-code": reviewHash,
    };

    return { fixtureSuiteHash, workflowPromptHashes };
  }

  async runFixtureRepeat(
    request: FixtureRepeatRequest,
  ): Promise<FixtureRepeatEvidence> {
    const fixturePath = join(
      this.fixturesDir,
      request.fixtureId,
      "fixture.json",
    );
    if (!existsSync(fixturePath)) {
      throw new Error(`Fixture not found: ${fixturePath}`);
    }

    const fixtureRaw = await readFile(fixturePath, "utf8");
    const fixture = JSON.parse(fixtureRaw) as FixtureManifest;
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
        const handoffPlan = join(request.handoffArtifactDir, "plan.md");
        if (existsSync(handoffPlan)) {
          const planContent = await readFile(handoffPlan, "utf8");
          await writeFile(join(workspaceDir, "plan.md"), planContent, "utf8");
        }
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
          `gwrk-fixture-${request.role}`,
          fixture.prompt,
          {
            nativeOnly: true,
            allowMissingPrompt: true,
            projectRoot: workspaceDir,
            taskType: "model-fixture-repeat",
            agent: request.route.backend,
            model: request.route.modelId,
            effort: request.route.effort,
            quiet: true,
            dispatcher: (task) =>
              this.dispatcher({
                ...task,
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

      const { stdout: statusOut } = await execFileAsync("git", [
        "-C",
        workspaceDir,
        "status",
        "--porcelain",
      ]);
      const changedFiles = statusOut
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.replace(/^[MADRCU?! ]+\s+/, ""))
        .filter((path) => !path.startsWith(".runs/"));

      if (Array.isArray(fixture.gates?.allowedChangedPaths)) {
        const allowed = new Set(fixture.gates.allowedChangedPaths);
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

      if (
        request.role === "review" &&
        Array.isArray(fixture.gates?.reviewRequiredReopenedTasks)
      ) {
        for (const task of fixture.gates.reviewRequiredReopenedTasks) {
          const reopened =
            taskResult.stdout.includes(task) ||
            (existsSync(join(workspaceDir, "tasks.md")) &&
              (await readFile(join(workspaceDir, "tasks.md"), "utf8")).includes(
                task,
              ));
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
          const forbidden =
            taskResult.stdout.includes(`reopen ${task}`) ||
            taskResult.stdout.includes(`reopened ${task}`);
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

      let sanitizedOutput = taskResult.unwrappedStdout ?? taskResult.stdout;
      const specPath = join(workspaceDir, "spec.md");
      const planPath = join(workspaceDir, "plan.md");
      if (existsSync(specPath) || existsSync(planPath)) {
        const parts: string[] = [];
        if (existsSync(specPath)) {
          parts.push(await readFile(specPath, "utf8"));
        }
        if (existsSync(planPath)) {
          parts.push(await readFile(planPath, "utf8"));
        }
        sanitizedOutput = parts.join("\n\n");
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
        "# Model Judge Prompt\n\nEvaluate blinded options without route metadata.",
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

      const parsed = (execution.output ?? {}) as {
        winner?: "A" | "B" | "tie";
        optionARegression?: boolean;
        optionBRegression?: boolean;
        scores?: { optionA?: number; optionB?: number };
        citations?: {
          inputRef: string;
          outputRef: string;
          gateRef: string;
          claim: string;
        }[];
      };

      return {
        judgeBackend: judge.backend,
        judgeProvider: judge.provider,
        judgeFamily: judge.family,
        judgeModelId: judge.modelId,
        observedJudgeModel,
        winner: parsed.winner ?? "tie",
        optionARegression: Boolean(parsed.optionARegression),
        optionBRegression: Boolean(parsed.optionBRegression),
        scores: {
          optionA: Number(parsed.scores?.optionA ?? 0),
          optionB: Number(parsed.scores?.optionB ?? 0),
        },
        citations: Array.isArray(parsed.citations) ? parsed.citations : [],
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
