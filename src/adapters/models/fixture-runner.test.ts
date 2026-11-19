/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluateModels } from "../../application/models/evaluate-models.js";
import {
  type ModelCandidate,
  blindCandidate,
} from "../../domain/model-qualification.js";
import type {
  FixtureRepeatEvidence,
  JudgeVerdictPacket,
} from "../../ports/model-qualification-port.js";
import type { TaskDispatch, TaskResult } from "../../utils/agent.js";
import { type TaskState, loadTaskState } from "../../utils/state.js";
import { FixtureRunner, createFixtureRunner } from "./fixture-runner.js";

const candidateRoute = {
  backend: "test-backend",
  modelId: "test-model-v1",
  effort: "low",
};

const opaqueFixtureCredential = "synthetic-fixture-quartz-cedar-724";

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
  it("keeps inherited Git selectors from modifying another repository", async () => {
    const outside = await mkdtemp(
      join(tmpdir(), "gwrk-outside-qualification-"),
    );
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv))
      if (key.startsWith("GIT_")) delete cleanEnv[key];
    execFileSync("git", ["init", "--quiet", outside], { env: cleanEnv });
    execFileSync(
      "git",
      ["-C", outside, "config", "user.name", "Outside owner"],
      { env: cleanEnv },
    );
    const config = readFileSync(join(outside, ".git/config"), "utf8");
    try {
      vi.stubEnv("GIT_DIR", join(outside, ".git"));
      const result = await createFixtureRunner({
        dispatcher: async (task) => {
          execFileSync(
            "git",
            ["-C", task.workDir!, "config", "qualification.fixture", "true"],
            { env: { ...process.env, ...task.env } },
          );
          writeFileSync(
            join(task.workDir!, "src/domain/select-queue.mjs"),
            fixedPassingQueueImplementation,
          );
          return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
        },
      })
        .runFixtureRepeat({
          fixtureId: "implement-seeded-defect",
          role: "implement",
          repeatIndex: 0,
          route: candidateRoute,
        })
        .catch(() => undefined);
      expect(readFileSync(join(outside, ".git/config"), "utf8")).toBe(config);
      expect(existsSync(join(outside, ".git/index"))).toBe(false);
      expect(result?.deterministicGatesPassed).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      await rm(outside, { recursive: true, force: true });
    }
  });

  it.each(["missing executable", "signal"])(
    "does not accept %s as seeded RED evidence",
    async (mode) => {
      const root = await mkdtemp(join(tmpdir(), "gwrk-broken-gate-"));
      try {
        const fixture = JSON.parse(
          readFileSync(
            "tests/fixtures/model-qualification/implement-seeded-defect/fixture.json",
            "utf8",
          ),
        );
        fixture.gates.command =
          mode === "missing executable"
            ? [join(root, "absent")]
            : [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"];
        const directory = join(root, fixture.id);
        await mkdir(directory);
        await writeFile(
          join(directory, "fixture.json"),
          JSON.stringify(fixture),
        );
        const result = await createFixtureRunner({
          fixturesDir: root,
          dispatcher: async (task) => {
            writeFileSync(
              join(task.workDir!, "tasks.md"),
              readFileSync(join(task.workDir!, "tasks.md"), "utf8").replace(
                "[x] T001",
                "[ ] T001",
              ),
            );
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                summary: "Seed defect",
                verdict: "NO-GO",
                reopenedTasks: ["T001"],
                intents: [],
              }),
              stderr: "",
              durationS: 0,
            };
          },
        }).runFixtureRepeat({
          fixtureId: fixture.id,
          role: "review",
          repeatIndex: 0,
          route: candidateRoute,
        });
        expect(result.deterministicGatesPassed).toBe(false);
        for (const checkId of ["baseline-gate", "review-baseline-preserved"])
          expect(result.gateChecks).toContainEqual(
            expect.objectContaining({ checkId, passed: false }),
          );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each(["markdown", "canonical"])(
    "rejects review deletion of %s task state with a valid report",
    async (format) => {
      const runner = createFixtureRunner({
        dispatcher: async (task) => {
          const path =
            format === "markdown"
              ? join(task.workDir!, "tasks.md")
              : join(task.featureDir!, ".gwrk/tasks.json");
          await rm(path);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              summary: "Routing defect",
              verdict: "NO-GO",
              reopenedTasks: ["T001"],
              intents: [],
            }),
            stderr: "",
            durationS: 0,
          };
        },
      });
      const result = await runner.runFixtureRepeat({
        fixtureId: "implement-seeded-defect",
        role: "review",
        repeatIndex: 0,
        route: candidateRoute,
      });
      expect(result.deterministicGatesPassed).toBe(false);
      expect(result.gateChecks).toContainEqual(
        expect.objectContaining({
          checkId: "review-task-state",
          passed: false,
        }),
      );
    },
  );

  it("provides canonical feature prerequisites to the review workflow", async () => {
    const runner = createFixtureRunner({
      dispatcher: async (task) => {
        const featureDir = task.featureDir!;
        expect(task.workflow).toBe("gwrk-review-code");
        expect(task.stdin).toContain("# Code Review for CLI Projects");
        expect(task.stdin).toContain("## Prerequisites");
        expect(task.stdin).toContain(
          "feature_dir: specs/001-ticket-routing\nphase_number: 1\n",
        );
        expect(existsSync(join(featureDir, "spec.md"))).toBe(true);
        expect(readFileSync(join(featureDir, "plan.md"), "utf8")).toContain(
          "### Phase 1: Queue selection",
        );
        const phase = loadTaskState(featureDir).phases.find(
          ({ id }) => id === "phase-01",
        );
        expect(phase?.tasks.map(({ id, status }) => [id, status])).toEqual([
          ["T001", "completed"],
          ["T002", "completed"],
        ]);
        expect(() =>
          execFileSync("bash", [join(featureDir, "gates/run-all-gates.sh")], {
            cwd: task.workDir,
            stdio: "pipe",
            timeout: 5000,
          }),
        ).toThrow(expect.objectContaining({ status: 1 }));
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: "Routing defect",
            verdict: "NO-GO",
            reopenedTasks: ["T001"],
            intents: [],
          }),
          stderr: "",
          durationS: 0,
        };
      },
    });
    const result = await runner.runFixtureRepeat({
      fixtureId: "implement-seeded-defect",
      role: "review",
      repeatIndex: 0,
      route: candidateRoute,
    });
    expect(result.deterministicGatesPassed).toBe(true);
  });

  it.each([
    ["remove T002", (tasks: string) => tasks.replace(/^.*T002.*\n/m, "")],
    [
      "add a completed task",
      (tasks: string) => `${tasks}- [x] T003 New task\n`,
    ],
    [
      "edit T002",
      (tasks: string) =>
        tasks.replace("This task is complete.", "Different scope."),
    ],
    [
      "add a continuation under completed T002",
      (tasks: string) => `${tasks}  Preserve a different adapter contract.\n`,
    ],
  ] as const)(
    "rejects a review that would %s in tasks.md",
    async (_, mutate) => {
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        const path = join(task.workDir!, "tasks.md");
        writeFileSync(path, mutate(readFileSync(path, "utf8")));
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: "Routing defect",
            verdict: "NO-GO",
            reopenedTasks: ["T001"],
            intents: [],
          }),
          stderr: "",
          durationS: 0,
        };
      };
      const result = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
        {
          fixtureId: "implement-seeded-defect",
          role: "review",
          repeatIndex: 0,
          route: candidateRoute,
        },
      );
      expect(result.deterministicGatesPassed).toBe(false);
      expect(result.gateChecks).toContainEqual(
        expect.objectContaining({
          checkId: "review-task-state",
          passed: false,
        }),
      );
    },
  );

  it.each([
    [
      "reopen T001",
      true,
      ([routing]: TaskState["phases"][number]["tasks"]) => {
        routing.status = "open";
        routing.completedAt = undefined;
        routing.description +=
          "\n\nREVIEW FAIL (code): The routing test fails on unknown priority.";
      },
    ],
    ["remove T002", false, (tasks) => tasks.pop()],
    [
      "add a completed task",
      false,
      (tasks) => tasks.push({ ...tasks[1], id: "T003" }),
    ],
    [
      "edit T002",
      false,
      ([, adapter]) => {
        adapter.description = "Different scope";
      },
    ],
    [
      "reopen T002",
      false,
      ([, adapter]) => {
        adapter.status = "open";
      },
    ],
  ] satisfies [
    string,
    boolean,
    (tasks: TaskState["phases"][number]["tasks"]) => void,
  ][])(
    "allows a canonical task change only to reopen T001 (%s)",
    async (_, allowed, mutate) => {
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        const path = join(task.featureDir!, ".gwrk/tasks.json");
        const state: TaskState = JSON.parse(readFileSync(path, "utf8"));
        mutate(state.phases[0].tasks);
        writeFileSync(path, JSON.stringify(state));
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: "Routing defect",
            verdict: "NO-GO",
            reopenedTasks: allowed ? [] : ["T001"],
            intents: [],
          }),
          stderr: "",
          durationS: 0,
        };
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
          checkId: "review-task-state",
          passed: allowed,
        }),
      );
    },
  );

  it("TR-028 records the artifacts supplied to generated-plan implementation", async () => {
    const handoff = await mkdtemp(join(tmpdir(), "gwrk-definition-pair-"));
    try {
      await writeFile(
        join(handoff, "spec.md"),
        "# Generated spec\nUnique definition requirements\n",
      );
      await writeFile(
        join(handoff, "plan.md"),
        "# Generated plan\nRepair routing against the generated spec\n",
      );
      const runner = createFixtureRunner({
        dispatcher: async (task) => {
          expect(
            readFileSync(join(task.workDir!, "spec.md"), "utf8"),
          ).toContain("Unique definition requirements");
          expect(
            readFileSync(join(task.workDir!, "plan.md"), "utf8"),
          ).toContain("Repair routing against the generated spec");
          expect(task.stdin).toContain("Use the generated spec.md and plan.md");
          expect(task.stdin).not.toContain("Use the fixed plan");
          writeFileSync(
            join(task.workDir!, "src/domain/select-queue.mjs"),
            fixedPassingQueueImplementation,
          );
          return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
        },
      });
      const result = await runner.runFixtureRepeat({
        fixtureId: "implement-seeded-defect",
        role: "implement",
        repeatIndex: 0,
        route: candidateRoute,
        handoffArtifactDir: handoff,
      });
      expect(result.deterministicGatesPassed).toBe(true);
      expect(result).toMatchObject({
        fixtureInputs: {
          "spec.md": "# Generated spec\nUnique definition requirements\n",
          "plan.md":
            "# Generated plan\nRepair routing against the generated spec\n",
        },
      });
    } finally {
      await rm(handoff, { recursive: true, force: true });
    }
  });

  describe.each(["define-long-context", "implement-seeded-defect"])(
    "protected routing contract in %s",
    (fixtureId) => {
      it.each(["import clock", "call clock", "fresh unknown", "pure"])(
        "rejects invalid domain behavior: %s",
        async (variant) => {
          const root = await mkdtemp(join(tmpdir(), "gwrk-protected-routing-"));
          try {
            const fixture = JSON.parse(
              readFileSync(
                join(
                  "tests/fixtures/model-qualification",
                  fixtureId,
                  "fixture.json",
                ),
                "utf8",
              ),
            );
            const target = join(root, "src/domain");
            await mkdir(target, { recursive: true });
            await writeFile(
              join(target, "select-queue.test.mjs"),
              fixture.files["src/domain/select-queue.test.mjs"],
            );
            let implementation = fixedPassingQueueImplementation;
            if (variant === "import clock")
              implementation = `const clock = Date.now();\n${implementation}`;
            if (variant === "call clock")
              implementation = implementation.replace(
                "const normalized",
                "Date.now(); const normalized",
              );
            if (variant === "fresh unknown")
              implementation = implementation.replace(
                'return { queue: "triage", rawPriority };',
                'return { queue: nowMs - receivedAtMs >= 1800000 ? "triage" : "standard", rawPriority };',
              );
            await writeFile(join(target, "select-queue.mjs"), implementation);
            let passed = true;
            try {
              execFileSync(
                process.execPath,
                ["--test", "src/domain/select-queue.test.mjs"],
                { cwd: root, stdio: "pipe" },
              );
            } catch {
              passed = false;
            }
            expect(passed).toBe(variant === "pure");
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      );
    },
  );

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
        usage: { tokensIn: 23, tokensOut: 29, costUsd: 0.125 },
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
    expect(result.usage).toEqual({
      tokensIn: 23,
      tokensOut: 29,
      costUsd: 0.125,
    });
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
    {
      variant: "TR-032 comment-only acceptance scenarios",
      expectedCheck: "required-section-spec.md-acceptance-scenarios",
      acceptanceBody:
        "<!-- Route unknown priorities to triage. -->\n<!--\nRoute unknown priorities to triage.\n-->",
    },
    {
      variant: "TR-032 acceptance scenarios organized under a subheading",
      expectedCheck: undefined,
      expectedPassingCheck: "required-section-spec.md-acceptance-scenarios",
      acceptanceBody:
        "### Unknown priority\nRoute unknown priorities to triage.",
    },
    {
      variant: "TR-032 a different ADR with the same prefix",
      expectedCheck: "spec-ref-ADR-001",
      firstAdr: "ADR-0010",
    },
    {
      variant: "TR-032 an ADR cited by filename",
      expectedCheck: undefined,
      expectedPassingCheck: "spec-ref-ADR-001",
      firstAdr: "docs/decisions/ADR-001-ticket-boundaries.md",
    },
    {
      variant: "TR-033 an ADR cited only in a comment",
      expectedCheck: "spec-ref-ADR-001",
      firstAdr: "<!-- ADR-001 -->",
    },
    {
      variant: "TR-033 a plan path cited only in a comment",
      expectedCheck: "plan-ref-src/domain/select-queue.mjs",
      planApproach:
        "Repair queue selection. Run src/domain/select-queue.test.mjs.\n\n<!--\nsrc/domain/select-queue.mjs\n-->",
    },
    { variant: "bare command", expectedCheck: "executable-plan-gate" },
    { variant: "echoed command", expectedCheck: "executable-plan-gate" },
    { variant: "failed dispatch", expectedCheck: "dispatch-gwrk-plan" },
    { variant: "failure status", expectedCheck: "dispatch-gwrk-plan" },
    { variant: "timed out dispatch", expectedCheck: "dispatch-gwrk-plan" },
    {
      variant: "wrong specification model",
      expectedCheck: "fixture-route-identity",
      mismatchedWorkflow: "gwrk-specify",
    },
    {
      variant: "wrong planning model",
      expectedCheck: "fixture-route-identity",
      mismatchedWorkflow: "gwrk-plan",
    },
    {
      variant: "rewritten acceptance rule",
      expectedCheck: "plan-preserves-spec",
    },
    { variant: "removed spec", expectedCheck: "plan-preserves-spec" },
    { variant: "TR-027 valid plan", expectedCheck: undefined },
  ])(
    "checks definition produced with $variant",
    async ({
      variant,
      expectedCheck,
      expectedPassingCheck,
      mismatchedWorkflow,
      acceptanceBody = "Route unknown priorities to triage.",
      firstAdr = "ADR-001",
      planApproach = "Repair src/domain/select-queue.mjs and run src/domain/select-queue.test.mjs.",
    }) => {
      const calls: TaskDispatch[] = [];
      const specReferences = `${firstAdr} ADR-002 docs/refs/queue-contract.md docs/research/routing-brief.md docs/refs/acceptance.md`;
      const gateCommand = "node --test src/domain/select-queue.test.mjs";
      const spec =
        variant === "reference lists"
          ? specReferences
          : `# Ticket routing spec\n\n## Requirements\n${specReferences}\n\n## Acceptance scenarios\n${acceptanceBody}\n\n## Testing requirements\nExercise the 30-minute cutoff.\n`;
      const rewrittenSpec = spec.replace(
        "Route unknown priorities to triage.",
        "Route unknown priorities to the standard queue.",
      );
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
              planApproach,
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
          if (variant === "rewritten acceptance rule") {
            writeFileSync(join(featureDir, "spec.md"), rewrittenSpec);
          }
          if (variant === "removed spec") {
            await rm(join(featureDir, "spec.md"));
          }
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
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          ...(task.workflow === "gwrk-specify"
            ? { durationS: 0.2 }
            : { durationS: 0, durationMs: 50 }),
          ...(variant === "TR-027 valid plan"
            ? {
                usage:
                  task.workflow === "gwrk-specify"
                    ? { tokensIn: 11, costUsd: 0.25 }
                    : { tokensOut: 17, costUsd: 0.5 },
              }
            : {}),
          observedModel: mismatchedWorkflow
            ? task.workflow === mismatchedWorkflow
              ? "other-model"
              : candidateRoute.modelId
            : undefined,
        };
      };
      const artifactOutputDir =
        variant === "TR-027 valid plan"
          ? await mkdtemp(join(tmpdir(), "gwrk-definition-artifacts-"))
          : undefined;
      let result: FixtureRepeatEvidence;
      try {
        result = await createFixtureRunner({ dispatcher }).runFixtureRepeat({
          fixtureId: "define-long-context",
          role: "define",
          repeatIndex: 0,
          route: candidateRoute,
          artifactOutputDir,
        });
        if (artifactOutputDir) {
          expect(readFileSync(join(artifactOutputDir, "spec.md"), "utf8")).toBe(
            spec,
          );
          expect(readFileSync(join(artifactOutputDir, "plan.md"), "utf8")).toBe(
            plan,
          );
        }
      } finally {
        if (artifactOutputDir)
          await rm(artifactOutputDir, { recursive: true, force: true });
      }
      expect(
        result.deterministicGatesPassed,
        JSON.stringify(result.gateChecks),
      ).toBe(expectedCheck === undefined);
      if (artifactOutputDir) {
        expect(result.durationMs).toBe(250);
        expect(result.usage).toEqual({
          tokensIn: 11,
          tokensOut: 17,
          costUsd: 0.75,
        });
      } else {
        expect(result).not.toHaveProperty("usage");
      }
      if (expectedCheck) {
        expect(
          result.gateChecks.some(
            ({ checkId, passed }) =>
              checkId.startsWith(expectedCheck) && !passed,
          ),
        ).toBe(true);
      }
      if (expectedPassingCheck) {
        expect(result.gateChecks).toContainEqual(
          expect.objectContaining({
            checkId: expectedPassingCheck,
            passed: true,
          }),
        );
      }
      expect(result.observedModel).toBe(
        mismatchedWorkflow ? "other-model" : "unknown",
      );
      if (mismatchedWorkflow) {
        const routeCheck = result.gateChecks.find(
          ({ checkId }) => checkId === "fixture-route-identity",
        );
        expect(routeCheck?.detail).toContain(mismatchedWorkflow);
        expect(routeCheck?.detail).toContain(candidateRoute.modelId);
        expect(routeCheck?.detail).toContain("other-model");
      }
      if (variant === "removed spec") {
        expect(result.sanitizedOutput).not.toContain(spec);
      } else {
        expect(result.sanitizedOutput).toContain(
          variant === "rewritten acceptance rule" ? rewrittenSpec : spec,
        );
      }
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

  it("TR-029 rejects a forbidden mutation made during a passing candidate gate", async () => {
    const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
      writeFileSync(
        join(task.workDir!, "src/domain/select-queue.mjs"),
        `import { appendFileSync } from "node:fs";
appendFileSync(new URL("../../AGENTS.md", import.meta.url), "\\nChanged during the candidate gate\\n");
${fixedPassingQueueImplementation}`,
      );
      return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
    };
    const evidence = await createFixtureRunner({ dispatcher }).runFixtureRepeat(
      {
        fixtureId: "implement-seeded-defect",
        role: "implement",
        repeatIndex: 0,
        route: candidateRoute,
      },
    );

    expect(evidence.gateChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "candidate-gate", passed: true }),
        expect.objectContaining({
          checkId: "forbidden-file-mutation",
          passed: false,
          detail: expect.stringContaining("AGENTS.md"),
        }),
      ]),
    );
    expect(evidence.deterministicGatesPassed).toBe(false);
  });

  it.each(["staged", "committed"] as const)(
    "TR-030 rejects a %s forbidden edit when the working copy matches the baseline",
    async (location) => {
      const dispatcher = async (task: TaskDispatch): Promise<TaskResult> => {
        const cwd = task.workDir!;
        const git = (args: string[]) =>
          execFileSync("git", args, {
            cwd,
            env: { ...process.env, ...task.env },
            encoding: "utf8",
          });
        const protectedPath = join(cwd, "AGENTS.md");
        const baseline = readFileSync(protectedPath, "utf8");
        writeFileSync(protectedPath, `${baseline}\nChanged project rules\n`);
        git(["add", "--", "AGENTS.md"]);
        if (location === "committed") {
          const baselineSha = git(["rev-parse", "HEAD"]).trim();
          git([
            "-c",
            "commit.gpgsign=false",
            "commit",
            "--quiet",
            "--no-edit",
            "--author=Fixture Runner <runner@example.com>",
            "-m",
            "Change fixture project rules",
          ]);
          git([
            "restore",
            `--source=${baselineSha}`,
            "--staged",
            "--worktree",
            "--",
            "AGENTS.md",
          ]);
        } else {
          writeFileSync(protectedPath, baseline);
        }
        writeFileSync(
          join(cwd, "src/domain/select-queue.mjs"),
          fixedPassingQueueImplementation,
        );
        return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
      };

      const evidence = await createFixtureRunner({
        dispatcher,
      }).runFixtureRepeat({
        fixtureId: "implement-seeded-defect",
        role: "implement",
        repeatIndex: 0,
        route: candidateRoute,
      });

      expect(evidence.gateChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ checkId: "baseline-gate", passed: true }),
          expect.objectContaining({ checkId: "candidate-gate", passed: true }),
          expect.objectContaining({
            checkId: "forbidden-file-mutation",
            passed: false,
            detail: expect.stringContaining("AGENTS.md"),
          }),
        ]),
      );
      expect(evidence.deterministicGatesPassed).toBe(false);
    },
  );

  it.each([
    ["plan", undefined],
    ["plan", " \n"],
    ["spec", undefined],
    ["spec", " \n"],
  ] as const)(
    "fails the handoff gate before dispatch for %s content %s",
    async (artifact, content) => {
      const handoff = await mkdtemp(join(tmpdir(), "gwrk-missing-artifact-"));
      const dispatcher = vi.fn();
      try {
        const other = artifact === "plan" ? "spec" : "plan";
        await writeFile(join(handoff, `${other}.md`), `# Generated ${other}\n`);
        if (content !== undefined)
          await writeFile(join(handoff, `${artifact}.md`), content);
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
            checkId: `handoff-${artifact}`,
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
        expect(task.stdin).toContain("Use the fixed plan");
        expect(existsSync(join(task.workDir!, "spec.md"))).toBe(false);
        expect(
          existsSync(join(task.workDir!, "specs/001-ticket-routing")),
        ).toBe(false);
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
        join(handoffDir, "spec.md"),
        "# Candidate Generated Specification\n",
      );
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

  it.each([false, true])(
    "TR-028 resolves citations in both dispatched judge prompts (absent ref: %s)",
    async (absentRef) => {
      const fixtureId = "implement-seeded-defect";
      const inputPath = "src/domain/select-queue.mjs";
      const checkId = "review-required-T001";
      const fixture = JSON.parse(
        readFileSync(
          `tests/fixtures/model-qualification/${fixtureId}/fixture.json`,
          "utf8",
        ),
      );
      const model = (name: string): ModelCandidate => ({
        backend: `${name}-cli`,
        provider: `${name}-provider`,
        family: `${name}-family`,
        modelId: `${name}-model`,
      });
      const input = {
        evaluationId: "review-fixture-evaluation",
        role: "review" as const,
        candidate: model("cedar"),
        incumbent: model("quartz"),
        judges: [model("maple"), model("lapis")],
        blindingSecret: "fixture-blinding-key",
        fixtures: [{ id: fixtureId }],
      };
      const winner = blindCandidate(input.blindingSecret, input.evaluationId);
      const other = winner === "A" ? "B" : "A";
      const judgePrompts: string[] = [];
      const artifacts = (prompt: string) =>
        prompt
          .split("\n")
          .filter((line) => line.startsWith('{"ref":'))
          .map((line) => JSON.parse(line) as Record<string, string | boolean>);
      let incumbentRuns = 0;
      const runner = createFixtureRunner({
        dispatcher: async (task) => {
          const { stdin = "" } = task;
          if (task.workflow === "gwrk-model-judge") {
            judgePrompts.push(stdin);
            const records = artifacts(stdin);
            const citations = [winner, other].map((option) => ({
              inputRef:
                records.find(
                  ({ ref, path }) =>
                    String(ref).startsWith(`input:1:${option}:2:`) &&
                    path === inputPath,
                )?.ref ?? fixtureId,
              outputRef: `option${option}`,
              gateRef: absentRef
                ? checkId
                : (records.find(
                    ({ ref, checkId: artifactCheck }) =>
                      String(ref).startsWith(`gate:1:${option}:2:`) &&
                      artifactCheck === checkId,
                  )?.ref ?? checkId),
              claim: "The reviewer assessed the seeded routing defect",
            }));
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                summary: "Blinded review comparison",
                intents: [],
                winner,
                optionARegression: false,
                optionBRegression: false,
                scores: { optionA: 90, optionB: 90 },
                citations,
              }),
              stderr: "",
              durationS: 0,
            };
          }
          const reopened =
            task.model !== input.incumbent.modelId || ++incumbentRuns < 3;
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              summary: `Routing review by ${task.model}`,
              verdict: "NO-GO",
              reopenedTasks: reopened ? ["T001"] : [],
              intents: [],
            }),
            stderr: "",
            durationS: 0,
          };
        },
      });

      const result = await evaluateModels({ runner, judge: runner }, input);

      expect(judgePrompts).toHaveLength(2);
      expect(result.decision).toEqual(
        absentRef
          ? { promote: false, reason: "invalid-citations" }
          : { promote: true },
      );
      for (const prompt of judgePrompts) {
        expect(prompt).not.toMatch(/cedar|quartz/);
        const records = artifacts(prompt);
        for (const [option, route] of [
          [winner, "candidate"],
          [other, "incumbent"],
        ] as const) {
          for (const repeat of result.repeats[route]) {
            const scope = `1:${option}:${repeat.repeatIndex}:`;
            expect(
              records.find(
                ({ ref, path }) =>
                  String(ref).startsWith(`input:${scope}`) &&
                  path === inputPath,
              )?.content,
            ).toBe(fixture.files[inputPath]);
            expect(
              records.filter(({ ref }) =>
                String(ref).startsWith(`gate:${scope}`),
              ),
            ).toEqual(
              repeat.gateChecks.map((check) => expect.objectContaining(check)),
            );
          }
        }
      }
    },
  );

  it.each([
    { label: "accepts a report-only verdict", timedOut: false },
    { label: "TR-022 rejects a timed-out verdict", timedOut: true },
    { label: "TR-023 blocks a credential in the judge packet", secret: true },
    {
      label: "TR-023 blocks a credential in a judge verdict",
      secretVerdict: true,
    },
    {
      label: "TR-023 blocks a credential in observed judge identity",
      secretObserved: true,
    },
    {
      label: "TR-023 blocks a credential in failed judge stderr",
      secretStderr: true,
    },
    {
      label: "TR-023 blocks a credential in a judge transport error",
      secretError: true,
    },
    {
      label: "TR-023 rejects a judge error cause with a credential",
      secretCause: true,
    },
    {
      label: "TR-023 rejects a credential in an aggregate judge error",
      secretAggregate: true,
    },
    {
      label:
        "TR-023 preserves a clean judge transport error with a cause cycle",
      cleanError: true,
    },
  ])(
    "$label",
    async ({
      timedOut,
      secret,
      secretVerdict,
      secretObserved,
      secretStderr,
      secretError,
      secretCause,
      secretAggregate,
      cleanError,
    }) => {
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
        optionA: secret
          ? opaqueFixtureCredential
          : "Clean pure domain queue selection function implementation",
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

          if (secretError) throw new Error(opaqueFixtureCredential);
          if (secretAggregate)
            throw new AggregateError(
              [new Error("safe failure"), new Error(opaqueFixtureCredential)],
              "Judge transports failed",
            );
          if (secretCause) {
            throw new Error("Judge transport failed", {
              cause: new Error("Connection closed", {
                cause: new Error(opaqueFixtureCredential),
              }),
            });
          }
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
                claim: secretVerdict
                  ? opaqueFixtureCredential
                  : "Option A resolves all boundary conditions correctly",
              },
            ],
          };

          return {
            exitCode: secretStderr ? 1 : 0,
            timedOut,
            stdout: JSON.stringify(judgeOutput),
            stderr: secretStderr ? opaqueFixtureCredential : "",
            durationS: 0,
            durationMs: 250,
            observedModel: secretObserved
              ? opaqueFixtureCredential
              : "frontier-judge-v1",
          };
        },
      );

      const runner = createFixtureRunner({ dispatcher: judgeDispatcher });
      if (cleanError) {
        const cause = new Error("Connection closed", { cause: undefined });
        const error = new Error("Judge transport failed", { cause });
        cause.cause = error;
        judgeDispatcher.mockRejectedValueOnce(error);
        await expect(runner.judgeComparison(judge, packet)).rejects.toBe(error);
        expect(judgeDispatcher).toHaveBeenCalledTimes(1);
        return;
      }
      if (
        secret ||
        secretVerdict ||
        secretObserved ||
        secretStderr ||
        secretError ||
        secretCause ||
        secretAggregate
      ) {
        vi.stubEnv("OPENAI_API_KEY", opaqueFixtureCredential);
        try {
          await expect(runner.judgeComparison(judge, packet)).rejects.toThrow(
            /^Secret material found in model qualification evidence\.$/,
          );
          expect(judgeDispatcher).toHaveBeenCalledTimes(secret ? 0 : 1);
        } finally {
          vi.unstubAllEnvs();
        }
        return;
      }
      if (timedOut) {
        await expect(runner.judgeComparison(judge, packet)).rejects.toThrow(
          /timed out/i,
        );
        expect(judgeDispatcher).toHaveBeenCalledTimes(1);
        return;
      }
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
    },
  );

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

  it("TR-025 computes reproducible suite and workflow prompt hashes", async () => {
    let dispatchedHash: string | undefined;
    const runner = createFixtureRunner({
      dispatcher: async ({ workDir, outputSchema }) => {
        const prompt = readFileSync(
          join(workDir!, ".gwrk/plugins/workflows/gwrk-model-judge/PROMPT.md"),
          "utf8",
        );
        expect(outputSchema).toBeDefined();
        dispatchedHash = createHash("sha256")
          .update(JSON.stringify([prompt, outputSchema]))
          .digest("hex");
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            summary: "Blinded comparison verdict",
            intents: [],
            winner: "tie",
            optionARegression: false,
            optionBRegression: false,
            scores: { optionA: 90, optionB: 90 },
            citations: [],
          }),
          stderr: "",
          durationS: 0,
        };
      },
    });
    const { fixtureSuiteHash, workflowPromptHashes } =
      await runner.computeSuiteHashes();

    await runner.judgeComparison(
      { ...candidateRoute, provider: "fixture", family: "judge" },
      {
        comparisonId: "blinded",
        role: "implement",
        fixtureSummary: "Fixture",
        optionA: "A",
        optionB: "B",
        gateEvidenceSummary: "Both passed",
      },
    );
    expect(typeof fixtureSuiteHash).toBe("string");
    expect(fixtureSuiteHash.length).toBe(64);

    expect(workflowPromptHashes).toHaveProperty("define");
    expect(workflowPromptHashes).toHaveProperty("implement");
    expect(workflowPromptHashes).toHaveProperty("review");
    expect(workflowPromptHashes.define.length).toBe(64);
    expect(workflowPromptHashes.implement.length).toBe(64);
    expect(workflowPromptHashes.review.length).toBe(64);
    expect(dispatchedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(workflowPromptHashes["gwrk-model-judge"]).toBe(dispatchedHash);
    expect(await runner.computeSuiteHashes()).toEqual({
      fixtureSuiteHash,
      workflowPromptHashes,
    });
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
            baseline.replace("[x] T001 Repair", "[ ] T001 Repair"),
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
          stdout:
            mode === "structured"
              ? "Review complete. Read the structured result."
              : `Notes {policy} before the result.\n\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\`\nReview finished.`,
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
      expect(result.sanitizedOutput).toContain(verdict.summary);
      expect(result.sanitizedOutput).toContain("T001");
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

  it("TR-023 rejects a credential in plan.md before exporting either definition artifact", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "gwrk-define-out-"));
    vi.stubEnv("OPENAI_API_KEY", opaqueFixtureCredential);
    try {
      const runner = createFixtureRunner({
        dispatcher: async (task) => {
          const isSpecification = task.workflow === "gwrk-specify";
          const file = isSpecification ? "spec.md" : "plan.md";
          const content = isSpecification
            ? "# Generated specification\n"
            : `# Generated plan\n\n${opaqueFixtureCredential}\n`;
          await writeFile(join(task.featureDir!, file), content, "utf8");
          return { exitCode: 0, stdout: "", stderr: "", durationS: 0 };
        },
      });
      await expect(
        runner.runFixtureRepeat({
          fixtureId: "define-long-context",
          role: "define",
          repeatIndex: 0,
          route: candidateRoute,
          artifactOutputDir: outputDir,
        }),
      ).rejects.toThrow(/secret material/i);
      expect(existsSync(join(outputDir, "spec.md"))).toBe(false);
      expect(existsSync(join(outputDir, "plan.md"))).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      await rm(outputDir, { recursive: true, force: true });
    }
  });

  it("TR-023 rejects a credential in repeat stdout before returning evidence", async () => {
    vi.stubEnv("OPENAI_API_KEY", opaqueFixtureCredential);
    try {
      const runner = createFixtureRunner({
        dispatcher: async (task) => {
          await writeFile(
            join(task.workDir!, "src/domain/select-queue.mjs"),
            fixedPassingQueueImplementation,
          );
          return {
            exitCode: 0,
            stdout: opaqueFixtureCredential,
            stderr: "",
            durationS: 0,
          };
        },
      });
      await expect(
        runner.runFixtureRepeat({
          fixtureId: "implement-seeded-defect",
          role: "implement",
          repeatIndex: 0,
          route: candidateRoute,
        }),
      ).rejects.toThrow(/secret material/i);
    } finally {
      vi.unstubAllEnvs();
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
