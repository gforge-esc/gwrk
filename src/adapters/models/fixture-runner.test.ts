/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelCandidate } from "../../domain/model-qualification.js";
import type { JudgeVerdictPacket } from "../../ports/model-qualification-port.js";
import type { TaskDispatch, TaskResult } from "../../utils/agent.js";
import { FixtureRunner, createFixtureRunner } from "./fixture-runner.js";

const candidateRoute = {
  backend: "test-backend",
  modelId: "test-model-v1",
  effort: "low",
};

const fixedPassingQueueImplementation = `export function selectQueue({ priority, receivedAtMs = 0, nowMs = 0 }) {
  const normalized = typeof priority === "string" ? priority.trim() : "";
  const rawPriority = priority;
  if (normalized !== "high" && normalized !== "normal") {
    return { queue: "triage", rawPriority };
  }
  if (normalized === "high") {
    return { queue: "urgent", rawPriority };
  }
  const ageMs = Math.max(0, nowMs - receivedAtMs);
  const thirtyMinutes = 30 * 60_000;
  if (ageMs >= thirtyMinutes) {
    return { queue: "urgent", rawPriority };
  }
  return { queue: "standard", rawPriority };
}
`;

describe("fixture runner adapter", () => {
  it.each(["seeded", "import clock", "call clock", "pure"])(
    "enforces behavior and clock purity for the %s implementation",
    async (variant) => {
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        if (variant !== "seeded") {
          const implementation =
            variant === "import clock"
              ? `const fallback = Date.now();\n${fixedPassingQueueImplementation.replace("nowMs = 0", "nowMs = fallback")}`
              : variant === "call clock"
                ? fixedPassingQueueImplementation.replace(
                    "const ageMs =",
                    "const fallback = Date.now();\n  nowMs ??= fallback;\n  const ageMs =",
                  )
                : fixedPassingQueueImplementation;
          writeFileSync(
            join(task.workDir!, "src/domain/select-queue.mjs"),
            implementation,
          );
        }
        return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
      };
      const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
        {
          fixtureId: "implement-seeded-defect",
          role: "implement",
          repeatIndex: 0,
          route: candidateRoute,
        },
      );
      expect(result.gateChecks).toContainEqual(
        expect.objectContaining({ checkId: "baseline-gate", passed: true }),
      );
      expect(result.gateChecks).toContainEqual(
        expect.objectContaining({
          checkId: "candidate-gate",
          passed: variant === "pure",
        }),
      );
    },
  );

  it("measures implementation through the candidate gate", async () => {
    const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
      writeFileSync(
        join(task.workDir!, "src/domain/select-queue.mjs"),
        `await new Promise((resolve) => setTimeout(resolve, 125));\n${fixedPassingQueueImplementation}`,
      );
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        durationS: 0,
        durationMs: 1,
      };
    };
    const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });
    expect(result.deterministicGatesPassed).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(125);
  });

  it.each([
    { verdict: "GO", reopenedTasks: ["T001"], intents: [] },
    { verdict: "NO-GO", reopenedTasks: ["T001", "T999"], intents: [] },
    { verdict: "NO-GO", reopenedTasks: ["T001", "T002"], intents: [] },
    { verdict: "NO-GO", reopenedTasks: ["T001", 42], intents: [] },
    {
      verdict: "NO-GO",
      reopenedTasks: ["T001"],
      intents: [{ action: "INVALID" }],
    },
  ])("rejects an invalid review report %j", async (report) => {
    const dispatcher = async (): Promise<TaskResult> => ({
      exitCode: 0,
      stdout: JSON.stringify({ summary: "Routing defect", ...report }),
      stderr: "",
      durationS: 0,
    });
    const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "review",
      repeatIndex: 0,
      route: candidateRoute,
    });
    expect(result.deterministicGatesPassed).toBe(false);
  });

  it("proves baseline RED and candidate GREEN execution", async () => {
    const dispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        const queueFile = join(task.workDir!, "src/domain/select-queue.mjs");
        expect(existsSync(queueFile)).toBe(true);
        writeFileSync(queueFile, fixedPassingQueueImplementation, "utf8");

        return {
          exitCode: 0,
          stdout: "Repaired queue routing logic",
          stderr: "",
          durationS: 0,
          durationMs: 150,
          observedModel: "test-model-v1",
        };
      },
    );

    const runner = createFixtureRunner({ dispatcher, timeoutMs: 5000 });
    const evidence = await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(evidence.deterministicGatesPassed).toBe(true);
    expect(evidence.observedModel).toBe("test-model-v1");

    const baselineCheck = evidence.gateChecks.find(
      (c) => c.checkId === "baseline-gate",
    );
    expect(baselineCheck?.passed).toBe(true);
    expect(baselineCheck?.detail).toContain(
      "Baseline exit code matched expected 1",
    );

    const candidateCheck = evidence.gateChecks.find(
      (c) => c.checkId === "candidate-gate",
    );
    expect(candidateCheck?.passed).toBe(true);
    expect(candidateCheck?.detail).toContain(
      "Candidate command exited with expected code 0",
    );
  });

  it.each([
    { variant: "reference lists", expectedCheck: "required-section" },
    { variant: "bare command", expectedCheck: "executable-plan-gate" },
    { variant: "echoed command", expectedCheck: "executable-plan-gate" },
    { variant: "failed dispatch", expectedCheck: "dispatch-gwrk-plan" },
    { variant: "failure status", expectedCheck: "dispatch-gwrk-plan" },
    { variant: "timed out dispatch", expectedCheck: "dispatch-gwrk-plan" },
    { variant: "valid plan", expectedCheck: undefined },
  ])(
    "checks definition produced with $variant",
    async ({ variant, expectedCheck }) => {
      const calls: TaskDispatch[] = [];
      const specReferences =
        "ADR-001 ADR-002 docs/refs/queue-contract.md docs/research/routing-brief.md docs/refs/acceptance.md";
      const gateCommand = "node --test src/domain/select-queue.test.mjs";
      const spec =
        variant === "reference lists"
          ? specReferences
          : `# Ticket routing spec\n\n## Requirements\n${specReferences}\n\n## Acceptance scenarios\nRoute unknown priorities to triage.\n\n## Testing requirements\nExercise the 30-minute cutoff.\n`;
      const command =
        variant === "echoed command" ? `echo "${gateCommand}"` : gateCommand;
      const planGate =
        variant === "bare command"
          ? gateCommand
          : ["```bash", "set -euo pipefail", command, "```"].join("\n");
      const plan =
        variant === "reference lists"
          ? "src/domain/select-queue.mjs src/domain/select-queue.test.mjs node --test"
          : [
              "# Ticket routing plan",
              "",
              "## Approach",
              "Repair src/domain/select-queue.mjs and run src/domain/select-queue.test.mjs.",
              "",
              "### Phase 1: Repair queue selection",
              "#### Done When",
              planGate,
            ].join("\n");
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        const root = task.workDir!;
        calls.push(task);
        const featureDir = task.featureDir!;
        if (task.workflow === "gwrk-specify") {
          expect(
            execFileSync("git", ["branch", "--show-current"], {
              cwd: root,
              encoding: "utf8",
            }).trim(),
          ).toBe("develop");
          expect(
            existsSync(join(root, ".specify/templates/spec-template.md")),
          ).toBe(true);
          const scaffold = JSON.parse(
            execFileSync(
              ".specify/scripts/bash/create-new-feature.sh",
              [
                "--json",
                "Ticket routing",
                "--number",
                "1",
                "--short-name",
                "ticket-routing",
              ],
              { cwd: root, encoding: "utf8" },
            ),
          );
          expect(scaffold.SPEC_FILE).toBe(
            join(realpathSync(featureDir), "spec.md"),
          );
          expect(existsSync(scaffold.SPEC_FILE)).toBe(false);
          writeFileSync(scaffold.SPEC_FILE, spec);
        } else {
          const prerequisites = JSON.parse(
            execFileSync(
              ".specify/scripts/bash/check-prerequisites.sh",
              ["--json"],
              { cwd: root, encoding: "utf8" },
            ),
          );
          expect(prerequisites.FEATURE_DIR).toBe(realpathSync(featureDir));
          expect(readFileSync(join(featureDir, "spec.md"), "utf8")).toBe(spec);
          expect(
            existsSync(join(root, ".specify/templates/plan-template.md")),
          ).toBe(true);
          writeFileSync(join(featureDir, "plan.md"), plan);
        }
        if (task.workflow === "gwrk-plan" && variant === "failed dispatch") {
          return {
            exitCode: 1,
            status: "failure",
            stdout: "Files written",
            stderr: "",
            durationS: 0,
          };
        }
        if (task.workflow === "gwrk-plan" && variant === "failure status") {
          return {
            exitCode: 0,
            status: "failure",
            stdout: "Files written",
            stderr: "",
            durationS: 0,
          };
        }
        if (task.workflow === "gwrk-plan" && variant === "timed out dispatch") {
          return {
            exitCode: 0,
            timedOut: true,
            stdout: "Files written",
            stderr: "",
            durationS: 0,
          };
        }
        return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
      };
      const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
        {
          fixtureId: "define-long-context",
          role: "define",
          repeatIndex: 0,
          route: candidateRoute,
        },
      );
      expect(
        result.deterministicGatesPassed,
        JSON.stringify(result.gateChecks),
      ).toBe(expectedCheck === undefined);
      if (expectedCheck) {
        expect(
          result.gateChecks.some(
            ({ checkId, passed }) =>
              checkId.startsWith(expectedCheck) && !passed,
          ),
        ).toBe(true);
      }
      expect(result.sanitizedOutput).toContain(spec);
      expect(result.sanitizedOutput).toContain(plan);
      expect(calls.map(({ workflow }) => workflow)).toEqual([
        "gwrk-specify",
        "gwrk-plan",
      ]);
      expect(calls[0].featureDir).toBeDefined();
      expect(calls[1].featureDir).toBe(calls[0].featureDir);
      expect(calls[0].stdin).toContain("# /gwrk-specify");
      expect(calls[1].stdin).toContain("# /gwrk-plan");
    },
  );

  it("rejects candidate when forbidden files are mutated", async () => {
    const dispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        const queueFile = join(task.workDir!, "src/domain/select-queue.mjs");
        writeFileSync(queueFile, fixedPassingQueueImplementation, "utf8");

        const forbiddenFile = join(task.workDir!, "AGENTS.md");
        writeFileSync(forbiddenFile, "# Mutated project rules\n", "utf8");

        return {
          exitCode: 0,
          stdout: "Modified forbidden AGENTS.md",
          stderr: "",
          durationS: 0,
          durationMs: 100,
          observedModel: "test-model-v1",
        };
      },
    );

    const runner = new FixtureRunner({ dispatcher });
    const evidence = await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 1,
      route: candidateRoute,
    });

    expect(evidence.deterministicGatesPassed).toBe(false);

    const forbiddenCheck = evidence.gateChecks.find(
      (c) => c.checkId === "forbidden-file-mutation",
    );
    expect(forbiddenCheck?.passed).toBe(false);
    expect(forbiddenCheck?.detail).toContain("AGENTS.md");
  });

  it("rejects forbidden mutations committed before the model returns", async () => {
    const dispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        const cwd = task.workDir!;
        writeFileSync(
          join(cwd, "src/domain/select-queue.mjs"),
          fixedPassingQueueImplementation,
        );
        writeFileSync(join(cwd, "AGENTS.md"), "Changed governance\n");
        execFileSync(
          "git",
          ["add", "src/domain/select-queue.mjs", "AGENTS.md"],
          { cwd },
        );
        execFileSync(
          "git",
          [
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "-m",
            "Commit changes",
          ],
          { cwd },
        );
        return {
          exitCode: 0,
          stdout: "Completed",
          stderr: "",
          durationS: 0,
          observedModel: "test-model-v1",
        };
      },
    );
    const evidence = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
      {
        fixtureId: "implement-seeded-defect",
        role: "implement",
        repeatIndex: 0,
        route: candidateRoute,
      },
    );
    expect(evidence.deterministicGatesPassed).toBe(false);
    expect(
      evidence.gateChecks.find(
        ({ checkId }) => checkId === "forbidden-file-mutation",
      ),
    ).toMatchObject({
      passed: false,
      detail: expect.stringContaining("AGENTS.md"),
    });
  });

  it.each([undefined, " \n"])(
    "fails the handoff gate before dispatch for plan %s",
    async (plan) => {
      const handoff = await mkdtemp(join(tmpdir(), "gwrk-missing-plan-"));
      const dispatcher = vi.fn();
      try {
        if (plan !== undefined) await writeFile(join(handoff, "plan.md"), plan);
        const evidence = await createFixtureRunner({
          dispatcher,
        }).runFixtureRepeat({
          fixtureId: "implement-seeded-defect",
          role: "implement",
          repeatIndex: 0,
          route: candidateRoute,
          handoffArtifactDir: handoff,
        });
        expect(evidence.deterministicGatesPassed).toBe(false);
        expect(evidence.gateChecks).toContainEqual(
          expect.objectContaining({
            checkId: "handoff-plan",
            passed: false,
          }),
        );
        expect(dispatcher).not.toHaveBeenCalled();
      } finally {
        await rm(handoff, { recursive: true, force: true });
      }
    },
  );

  it("proves fixed-plan and candidate-plan handoffs", async () => {
    let observedFixedPlan = "";
    const fixedDispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        const planFile = join(task.workDir!, "plan.md");
        observedFixedPlan = readFileSync(planFile, "utf8");
        return {
          exitCode: 0,
          stdout: "Executed with fixed plan",
          stderr: "",
          durationS: 0,
          durationMs: 50,
        };
      },
    );

    const runnerFixed = new FixtureRunner({ dispatcher: fixedDispatcher });
    await runnerFixed.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(observedFixedPlan).toContain("Ticket routing repair");
    expect(observedFixedPlan).toContain(
      "Implement the acceptance rules in the existing pure domain function",
    );

    const handoffDir = await mkdtemp(join(tmpdir(), "gwrk-candidate-handoff-"));
    try {
      await writeFile(
        join(handoffDir, "plan.md"),
        "# Candidate Generated Plan\n\nRepair selectQueue function directly.\n",
        "utf8",
      );

      let observedCandidatePlan = "";
      const candidateDispatcher = vi.fn(
        async (task: TaskDispatch): Promise<TaskResult> => {
          const planFile = join(task.workDir!, "plan.md");
          observedCandidatePlan = readFileSync(planFile, "utf8");
          return {
            exitCode: 0,
            stdout: "Executed with candidate plan",
            stderr: "",
            durationS: 0,
            durationMs: 50,
          };
        },
      );

      const runnerCandidate = new FixtureRunner({
        dispatcher: candidateDispatcher,
      });
      await runnerCandidate.runFixtureRepeat({
        fixtureId: "implement-seeded-defect",
        role: "implement",
        repeatIndex: 0,
        route: candidateRoute,
        handoffArtifactDir: handoffDir,
      });

      expect(observedCandidatePlan).toContain("Candidate Generated Plan");
      expect(observedCandidatePlan).toContain(
        "Repair selectQueue function directly",
      );
    } finally {
      await rm(handoffDir, { recursive: true, force: true });
    }
  });

  it("enforces bounded dispatch and handles timeout", async () => {
    let capturedTimeout: number | undefined;
    const dispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        capturedTimeout = task.timeoutMs;
        return {
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          durationS: 0,
          durationMs: 10,
        };
      },
    );

    const runner = createFixtureRunner({ dispatcher, timeoutMs: 1500 });
    await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(capturedTimeout).toBe(1500);
  });

  it("runs report-only judge comparisons with sanitized packets without live provider calls", async () => {
    const judge: ModelCandidate = {
      backend: "frontier-judge-cli",
      provider: "frontier-provider",
      family: "frontier-family",
      modelId: "frontier-judge-v1",
      effort: "high",
    };

    const packet: JudgeVerdictPacket = {
      comparisonId: "eval-blinded-42",
      role: "implement",
      fixtureSummary: "Synthetic evaluation for ticket routing repair",
      optionA: "Clean pure domain queue selection function implementation",
      optionB: "Incomplete queue selection function without triage handling",
      gateEvidenceSummary: "Option A passed all deterministic gates",
    };

    const judgeDispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        expect(task.workflow).toBe("gwrk-model-judge");
        expect(task.agent).toBe(judge.backend);
        expect(task.model).toBe(judge.modelId);
        expect(task.effort).toBe(judge.effort);
        expect(task.stdin).toContain("Comparison ID: eval-blinded-42");
        expect(task.stdin).toContain("Option A:");
        expect(task.stdin).toContain("Option B:");

        const judgeOutput = {
          summary: "Blinded comparison verdict",
          intents: [],
          winner: "A",
          optionARegression: false,
          optionBRegression: true,
          scores: { optionA: 96, optionB: 40 },
          citations: [
            {
              inputRef: "implement-seeded-defect",
              outputRef: "optionA",
              gateRef: "behavior",
              claim: "Option A resolves all boundary conditions correctly",
            },
          ],
        };

        return {
          exitCode: 0,
          stdout: JSON.stringify(judgeOutput),
          stderr: "",
          durationS: 0,
          durationMs: 250,
          observedModel: "frontier-judge-v1",
        };
      },
    );

    const runner = createFixtureRunner({ dispatcher: judgeDispatcher });
    const verdict = await runner.judgeComparison(judge, packet);

    expect(judgeDispatcher).toHaveBeenCalledTimes(1);
    expect(verdict).toEqual({
      judgeBackend: "frontier-judge-cli",
      judgeProvider: "frontier-provider",
      judgeFamily: "frontier-family",
      judgeModelId: "frontier-judge-v1",
      observedJudgeModel: "frontier-judge-v1",
      winner: "A",
      optionARegression: false,
      optionBRegression: true,
      scores: { optionA: 96, optionB: 40 },
      citations: [
        {
          inputRef: "implement-seeded-defect",
          outputRef: "optionA",
          gateRef: "behavior",
          claim: "Option A resolves all boundary conditions correctly",
        },
      ],
    });
  });

  it.each([
    { label: "null packet", output: null },
    { label: "null regression flag", output: { optionARegression: null } },
    { label: "string regression flag", output: { optionBRegression: "false" } },
    {
      label: "string score",
      output: { scores: { optionA: "99", optionB: 40 } },
    },
    { label: "null score", output: { scores: { optionA: null, optionB: 40 } } },
    { label: "unknown winner", output: { winner: "candidate" } },
  ])("rejects $label without coercing judge evidence", async ({ output }) => {
    const valid = {
      summary: "Evidence-backed comparison",
      intents: [],
      winner: "A",
      optionARegression: false,
      optionBRegression: true,
      scores: { optionA: 99, optionB: 40 },
      citations: [
        {
          inputRef: "fixture",
          outputRef: "optionA",
          gateRef: "behavior",
          claim: "Passed",
        },
      ],
    };
    const dispatcher = vi.fn(
      async (): Promise<TaskResult> => ({
        exitCode: 0,
        stdout: JSON.stringify(
          output === null ? null : { ...valid, ...output },
        ),
        stderr: "",
        durationS: 0,
        observedModel: "judge-v1",
      }),
    );
    const runner = createFixtureRunner({ dispatcher });
    await expect(
      runner.judgeComparison(
        {
          backend: "fixture",
          provider: "fixture",
          family: "judge",
          modelId: "judge-v1",
          effort: "high",
        },
        {
          comparisonId: "blinded",
          role: "implement",
          fixtureSummary: "Fixture",
          optionA: "A",
          optionB: "B",
          gateEvidenceSummary: "Both passed",
        },
      ),
    ).rejects.toThrow();
  });

  it("hashes a fixture at its declared manifest path", async () => {
    const fixturesDir = await mkdtemp(join(tmpdir(), "gwrk-manifest-hash-"));
    try {
      await writeFile(
        join(fixturesDir, "suite.json"),
        JSON.stringify({
          fixtures: [{ id: "alias", manifest: "alternative.json" }],
        }),
      );
      const manifest = {
        id: "alias",
        roles: ["implement"],
        prompt: "Original governance",
        files: { "AGENTS.md": "Original rules" },
      };
      const manifestPath = join(fixturesDir, "alternative.json");
      await writeFile(manifestPath, JSON.stringify(manifest));
      const runner = createFixtureRunner({ fixturesDir });
      const before = await runner.computeSuiteHashes();
      await writeFile(
        manifestPath,
        JSON.stringify({
          ...manifest,
          files: { "AGENTS.md": "Changed rules" },
        }),
      );
      const after = await runner.computeSuiteHashes();
      expect(after.fixtureSuiteHash).not.toBe(before.fixtureSuiteHash);
    } finally {
      await rm(fixturesDir, { recursive: true, force: true });
    }
  });

  it("loads and dispatches the fixture at its declared manifest path", async () => {
    const fixturesDir = await mkdtemp(
      join(tmpdir(), "gwrk-manifest-dispatch-"),
    );
    try {
      await writeFile(
        join(fixturesDir, "suite.json"),
        JSON.stringify({
          fixtures: [{ id: "alias", manifest: "alternative.json" }],
        }),
      );
      await writeFile(
        join(fixturesDir, "alternative.json"),
        JSON.stringify({
          id: "alias",
          roles: ["define"],
          prompt: "Distinct manifest prompt",
          files: { "README.md": "Synthetic fixture" },
        }),
      );
      const dispatcher = vi.fn(
        async (_task: TaskDispatch): Promise<TaskResult> => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationS: 0,
        }),
      );
      const runner = createFixtureRunner({ fixturesDir, dispatcher });

      expect(await runner.loadSuite()).toEqual({
        fixtures: [{ id: "alias", roles: ["define"] }],
        repeats: 3,
        handoffs: [],
      });
      await runner.runFixtureRepeat({
        fixtureId: "alias",
        role: "define",
        repeatIndex: 0,
        route: candidateRoute,
      });
      expect(dispatcher.mock.calls[0][0].stdin).toContain(
        "Distinct manifest prompt",
      );
    } finally {
      await rm(fixturesDir, { recursive: true, force: true });
    }
  });

  it("invalidates workflow hashes when project governance changes", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "gwrk-governance-hash-"));
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
    try {
      const runner = createFixtureRunner();
      let previous = await runner.computeSuiteHashes();
      for (const path of [
        "AGENTS.md",
        ".gwrk/decisions/index.md",
        ".gwrk/rules/workspace.md",
      ]) {
        const file = join(projectRoot, path);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, "Initial rules");
        const initial = await runner.computeSuiteHashes();
        expect(initial.workflowPromptHashes).not.toEqual(
          previous.workflowPromptHashes,
        );
        await writeFile(file, "Updated rules");
        const updated = await runner.computeSuiteHashes();
        expect(updated.workflowPromptHashes).not.toEqual(
          initial.workflowPromptHashes,
        );
        expect(updated.fixtureSuiteHash).toBe(previous.fixtureSuiteHash);
        previous = updated;
      }
    } finally {
      cwd.mockRestore();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it.each(["gwrk-specify", "gwrk-plan"])(
    "hashes the expanded %s prompt from the fixture workflow resolution",
    async (changedWorkflow) => {
      const fixturesDir = await mkdtemp(
        join(tmpdir(), "gwrk-definition-prompt-"),
      );
      try {
        await writeFile(
          join(fixturesDir, "suite.json"),
          JSON.stringify({
            repeats: 4,
            fixtures: [{ id: "custom-define", manifest: "alternative.json" }],
            handoffs: [],
          }),
        );
        const files = Object.fromEntries(
          ["gwrk-specify", "gwrk-plan"].flatMap((workflow) => {
            const path = `.gwrk/plugins/workflows/${workflow}`;
            const manifest = [
              "type: workflow",
              `name: ${workflow}`,
              "version: 1.0.0",
              "description: Test definition prompt",
              "prompt: PROMPT.md",
              "outputSchema:",
              "  type: object",
            ].join("\n");
            return [
              [`${path}/manifest.yaml`, manifest],
              [`${path}/PROMPT.md`, "<!-- @include guidance.md -->"],
              [`${path}/guidance.md`, `Included guidance for ${workflow}`],
            ];
          }),
        );
        const manifestPath = join(fixturesDir, "alternative.json");
        const manifest = {
          id: "custom-define",
          roles: ["define"],
          prompt: "Define the fixture",
          files,
        };
        await writeFile(manifestPath, JSON.stringify(manifest));
        const calls: TaskDispatch[] = [];
        const runner = createFixtureRunner({
          fixturesDir,
          dispatcher: async (task) => {
            calls.push(task);
            if (task.workflow === "gwrk-specify") {
              writeFileSync(join(task.featureDir!, "spec.md"), "# Spec");
            }
            return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
          },
        });
        const before = await runner.computeSuiteHashes();
        expect(calls).toHaveLength(0);
        await runner.runFixtureRepeat({
          fixtureId: "custom-define",
          role: "define",
          repeatIndex: 0,
          route: candidateRoute,
        });
        const include = `.gwrk/plugins/workflows/${changedWorkflow}/guidance.md`;
        files[include] += "\nChanged included guidance";
        await writeFile(manifestPath, JSON.stringify(manifest));
        const after = await runner.computeSuiteHashes();
        expect(after.workflowPromptHashes.define).not.toBe(
          before.workflowPromptHashes.define,
        );
        expect(after.workflowPromptHashes[changedWorkflow]).not.toBe(
          before.workflowPromptHashes[changedWorkflow],
        );
        const other =
          changedWorkflow === "gwrk-plan" ? "gwrk-specify" : "gwrk-plan";
        expect(after.workflowPromptHashes[other]).toBe(
          before.workflowPromptHashes[other],
        );
        expect(calls.map(({ workflow }) => workflow)).toEqual([
          "gwrk-specify",
          "gwrk-plan",
        ]);
        for (const { stdin, workflow } of calls) {
          expect(stdin).toContain(`Included guidance for ${workflow}`);
        }
      } finally {
        await rm(fixturesDir, { recursive: true, force: true });
      }
    },
  );

  it("computes reproducible suite and workflow prompt hashes", async () => {
    const runner = createFixtureRunner();
    const { fixtureSuiteHash, workflowPromptHashes } =
      await runner.computeSuiteHashes();

    expect(typeof fixtureSuiteHash).toBe("string");
    expect(fixtureSuiteHash.length).toBe(64);

    expect(workflowPromptHashes).toHaveProperty("define");
    expect(workflowPromptHashes).toHaveProperty("implement");
    expect(workflowPromptHashes).toHaveProperty("review");
    expect(workflowPromptHashes.define.length).toBe(64);
    expect(workflowPromptHashes.implement.length).toBe(64);
    expect(workflowPromptHashes.review.length).toBe(64);
  });

  it("yields distinct sanitizedOutput containing diff and report for different implementations", async () => {
    const fixtureJson = JSON.parse(
      readFileSync(
        "tests/fixtures/model-qualification/implement-seeded-defect/fixture.json",
        "utf8",
      ),
    );
    const fixturePlan = fixtureJson.files["plan.md"];
    const alphaDispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        writeFileSync(
          join(task.workDir!, "src/domain/select-queue.mjs"),
          `// IMPLEMENTATION ALPHA\n${fixedPassingQueueImplementation}`,
          "utf8",
        );
        return {
          exitCode: 0,
          stdout: "Agent report ALPHA",
          stderr: "",
          durationS: 0,
          durationMs: 50,
        };
      },
    );
    const betaDispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        writeFileSync(
          join(task.workDir!, "src/domain/select-queue.mjs"),
          `// IMPLEMENTATION BETA\n${fixedPassingQueueImplementation}`,
          "utf8",
        );
        return {
          exitCode: 0,
          stdout: "Agent report BETA",
          stderr: "",
          durationS: 0,
          durationMs: 50,
        };
      },
    );

    const runnerAlpha = createFixtureRunner({ dispatcher: alphaDispatcher });
    const evidenceAlpha = await runnerAlpha.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });

    const runnerBeta = createFixtureRunner({ dispatcher: betaDispatcher });
    const evidenceBeta = await runnerBeta.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "implement",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(evidenceAlpha.sanitizedOutput).not.toBe(
      evidenceBeta.sanitizedOutput,
    );
    expect(evidenceAlpha.sanitizedOutput).toContain("IMPLEMENTATION ALPHA");
    expect(evidenceAlpha.sanitizedOutput).toContain("Agent report ALPHA");
    expect(evidenceBeta.sanitizedOutput).toContain("IMPLEMENTATION BETA");
    expect(evidenceBeta.sanitizedOutput).toContain("Agent report BETA");
    expect(evidenceAlpha.sanitizedOutput).not.toBe(fixturePlan);
    expect(evidenceBeta.sanitizedOutput).not.toBe(fixturePlan);
  });

  it("fails review repeat when a no-op reviewer does not reopen required tasks", async () => {
    const dispatcher = vi.fn(
      async (_task: TaskDispatch): Promise<TaskResult> => ({
        exitCode: 0,
        stdout: JSON.stringify({ reopenedTasks: [] }),
        stderr: "",
        durationS: 0,
        durationMs: 50,
      }),
    );

    const runner = createFixtureRunner({ dispatcher });
    const evidence = await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "review",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(evidence.deterministicGatesPassed).toBe(false);
    const requiredCheck = evidence.gateChecks.find(
      (c) => c.checkId === "review-required-T001",
    );
    expect(requiredCheck?.passed).toBe(false);
  });

  it.each([
    { path: "tasks.md", allowed: true },
    { path: "src/domain/select-queue.mjs", allowed: false },
  ])("checks whether a review can change $path", async ({ path, allowed }) => {
    const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
      const file = join(task.workDir!, path);
      writeFileSync(file, `${readFileSync(file, "utf8")}\n// Review note\n`);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Review found the seeded routing defect",
          verdict: "NO-GO",
          reopenedTasks: ["T001"],
          intents: [],
        }),
        stderr: "",
        durationS: 0,
      };
    };

    const evidence = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
      {
        fixtureId: "implement-seeded-defect",
        role: "review",
        repeatIndex: 0,
        route: candidateRoute,
      },
    );

    expect(evidence.gateChecks).toContainEqual(
      expect.objectContaining({
        checkId: "forbidden-file-mutation",
        passed: allowed,
      }),
    );
  });

  it.each([
    ["T001", true],
    ["T999", false],
  ] as const)(
    "validates the task state change reopening %s",
    async (taskId, allowed) => {
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        const file = join(task.workDir!, "tasks.md");
        const baseline = readFileSync(file, "utf8");
        if (allowed) {
          writeFileSync(
            file,
            baseline.replace("T001 Repair", "- [ ] T001 Repair"),
          );
        } else {
          writeFileSync(file, `${baseline}\n- [ ] T999 Invented task\n`);
        }
        const stdout = JSON.stringify({
          summary: "Review updated task state",
          verdict: "NO-GO",
          reopenedTasks: allowed ? [] : ["T001"],
          intents: [],
        });
        return { exitCode: 0, stdout, stderr: "", durationS: 0 };
      };
      const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
        {
          fixtureId: "implement-seeded-defect",
          role: "review",
          repeatIndex: 0,
          route: candidateRoute,
        },
      );
      expect(result.deterministicGatesPassed).toBe(allowed);
      expect(result.gateChecks).toContainEqual(
        expect.objectContaining({
          checkId: "review-reopened-task-ids",
          passed: allowed,
        }),
      );
    },
  );

  it("passes review repeat for a report-only reviewer that reopens required tasks and preserves baseline", async () => {
    const dispatcher = vi.fn(
      async (_task: TaskDispatch): Promise<TaskResult> => ({
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "Review found the seeded routing defect",
          verdict: "NO-GO",
          reopenedTasks: ["T001"],
          intents: [],
        }),
        stderr: "",
        durationS: 0,
        durationMs: 50,
      }),
    );

    const runner = createFixtureRunner({ dispatcher });
    const evidence = await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "review",
      repeatIndex: 0,
      route: candidateRoute,
    });

    expect(evidence.deterministicGatesPassed).toBe(true);
    expect(evidence.sanitizedOutput).toContain(
      "Review found the seeded routing defect",
    );
    expect(
      evidence.gateChecks.some((c) => c.checkId === "candidate-gate"),
    ).toBe(false);
    const baselineCheck = evidence.gateChecks.find(
      (c) => c.checkId === "review-baseline-preserved",
    );
    expect(baselineCheck?.passed).toBe(true);
    const requiredCheck = evidence.gateChecks.find(
      (c) => c.checkId === "review-required-T001",
    );
    expect(requiredCheck?.passed).toBe(true);
    const forbiddenCheck = evidence.gateChecks.find(
      (c) => c.checkId === "review-forbidden-T002",
    );
    expect(forbiddenCheck?.passed).toBe(true);
  });

  it.each(["prose", "structured"])(
    "reads a %s review verdict without confusing prose braces",
    async (mode) => {
      const verdict = {
        summary: "Review found the seeded routing defect",
        verdict: "NO-GO",
        reopenedTasks: ["T001"],
        intents: [],
      };
      const dispatcher = vi.fn(
        async (): Promise<TaskResult> => ({
          exitCode: 0,
          stdout: `Notes {policy} before the result.\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\`\nReview finished.`,
          ...(mode === "structured" ? { structuredOutput: verdict } : {}),
          stderr: "",
          durationS: 0,
        }),
      );
      const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
        {
          fixtureId: "implement-seeded-defect",
          role: "review",
          repeatIndex: 0,
          route: candidateRoute,
        },
      );
      expect(result.deterministicGatesPassed).toBe(true);
      expect(
        result.gateChecks.find(
          ({ checkId }) => checkId === "review-required-T001",
        ),
      ).toMatchObject({ passed: true });
    },
  );

  it("dispatches mapped workflows and includes persona prompt headers for each role", async () => {
    const roles: Array<{
      role: "define" | "implement" | "review";
      fixtureId: string;
      workflow: string;
      firstLine: string;
    }> = [
      {
        role: "define",
        fixtureId: "define-long-context",
        workflow: "gwrk-plan",
        firstLine: "# /gwrk-plan",
      },
      {
        role: "implement",
        fixtureId: "implement-seeded-defect",
        workflow: "gwrk-implement",
        firstLine: "# /gwrk-implement",
      },
      {
        role: "review",
        fixtureId: "implement-seeded-defect",
        workflow: "gwrk-review-code",
        firstLine: "# Code Review for CLI Projects",
      },
    ];

    for (const { role, fixtureId, workflow, firstLine } of roles) {
      let capturedTask: TaskDispatch | undefined;
      const dispatcher = vi.fn(
        async (task: TaskDispatch): Promise<TaskResult> => {
          capturedTask = task;
          if (role === "define") {
            const file =
              task.workflow === "gwrk-specify" ? "spec.md" : "plan.md";
            writeFileSync(
              join(task.featureDir!, file),
              "# Definition\n",
              "utf8",
            );
          } else if (role === "implement") {
            writeFileSync(
              join(task.workDir!, "src/domain/select-queue.mjs"),
              fixedPassingQueueImplementation,
              "utf8",
            );
          }
          return {
            exitCode: 0,
            stdout:
              role === "review"
                ? JSON.stringify({ reopenedTasks: ["T001"] })
                : "ok",
            stderr: "",
            durationS: 0,
            durationMs: 50,
          };
        },
      );

      const runner = createFixtureRunner({ dispatcher });
      await runner.runFixtureRepeat({
        fixtureId,
        role,
        repeatIndex: 0,
        route: candidateRoute,
      });

      expect(capturedTask).toBeDefined();
      expect(capturedTask?.workflow).toBe(workflow);
      expect(capturedTask?.stdin).toContain(firstLine);
    }
  });

  it("copies generated spec.md and plan.md to artifactOutputDir for define", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "gwrk-define-out-"));
    try {
      const dispatcher = vi.fn(
        async (task: TaskDispatch): Promise<TaskResult> => {
          const specification = task.workflow === "gwrk-specify";
          const file = specification ? "spec.md" : "plan.md";
          const content = specification
            ? "# Generated Spec Content\n"
            : "# Generated Plan Content\n";
          writeFileSync(join(task.featureDir!, file), content, "utf8");
          return {
            exitCode: 0,
            stdout: "Generated artifacts",
            stderr: "",
            durationS: 0,
            durationMs: 50,
          };
        },
      );

      const runner = createFixtureRunner({ dispatcher });
      await runner.runFixtureRepeat({
        fixtureId: "define-long-context",
        role: "define",
        repeatIndex: 0,
        route: candidateRoute,
        artifactOutputDir: outputDir,
      });

      expect(existsSync(join(outputDir, "spec.md"))).toBe(true);
      expect(existsSync(join(outputDir, "plan.md"))).toBe(true);
      expect(readFileSync(join(outputDir, "spec.md"), "utf8")).toContain(
        "Generated Spec Content",
      );
      expect(readFileSync(join(outputDir, "plan.md"), "utf8")).toContain(
        "Generated Plan Content",
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("throws when handoffArtifactDir is provided to a define request and does not pre-seed plan.md", async () => {
    const fakeHandoff = await mkdtemp(join(tmpdir(), "gwrk-fake-handoff-"));
    try {
      writeFileSync(join(fakeHandoff, "plan.md"), "# Preseeded Plan\n", "utf8");
      const runner = createFixtureRunner();
      await expect(
        runner.runFixtureRepeat({
          fixtureId: "define-long-context",
          role: "define",
          repeatIndex: 0,
          route: candidateRoute,
          handoffArtifactDir: fakeHandoff,
        }),
      ).rejects.toThrow("handoffArtifactDir is only valid for implement");
    } finally {
      await rm(fakeHandoff, { recursive: true, force: true });
    }
  });
});
