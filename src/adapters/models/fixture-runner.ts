/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { type ExecFileOptions, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { isDeepStrictEqual, promisify } from "node:util";
import { z } from "zod";
import {
  type ModelCandidate,
  type ModelRole,
  assertNoSecretMaterial,
} from "../../domain/model-qualification.js";
import { parsePlanMarkdown } from "../../engine/plan-to-tasks.js";
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
  QualificationSuite,
  StructuredJudgeVerdict,
} from "../../ports/model-qualification-port.js";
import {
  type TaskDispatch,
  type TaskResult,
  dispatchToAgent,
} from "../../utils/agent.js";
import { type TaskState, TaskStateSchema } from "../../utils/state.js";
import { repositoryGitEnv } from "../git/process-env.js";

const executeFile = promisify(execFile);
const execFileAsync = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {},
) =>
  executeFile(file, args, {
    timeout: 5000,
    ...options,
    encoding: "utf8",
    env: repositoryGitEnv(process.cwd()),
  });

function isolatedDispatchEnv(root: string): NodeJS.ProcessEnv {
  const env = repositoryGitEnv(root);
  for (const key of Object.keys(process.env)) {
    if (!(key in env)) env[key] = undefined;
  }
  return env;
}

function dispatchCredentials(env: NodeJS.ProcessEnv): string[] {
  const credentialName =
    /(?:^|_)(?:API_?KEY|ACCESS_KEY(?:_ID)?|PRIVATE_KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?)$/i;
  const values: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (value && credentialName.test(name)) values.push(value);
  }
  return values;
}

function normalFailureExitCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as Record<string, unknown>;
  if (failure.signal || failure.killed === true) return null;
  return typeof failure.code === "number" &&
    Number.isInteger(failure.code) &&
    failure.code >= 0
    ? failure.code
    : null;
}

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

const JUDGE_WORKFLOW = "gwrk-model-judge";
const JUDGE_PROMPT = [
  "# Model Judge Prompt",
  "",
  "Evaluate the blinded options. For each citation, copy the `ref` from a fixture input artifact and a gate result artifact. Use `optionA` or `optionB` for the output reference.",
  "Artifact references identify the comparison number, blinded option, repeat index, and artifact number in that order.",
].join("\n");
const JUDGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    intents: { type: "array", maxItems: 0 },
    winner: { type: "string", enum: ["A", "B", "tie"] },
    optionARegression: { type: "boolean" },
    optionBRegression: { type: "boolean" },
    scores: {
      type: "object",
      properties: {
        optionA: { type: "number" },
        optionB: { type: "number" },
      },
      required: ["optionA", "optionB"],
    },
    citations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          inputRef: { type: "string" },
          outputRef: { type: "string" },
          gateRef: { type: "string" },
          claim: { type: "string" },
        },
        required: ["inputRef", "outputRef", "gateRef", "claim"],
      },
    },
  },
  required: [
    "summary",
    "intents",
    "winner",
    "optionARegression",
    "optionBRegression",
    "scores",
    "citations",
  ],
};

const ROLE_WORKFLOWS = {
  define: ["gwrk-specify", "gwrk-plan"],
  implement: ["gwrk-implement"],
  review: ["gwrk-review-code"],
} as const satisfies Record<ModelRole, readonly string[]>;

const DEFINITION_FEATURE = "specs/001-ticket-routing";
const REVIEW_TASK_STATE = `${DEFINITION_FEATURE}/.gwrk/tasks.json`;

const SuiteManifest = z.object({
  fixtures: z.array(
    z.object({ id: z.string().min(1), manifest: z.string().min(1).optional() }),
  ),
  repeats: z.number().int().positive().safe().default(3),
  handoffs: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1),
        planSource: z.enum(["candidate", "fixed"]),
      }),
    )
    .default([]),
});

function stageInput(
  fixture: FixtureManifest,
  workflow: string,
  candidateHandoff = false,
): string {
  if (workflow === "gwrk-implement" && candidateHandoff) {
    const instructions =
      fixture.candidateHandoffPrompt ?? "Complete the implementation.";
    return `Use the generated spec.md and plan.md in the workspace root. ${instructions}`;
  }
  if (workflow === "gwrk-review-code") {
    return `${fixture.reviewPrompt ?? fixture.prompt}\n\nfeature_dir: ${DEFINITION_FEATURE}\nphase_number: 1\nSelect phase-01 in tasks.json.`;
  }
  const scope =
    workflow === "gwrk-specify"
      ? `The feature scaffold is ready. Write only ${DEFINITION_FEATURE}/spec.md. The planning stage will follow.`
      : workflow === "gwrk-plan"
        ? `Read ${DEFINITION_FEATURE}/spec.md from the specification stage. Write ${DEFINITION_FEATURE}/plan.md.`
        : undefined;
  return scope ? `${fixture.prompt}\n\n${scope}` : fixture.prompt;
}

async function seedFiles(
  root: string,
  files: FixtureManifest["files"],
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    const path = join(root, relPath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
    if (
      relPath.startsWith(".specify/scripts/bash/") &&
      relPath.endsWith(".sh")
    ) {
      await chmod(path, 0o755);
    }
  }
}

async function changedFixturePaths(
  workspaceDir: string,
  baselineSha: string,
): Promise<Set<string>> {
  const { stdout: committedChanges } = await execFileAsync("git", [
    "-C",
    workspaceDir,
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    baselineSha,
    "HEAD",
    "--",
  ]);
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
  const { stdout: stagedChanges } = await execFileAsync("git", [
    "-C",
    workspaceDir,
    "diff",
    "--cached",
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
  return new Set(
    `${committedChanges}${trackedChanges}${stagedChanges}${untrackedChanges}`
      .split("\0")
      .filter((path) => path && !path.startsWith(".runs/")),
  );
}

function hasSection(markdown: string, section: string): boolean {
  const lines = markdown.split(/\r?\n/);
  let content = false;
  let fenced = false;
  for (const line of lines) {
    if (/^ {0,3}(?:```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && /^#{1,6}\s+/.test(line)) {
      if (content) break;
      content =
        line
          .replace(/^#{1,6}\s+/, "")
          .trim()
          .toLowerCase() === section.toLowerCase();
      continue;
    }
    if (content && line.trim()) return true;
  }
  return false;
}

function runsProtectedCommand(script: string, command: string): boolean {
  const lines = script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  return (
    lines.at(-1) === command &&
    lines
      .slice(0, -1)
      .every((line) =>
        /^set -[eu]+(?:o pipefail)?$|^set -o pipefail$/.test(line),
      )
  );
}

type ReviewReport = { verdict: string; reopenedTasks: string[] };

function matchesReviewSchema(
  value: unknown,
  schema: Record<string, unknown>,
): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return false;
  if (schema.type === "string") return typeof value === "string";
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    const items = schema.items as Record<string, unknown>;
    return value.every((item) => matchesReviewSchema(item, items));
  }
  if (
    schema.type !== "object" ||
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const properties = schema.properties as Record<
    string,
    Record<string, unknown>
  >;
  const required = (schema.required ?? []) as string[];
  return (
    required.every((key) => Object.hasOwn(record, key)) &&
    Object.entries(properties).every(
      ([key, property]) =>
        !Object.hasOwn(record, key) ||
        matchesReviewSchema(record[key], property),
    )
  );
}

function taskStates(tasks: string | undefined) {
  if (tasks === undefined) return;
  const states = new Map<
    string,
    { open: boolean; line: string; description: string; continuation: string[] }
  >();
  let continuation: string[] | undefined;
  for (const line of tasks.split("\n")) {
    const task =
      /^\s*(?:[-*]\s+)?(?:\[([ xX])\]\s+)?(?:\*\*)?(T\d+)\b(?:\*\*)?[:\s-]*(.*)/.exec(
        line,
      );
    if (!task) {
      continuation?.push(line);
      continue;
    }
    const [, checkbox, id, description] = task;
    if (states.has(id)) return;
    const content = description
      .replace(/^(?:REOPEN(?:ED)?|OPEN)\b[:\s-]*/i, "")
      .replace(/\s*(?:\[REOPENED\]|\(reopened\))\s*$/i, "");
    continuation = [];
    states.set(id, {
      open: checkbox === " " || content !== description,
      line,
      description: content,
      continuation,
    });
  }
  return states;
}

function reviewMarkdownPreserved(
  baseline: string | undefined,
  current: string | undefined,
  expected: ReadonlySet<string>,
  reopenedTasks: Set<string>,
): boolean {
  const before = taskStates(baseline);
  const after = taskStates(current);
  if (!before || !after) return false;

  for (const [id, task] of after) {
    if (task.open && before.get(id)?.open !== true) reopenedTasks.add(id);
  }

  return (
    before.size === after.size &&
    [...after].every(([id, task]) => {
      const original = before.get(id);
      if (!original) return false;
      if (!isDeepStrictEqual(task.continuation, original.continuation))
        return false;
      if (task.line === original.line) return true;
      return (
        !original.open &&
        task.open &&
        expected.has(id) &&
        task.description === original.description
      );
    })
  );
}

function parseCanonicalTasks(
  content: string | undefined,
): TaskState | undefined {
  if (content === undefined) return;
  try {
    const raw = JSON.parse(content);
    if (TaskStateSchema.safeParse(raw).success) return raw as TaskState;
  } catch {
    return undefined;
  }
}

function reviewCanonicalPreserved(
  baseline: string | undefined,
  current: string | undefined,
  expected: ReadonlySet<string>,
  reopenedTasks: Set<string>,
): boolean {
  const before = parseCanonicalTasks(baseline);
  const after = parseCanonicalTasks(current);
  if (!before || !after) return false;

  const originals = new Map(
    before.phases.flatMap(({ tasks }) => tasks.map((task) => [task.id, task])),
  );
  for (const task of after.phases.flatMap(({ tasks }) => tasks)) {
    const original = originals.get(task.id);
    if (original?.status !== "completed" || task.status !== "open") continue;
    reopenedTasks.add(task.id);
    if (!expected.has(task.id)) continue;

    task.status = original.status;
    if (task.completedAt == null && original.completedAt !== undefined) {
      task.completedAt = original.completedAt;
    }
    if (
      task.description.startsWith(
        `${original.description}\n\nREVIEW FAIL (code):`,
      )
    ) {
      task.description = original.description;
    }
  }
  return isDeepStrictEqual(before, after);
}

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
  readonly candidateHandoffPrompt?: string;
  readonly reviewPrompt?: string;
  readonly files: Record<string, string>;
  readonly reviewFiles?: Record<string, string>;
  readonly gates?: {
    readonly command?: readonly string[];
    readonly baselineExitCode?: number;
    readonly candidateExitCode?: number;
    readonly allowedChangedPaths?: readonly string[];
    readonly requiredOutputs?: readonly string[];
    readonly requiredSections?: Readonly<Record<string, readonly string[]>>;
    readonly requiredPlanGateCommand?: string;
    readonly requiredSpecReferences?: readonly string[];
    readonly requiredPlanReferences?: readonly string[];
    readonly reviewRequiredReopenedTasks?: readonly string[];
    readonly reviewForbiddenReopenedTasks?: readonly string[];
  };
}

function filesForRole(fixture: FixtureManifest, role: ModelRole) {
  return role === "review"
    ? { ...fixture.files, ...fixture.reviewFiles }
    : fixture.files;
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
    const suite = SuiteManifest.parse(
      content === undefined ? { fixtures: [] } : JSON.parse(content),
    );
    const manifests = suite.fixtures.map(({ id, manifest }) => ({
      id,
      path: join(this.fixturesDir, manifest ?? join(id, "fixture.json")),
    }));
    return {
      content,
      manifests,
      repeats: suite.repeats,
      handoffs: suite.handoffs,
    };
  }

  async loadSuite(): Promise<QualificationSuite> {
    const { manifests, repeats, handoffs } = await this.readSuite();
    const fixtures = await Promise.all(
      manifests.map(async ({ id, path }) => {
        const manifest = JSON.parse(
          await readFile(path, "utf8"),
        ) as FixtureManifest;
        return { id, roles: manifest.roles };
      }),
    );
    return { fixtures, repeats, handoffs };
  }

  async computeSuiteHashes(): Promise<{
    fixtureSuiteHash: string;
    workflowPromptHashes: Record<string, string>;
  }> {
    const { content, manifests, handoffs } = await this.readSuite();
    const suiteHasher = createHash("sha256").update(content ?? "");
    const fixtures: FixtureManifest[] = [];
    for (const { path } of manifests) {
      const fixture = await readFile(path, "utf8");
      suiteHasher.update(fixture);
      fixtures.push(JSON.parse(fixture) as FixtureManifest);
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

    const runtime = this.workflowRuntime ?? new WorkflowRuntime();
    const workflowPromptHashes: Record<string, string> = {
      [JUDGE_WORKFLOW]: createHash("sha256")
        .update(JSON.stringify([JUDGE_PROMPT, JUDGE_OUTPUT_SCHEMA]))
        .digest("hex"),
    };
    for (const role of Object.keys(ROLE_WORKFLOWS) as ModelRole[]) {
      const roleFixtures = fixtures.filter(({ roles }) => roles.includes(role));
      const stages = ROLE_WORKFLOWS[role];
      const rendered = new Map(
        stages.map((stage) => [stage, [] as string[]] as const),
      );
      for (const fixture of roleFixtures.length > 0
        ? roleFixtures
        : [undefined]) {
        const projectRoot = await mkdtemp(join(tmpdir(), "gwrk-model-prompt-"));
        try {
          if (fixture)
            await seedFiles(projectRoot, filesForRole(fixture, role));
          for (const stage of stages) {
            const inputs = [fixture ? stageInput(fixture, stage) : ""];
            if (
              fixture &&
              stage === "gwrk-implement" &&
              handoffs.some(
                ({ to, planSource }) =>
                  to === fixture.id && planSource === "candidate",
              )
            ) {
              inputs.push(stageInput(fixture, stage, true));
            }
            for (const input of inputs) {
              await runtime.executeWorkflow(stage, input, {
                nativeOnly: true,
                projectRoot,
                quiet: true,
                dispatcher: async ({ stdin }) => {
                  rendered.get(stage)?.push(stdin ?? "");
                  return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
                },
              });
            }
          }
        } finally {
          await rm(projectRoot, { recursive: true, force: true });
        }
      }
      const roleHashes = stages.map((stage) => {
        const hash = createHash("sha256")
          .update(JSON.stringify([rendered.get(stage), governance]))
          .digest("hex");
        workflowPromptHashes[stage] = hash;
        return hash;
      });
      workflowPromptHashes[role] =
        roleHashes.length === 1
          ? roleHashes[0]
          : createHash("sha256")
              .update(JSON.stringify(roleHashes))
              .digest("hex");
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
      await execFileAsync(
        "git",
        ["init", "--quiet", "--initial-branch=develop", workspaceDir],
        {
          timeout: 5000,
        },
      );
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

      const files = filesForRole(fixture, request.role);
      let fixtureInputs = files;
      await seedFiles(workspaceDir, files);
      const featureDir =
        request.role === "define" || request.role === "review"
          ? join(workspaceDir, DEFINITION_FEATURE)
          : workspaceDir;
      if (request.role === "define")
        await mkdir(featureDir, { recursive: true });

      if (request.handoffArtifactDir) {
        const [spec, plan] = await Promise.all([
          readOptionalFile(join(request.handoffArtifactDir, "spec.md")),
          readOptionalFile(join(request.handoffArtifactDir, "plan.md")),
        ]);
        if (!spec?.trim() || !plan?.trim()) {
          return {
            fixtureId: request.fixtureId,
            repeatIndex: request.repeatIndex,
            requestedModel: request.route.modelId,
            observedModel: "unknown",
            deterministicGatesPassed: false,
            fixtureInputs: {},
            gateChecks: [
              ["spec", spec],
              ["plan", plan],
            ]
              .filter(([, content]) => !content?.trim())
              .map(([artifact]) => ({
                checkId: `handoff-${artifact}`,
                passed: false,
                detail: `Candidate handoff ${artifact}.md is missing or blank`,
              })),
            durationMs: 0,
            retries: 0,
            sanitizedOutput: "",
          };
        }
        fixtureInputs = { ...files, "spec.md": spec, "plan.md": plan };
        await Promise.all([
          writeFile(join(workspaceDir, "spec.md"), spec, "utf8"),
          writeFile(join(workspaceDir, "plan.md"), plan, "utf8"),
        ]);
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
        let baselineExitCode: number | null;
        try {
          const [cmd, ...args] = fixture.gates.command;
          await execFileAsync(cmd, args, {
            cwd: workspaceDir,
            timeout: 10_000,
          });
          baselineExitCode = 0;
        } catch (error: unknown) {
          baselineExitCode = normalFailureExitCode(error);
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
      const dispatchEnv = isolatedDispatchEnv(workspaceDir);
      const knownSecrets = dispatchCredentials(dispatchEnv);
      const specPath = join(featureDir, "spec.md");
      let specifiedSpec: string | undefined;
      let observedModel = "unknown";
      let definitionDurationMs = 0;
      let implementationStart: number | undefined;
      let implementationDuration: number | undefined;
      let taskResult: TaskResult = {
        exitCode: 1,
        stdout: "",
        stderr: "",
        durationS: 0,
        status: "failure",
      };
      for (const workflow of ROLE_WORKFLOWS[request.role]) {
        try {
          const execution = await runtime.executeWorkflow(
            workflow,
            stageInput(fixture, workflow, Boolean(request.handoffArtifactDir)),
            {
              nativeOnly: true,
              projectRoot: workspaceDir,
              featureDir,
              taskType: "model-fixture-repeat",
              agent: request.route.backend,
              model: request.route.modelId,
              effort: request.route.effort,
              quiet: true,
              dispatcher: (task) => {
                if (request.role === "implement")
                  implementationStart = performance.now();
                return this.dispatcher({
                  ...task,
                  env: dispatchEnv,
                  effort: request.route.effort,
                  routeMode: "pinned",
                  timeoutMs: this.timeoutMs,
                  logPath: join(workspaceDir, ".runs", "repeat.log"),
                  includeExternalContext: false,
                });
              },
            },
          );
          taskResult = execution.taskResult;
        } catch (error) {
          taskResult = {
            exitCode: 1,
            stdout: "",
            stderr:
              error instanceof Error
                ? error.message
                : "Workflow dispatch failed",
            durationS: 0,
            status: "failure",
          };
        }
        if (request.role === "define") {
          definitionDurationMs +=
            taskResult.durationMs ?? taskResult.durationS * 1000;
        }
        const reportedModel = taskResult.observedModel;
        if (reportedModel && reportedModel !== "unknown") {
          if (
            observedModel === "unknown" ||
            observedModel === request.route.modelId
          ) {
            observedModel = reportedModel;
          }
          if (reportedModel !== request.route.modelId) {
            gateChecks.push({
              checkId: "fixture-route-identity",
              passed: false,
              detail: `${workflow} requested ${request.route.modelId} and reported ${reportedModel}`,
            });
          }
        }
        const dispatched =
          taskResult.exitCode === 0 &&
          taskResult.status !== "failure" &&
          !taskResult.timedOut;
        gateChecks.push({
          checkId: `dispatch-${workflow}`,
          passed: dispatched,
          detail: dispatched
            ? "Workflow completed"
            : `Workflow exit ${taskResult.exitCode}, status ${taskResult.status ?? "unknown"}, timed out ${taskResult.timedOut === true}`,
        });
        if (workflow === "gwrk-specify") {
          const spec = await readOptionalFile(specPath);
          const plan = await readOptionalFile(join(featureDir, "plan.md"));
          const passed = Boolean(spec?.trim()) && plan === undefined;
          gateChecks.push({
            checkId: "specify-output",
            passed,
            detail: passed
              ? "Specification produced before planning"
              : "Specification must produce a nonempty spec and leave the plan to the planning stage",
          });
          if (!dispatched || !passed) break;
          specifiedSpec = spec;
        }
        if (workflow === "gwrk-plan") {
          const plannedSpec = await readOptionalFile(specPath);
          const passed =
            specifiedSpec !== undefined && plannedSpec === specifiedSpec;
          gateChecks.push({
            checkId: "plan-preserves-spec",
            passed,
            detail: passed
              ? "Planning preserved spec.md"
              : "Planning changed or removed the specification from gwrk-specify",
          });
        }
      }

      const changedFiles = await changedFixturePaths(workspaceDir, baselineSha);

      if (request.role === "implement") {
        if (fixture.gates?.command) {
          let candidateExitCode: number | null;
          try {
            const [cmd, ...args] = fixture.gates.command;
            await execFileAsync(cmd, args, {
              cwd: workspaceDir,
              timeout: 10_000,
            });
            candidateExitCode = 0;
          } catch (error: unknown) {
            candidateExitCode = normalFailureExitCode(error);
          }
          if (implementationStart !== undefined) {
            implementationDuration = performance.now() - implementationStart;
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
          for (const path of await changedFixturePaths(
            workspaceDir,
            baselineSha,
          )) {
            changedFiles.add(path);
          }
        }
      } else if (request.role === "review") {
        if (fixture.gates?.command) {
          let reviewExitCode: number | null;
          try {
            const [cmd, ...args] = fixture.gates.command;
            await execFileAsync(cmd, args, {
              cwd: workspaceDir,
              timeout: 10_000,
            });
            reviewExitCode = 0;
          } catch (error: unknown) {
            reviewExitCode = normalFailureExitCode(error);
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

      const allowedChangedPaths =
        request.role === "review"
          ? ["tasks.md", REVIEW_TASK_STATE]
          : fixture.gates?.allowedChangedPaths;
      if (allowedChangedPaths) {
        const allowed = new Set(allowedChangedPaths);
        const forbidden = [...changedFiles].filter(
          (path) => !allowed.has(path),
        );
        gateChecks.push({
          checkId: "forbidden-file-mutation",
          passed: forbidden.length === 0,
          detail:
            forbidden.length === 0
              ? "All changed paths permitted"
              : `Forbidden file mutations: ${forbidden.join(", ")}`,
        });
      }

      if (Array.isArray(fixture.gates?.requiredOutputs)) {
        for (const file of fixture.gates.requiredOutputs) {
          const target = join(featureDir, file);
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
        const specPath = join(featureDir, "spec.md");
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
        const planPath = join(featureDir, "plan.md");
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

      for (const [file, sections] of Object.entries(
        fixture.gates?.requiredSections ?? {},
      )) {
        const markdown = (await readOptionalFile(join(featureDir, file))) ?? "";
        for (const section of sections) {
          const passed = hasSection(markdown, section);
          gateChecks.push({
            checkId: `required-section-${file}-${section.toLowerCase().replace(/\s+/g, "-")}`,
            passed,
            detail: passed
              ? `${file} contains ${section}`
              : `${file} requires a nonempty ${section} section`,
          });
        }
      }

      const requiredPlanGate = fixture.gates?.requiredPlanGateCommand;
      if (requiredPlanGate) {
        const plan =
          (await readOptionalFile(join(featureDir, "plan.md"))) ?? "";
        const phases = parsePlanMarkdown(plan);
        const passed =
          phases.length > 0 &&
          phases.every(
            ({ gateScript }) =>
              gateScript !== undefined &&
              runsProtectedCommand(gateScript, requiredPlanGate),
          );
        gateChecks.push({
          checkId: "executable-plan-gate",
          passed,
          detail: passed
            ? "Plan gates run the protected routing test"
            : `Each phase needs a fenced Bash gate that runs ${requiredPlanGate}`,
        });
      }

      const reopenedTasks = new Set<string>();
      let validatedReviewReport: ReviewReport | undefined;
      if (request.role === "review") {
        let report: ReviewReport | undefined;
        try {
          const { outputSchema } = await runtime.resolveWorkflow(
            "gwrk-review-code",
            workspaceDir,
          );
          const parsed =
            taskResult.structuredOutput !== undefined
              ? taskResult.structuredOutput
              : extractJsonFromOutput(
                  taskResult.unwrappedStdout ?? taskResult.stdout,
                );
          if (matchesReviewSchema(parsed, outputSchema)) {
            report = parsed as ReviewReport;
            validatedReviewReport = report;
          }
        } catch {
          // Review output is required even when the workspace changed.
        }
        gateChecks.push({
          checkId: "review-report",
          passed: report !== undefined,
          detail: report
            ? "Review report matches the workflow schema"
            : "Review report violates the workflow schema",
        });
        gateChecks.push({
          checkId: "review-verdict",
          passed: report?.verdict === "NO-GO",
          detail: "The seeded routing defect requires a NO-GO verdict",
        });
        for (const task of report?.reopenedTasks ?? []) reopenedTasks.add(task);

        const expected = new Set(fixture.gates?.reviewRequiredReopenedTasks);
        const [currentMarkdown, currentCanonical] = await Promise.all([
          readOptionalFile(join(workspaceDir, "tasks.md")),
          readOptionalFile(join(workspaceDir, REVIEW_TASK_STATE)),
        ]);
        const markdownPreserved = reviewMarkdownPreserved(
          files["tasks.md"],
          currentMarkdown,
          expected,
          reopenedTasks,
        );
        const canonicalPreserved = reviewCanonicalPreserved(
          files[REVIEW_TASK_STATE],
          currentCanonical,
          expected,
          reopenedTasks,
        );
        gateChecks.push({
          checkId: "review-task-state",
          passed: markdownPreserved && canonicalPreserved,
          detail: `Task preservation in tasks.md: ${markdownPreserved}, canonical tasks.json: ${canonicalPreserved}`,
        });
        const baselineTasks = taskStates(files["tasks.md"]);
        const unexpected = [...reopenedTasks].filter(
          (task) => !baselineTasks?.has(task) || !expected.has(task),
        );
        gateChecks.push({
          checkId: "review-reopened-task-ids",
          passed: unexpected.length === 0,
          detail:
            unexpected.length === 0
              ? "Reopenings are valid fixture tasks"
              : `Unexpected task reopenings: ${unexpected.join(", ")}`,
        });
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

      const definitionArtifacts =
        request.role === "define"
          ? await Promise.all(
              ["spec.md", "plan.md"].map(async (file) => ({
                file,
                content: await readOptionalFile(join(featureDir, file)),
              })),
            )
          : [];
      let sanitizedOutput: string;
      if (request.role === "define") {
        sanitizedOutput = definitionArtifacts
          .map(({ content }) => content)
          .filter((content) => content !== undefined)
          .join("\n\n");
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
        if (validatedReviewReport) {
          sanitizedOutput += `\n\n## Validated review report\n${JSON.stringify(validatedReviewReport)}`;
        }
      }

      const evidence: FixtureRepeatEvidence = {
        fixtureId: request.fixtureId,
        repeatIndex: request.repeatIndex,
        requestedModel: request.route.modelId,
        observedModel,
        deterministicGatesPassed,
        fixtureInputs,
        gateChecks,
        durationMs:
          request.role === "define"
            ? definitionDurationMs
            : (implementationDuration ??
              taskResult.durationMs ??
              taskResult.durationS * 1000),
        retries: 0,
        sanitizedOutput,
      };
      assertNoSecretMaterial(evidence, knownSecrets);

      if (request.role === "define" && request.artifactOutputDir) {
        await mkdir(request.artifactOutputDir, { recursive: true });
        for (const { file, content } of definitionArtifacts) {
          const destination = join(request.artifactOutputDir, file);
          if (content === undefined) {
            await rm(destination, { force: true });
          } else {
            await writeFile(destination, content, "utf8");
          }
        }
      }
      return evidence;
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
      JUDGE_WORKFLOW,
    );

    try {
      const dispatchEnv = isolatedDispatchEnv(judgeDir);
      const knownSecrets = dispatchCredentials(dispatchEnv);
      assertNoSecretMaterial(packet, knownSecrets);
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
        `name: ${JUDGE_WORKFLOW}`,
        "version: 0.1.0",
        "description: Blinded two-judge evaluation",
        "enforceOutputSchema: true",
        "prompt: PROMPT.md",
        `outputSchema: ${JSON.stringify(JUDGE_OUTPUT_SCHEMA)}`,
      ].join("\n");

      await writeFile(join(workflowDir, "manifest.yaml"), manifestYaml, "utf8");
      await writeFile(join(workflowDir, "PROMPT.md"), JUDGE_PROMPT, "utf8");

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
        JUDGE_WORKFLOW,
        judgePromptInput,
        {
          projectRoot: judgeDir,
          reportOnly: true,
          agent: judge.backend,
          model: judge.modelId,
          effort: judge.effort,
          quiet: true,
          dispatcher: async (task) => {
            let tr: TaskResult;
            try {
              tr = await this.dispatcher({
                ...task,
                env: dispatchEnv,
                effort: judge.effort,
                routeMode: "pinned",
                timeoutMs: this.timeoutMs,
                logPath: join(judgeDir, ".runs", "judge.log"),
                includeExternalContext: false,
              });
            } catch (error) {
              const visited = new Set<Error>();
              const pending: unknown[] = [error];
              while (pending.length > 0) {
                const diagnostic = pending.pop();
                if (diagnostic instanceof Error) {
                  if (visited.has(diagnostic)) continue;
                  visited.add(diagnostic);
                  assertNoSecretMaterial(
                    { message: diagnostic.message, stack: diagnostic.stack },
                    knownSecrets,
                  );
                  pending.push(diagnostic.cause);
                  if (diagnostic instanceof AggregateError)
                    pending.push(...diagnostic.errors);
                } else {
                  assertNoSecretMaterial(diagnostic, knownSecrets);
                }
              }
              throw error;
            }
            assertNoSecretMaterial(tr, knownSecrets);
            if (tr.timedOut === true)
              throw new Error("Judge dispatch timed out");
            observedJudgeModel = tr.observedModel ?? "unknown";
            return tr;
          },
        },
      );

      const parsed = JudgeOutput.parse(execution.output);

      const verdict: StructuredJudgeVerdict = {
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
      assertNoSecretMaterial(verdict, knownSecrets);
      return verdict;
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
