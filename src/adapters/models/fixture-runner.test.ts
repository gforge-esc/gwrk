/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      roleScore: {
        role: "implement",
        candidateMedianMsToGreen: 100,
        incumbentMedianMsToGreen: 120,
        speedup: 1.2,
      },
    };

    const judgeDispatcher = vi.fn(
      async (task: TaskDispatch): Promise<TaskResult> => {
        expect(task.workflow).toBe("gwrk-model-judge");
        expect(task.agent).toBe(judge.backend);
        expect(task.model).toBe(judge.modelId);
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
          "// IMPLEMENTATION ALPHA\n" + fixedPassingQueueImplementation,
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
          "// IMPLEMENTATION BETA\n" + fixedPassingQueueImplementation,
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

    expect(evidenceAlpha.sanitizedOutput).not.toBe(evidenceBeta.sanitizedOutput);
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

  it("passes review repeat for a report-only reviewer that reopens required tasks and preserves baseline", async () => {
    const dispatcher = vi.fn(
      async (_task: TaskDispatch): Promise<TaskResult> => ({
        exitCode: 0,
        stdout: JSON.stringify({
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
            writeFileSync(join(task.workDir!, "spec.md"), "# Spec\n", "utf8");
            writeFileSync(join(task.workDir!, "plan.md"), "# Plan\n", "utf8");
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
          writeFileSync(
            join(task.workDir!, "spec.md"),
            "# Generated Spec Content\n",
            "utf8",
          );
          writeFileSync(
            join(task.workDir!, "plan.md"),
            "# Generated Plan Content\n",
            "utf8",
          );
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
      writeFileSync(
        join(fakeHandoff, "plan.md"),
        "# Preseeded Plan\n",
        "utf8",
      );
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
