/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * DIAGNOSE must read the channel its agent actually writes on.
 *
 * `stageDiagnose` asks for `FIX: <file> — <what>` lines and then filtered
 * `result.stdout` line by line for that prefix. ClaudeAdapter runs with
 * `--output-format stream-json` unconditionally
 * (src/plugins/builtins/agents/claude/adapter.ts:72), so every stdout line is a
 * JSON event and none of them starts with "FIX:". The stage reported
 * "⚠ diagnosis produced no FIX: lines" on every run while the model returned
 * perfectly good ones — 029 phase-03 discarded six precise fixes naming
 * src/commands/adr.ts:125, :113-118 and the loadConfig(projectRoot) hoist, then
 * spent three iterations rediscovering them and tripped the circuit breaker.
 *
 * The breaker's own comment says DIAGNOSE exists to "prevent blind retry
 * loops". With its output thrown away every retry was blind.
 *
 * Same defect class as `{{enforcement}}` (agent.ts:535) and the
 * `{{architecture}}` placeholders in gwrk-ontology-construct: production reads
 * a channel the producer never writes to.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as stateUtils from "../utils/state.js";
import * as agentUtils from "../utils/agent.js";
import fs from "node:fs";

vi.mock("../utils/state.js");
vi.mock("node:fs");
vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi
    .fn()
    .mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execSync: vi.fn(), exec: vi.fn(), execFile: vi.fn() };
});

const mockConfig = {
  cwd: "/root",
  featureId: "029-decision-records",
  phaseId: "phase-03",
  backend: "claude",
  maxIterations: 3,
};

/** A phase with one open task carrying a review finding, so DIAGNOSE runs. */
const stateWithFinding = () => ({
  featureId: "029-decision-records",
  createdAt: "2026-08-27T00:00:00.000Z",
  phases: [
    {
      id: "phase-03",
      title: "dispatch",
      tasks: [
        {
          id: "T011",
          title: "Modify adr.ts",
          description:
            "seed\n\nREVIEW FAIL (code): `pnpm lint` fails on adr.ts — implicit `any` in the dispatch path.",
          status: "open" as const,
          gateScript: "gates/T011-gate.sh",
        },
      ],
    },
  ],
});

/** The two FIX lines the diagnostician returns, as prose. */
const FIX_ONE =
  'FIX: src/commands/adr.ts — Change line 125 `let workflowResult;` to `let workflowResult: Awaited<ReturnType<WorkflowRuntime["executeWorkflow"]>>;`';
const FIX_TWO =
  "FIX: src/commands/adr-dispatch.test.ts — Assert loadConfig is called with the resolved projectRoot, not cwd";

/**
 * What ClaudeAdapter actually puts on stdout: newline-delimited JSON events,
 * the answer carried in the trailing `result` event. Shape taken verbatim from
 * .runs/2026-08-27T23-44-21_gwrk-implement_029-decision-records.jsonl, whose
 * event census was {system: 3, assistant: 1, rate_limit_event: 1, result: 1}.
 */
const streamJson = (answer: string) =>
  [
    JSON.stringify({ type: "system", subtype: "init", model: "claude-opus-5" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: answer }] },
    }),
    JSON.stringify({ type: "rate_limit_event", rate_limit_info: {} }),
    JSON.stringify({ type: "result", subtype: "success", result: answer }),
  ].join("\n");

/** The task descriptions DIAGNOSE persisted, if it persisted any. */
function savedDescriptions(): string[] {
  const calls = vi.mocked(stateUtils.saveTaskState).mock.calls;
  if (calls.length === 0) return [];
  const state = calls[calls.length - 1][1] as ReturnType<
    typeof stateWithFinding
  >;
  return state.phases.flatMap((p) => p.tasks.map((t) => t.description ?? ""));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fs.existsSync).mockReturnValue(true);
  vi.mocked(stateUtils.loadTaskState).mockReturnValue(
    stateWithFinding() as never,
  );
  vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
    exitCode: 0,
    stdout: "",
    stderr: "",
  } as never);
});

describe("DIAGNOSE output parsing", () => {
  it("recovers FIX lines from stream-json stdout", async () => {
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: streamJson(`${FIX_ONE}\n\n${FIX_TWO}`),
      stderr: "",
    } as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    const persisted = savedDescriptions().join("\n");
    expect(persisted).toContain(FIX_ONE);
    expect(persisted).toContain(FIX_TWO);
  });

  it("still reads FIX lines from a plain-text agent", async () => {
    // codex and agy do not wrap stdout in stream-json. The recovery must not
    // regress the adapters that already worked.
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: `Here is what I found.\n${FIX_ONE}\n${FIX_TWO}\n`,
      stderr: "",
    } as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    const persisted = savedDescriptions().join("\n");
    expect(persisted).toContain(FIX_ONE);
    expect(persisted).toContain(FIX_TWO);
  });

  it("persists nothing when the diagnostician returns no FIX lines", async () => {
    // Absence must stay absence. Recovering from the wrong channel is the bug;
    // inventing fixes from prose would be a worse one.
    vi.mocked(agentUtils.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: streamJson("I could not determine a fix."),
      stderr: "",
    } as never);
    const orchestrator = new ShipOrchestrator(mockConfig as never);

    // @ts-ignore private
    await orchestrator.stageDiagnose();

    expect(savedDescriptions().join("\n")).not.toContain("DIAGNOSIS");
  });
});
