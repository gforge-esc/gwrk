/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { ShipOrchestrator } from "./ship-orchestrator.js";
import * as reviewPlugin from "../plugins/review-plugin.js";
import * as stateUtils from "../utils/state.js";
import { conditionPrompt } from "./prompt-conditioner.js";
import { detectProfile } from "./profile-detector.js";
import { ShipStage } from "./ship-types.js";
import { activatePhaseTests } from "./test-activator.js";
import { execSync } from "node:child_process";
import fs from "node:fs";

vi.mock("./prompt-conditioner.js");
vi.mock("./profile-detector.js");
vi.mock("../plugins/review-plugin.js");
vi.mock("../utils/state.js");
vi.mock("../utils/gate-runner.js");
vi.mock("./test-activator.js");
vi.mock("node:fs");
// Mock the dynamic import of PluginLoader used in executeReviewWorkflow
vi.mock("../plugins/loader.js", () => ({
  PluginLoader: vi.fn().mockImplementation(() => ({
    resolvePlugin: vi.fn().mockResolvedValue({
      path: "/mock/plugins/review-code-cli",
      manifest: { name: "review-code-cli" },
    }),
  })),
}));
vi.mock("../utils/agent.js", () => ({
  dispatchToAgent: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" }),
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execSync: vi.fn(),
    exec: vi.fn(),
    execFile: vi.fn(),
  };
});

describe("ShipOrchestrator Review Plugin Integration", () => {
  const mockConfig = {
    cwd: "/root",
    featureId: "F1",
    phaseId: "phase-1",
    backend: "gemini",
    maxIterations: 3,
  };

  const mockPlugin = {
    name: "review-cli",
    version: "1.0.0",
    description: "CLI Review",
    projectType: "cli",
    codeReviewWorkflow: "review-code-cli",
    uatReviewWorkflow: "review-uat-cli",
    steps: {
      code: [{ id: "lint", title: "Linting", description: "Check lint" }],
      uat: [{ id: "e2e", title: "E2E", description: "Run E2E" }],
    },
  };

  const mockTaskState = {
    phases: [
      {
        id: "phase-1",
        tasks: [{ id: "T1", title: "Task 1", status: "completed" }],
        doneWhen: ["Story 1"],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reviewPlugin.resolveReviewPlugin).mockResolvedValue(mockPlugin as any);
    vi.mocked(stateUtils.loadTaskState).mockReturnValue(mockTaskState as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("# Mock Review Prompt\n\nFull production prompt content here.");
    vi.mocked(detectProfile).mockResolvedValue({ type: 'gwrk-native', stack: {}, layout: 'flat' });
    vi.mocked(conditionPrompt).mockImplementation((p) => `<conditioned>${p}</conditioned>`);
  });

  it("TR-015: stageCodeReview resolves plugin and dispatches via PluginLoader + raw dispatch", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);

    // @ts-ignore - accessing private method for testing
    await orchestrator.stageCodeReview();

    // 1. Must resolve the review plugin to get workflow name
    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");

    // 2. Must attempt to load PROMPT.md from the resolved plugin path
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();

    // Phase 13: Must condition the prompt
    expect(detectProfile).toHaveBeenCalledWith("/root");
    expect(conditionPrompt).toHaveBeenCalled();

    // 3. Must validate phase scope after dispatch
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });

  it("TR-015: stageUatReview resolves plugin and dispatches via PluginLoader + raw dispatch", async () => {
    const orchestrator = new ShipOrchestrator(mockConfig as any);

    // @ts-ignore - accessing private method for testing
    await orchestrator.stageUatReview();

    // 1. Must resolve the review plugin to get workflow name
    expect(reviewPlugin.resolveReviewPlugin).toHaveBeenCalledWith("/root");

    // 2. Must attempt to load PROMPT.md from the resolved plugin path
    expect(fs.existsSync).toHaveBeenCalled();
    expect(fs.readFileSync).toHaveBeenCalled();

    // Phase 13: Must condition the prompt
    expect(detectProfile).toHaveBeenCalledWith("/root");
    expect(conditionPrompt).toHaveBeenCalled();

    // 3. Must validate phase scope after dispatch
    expect(reviewPlugin.validatePhaseScope).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 025-gate-only-phases — Fix B: TEST_GATE positively verifies a test-less
// gate-only phase by running its Done-When gate (pass iff exit 0), and
// ACTIVATE_TESTS scopes RED-liveness to test-driven phases. The test-less vs
// test-driven discriminator is getPhaseTestFiles() (post-Fix-A): [] ⇒ test-less.
// ─────────────────────────────────────────────────────────────────────────────

const cfg = {
  cwd: "/root",
  featureId: "F1",
  phaseId: "phase-1",
  backend: "gemini",
  maxIterations: 3,
};

const collectLogs = () => {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  return () => spy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
};

describe("TR-004 (FR-004, US-003): TEST_GATE verifies a test-less phase by its Done-When gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectProfile).mockResolvedValue({
      type: "gwrk-native",
      stack: { language: "javascript" },
      layout: "flat",
    } as any);
  });

  it("test-less phase passes via green Done-When gate", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    // Post-Fix-A discovery: a pure schema phase maps no real test → test-less.
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue([]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-1",
          tasks: [{ id: "T1", title: "schema", status: "completed" }],
          testTargets: ["prisma/schema.prisma"],
          doneWhen: ['grep -q "model User" prisma/schema.prisma'],
        },
      ],
    } as any);
    // Done-When gate exits 0.
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    expect(logs()).toContain("Done-When gate passed");
    // Must NOT treat the config target as a scoped test suite.
    expect(logs()).not.toMatch(/scoped to:/);
    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });

  it("test-less phase NO-GOs on red Done-When gate", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue([]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-1",
          tasks: [{ id: "T1", title: "schema", status: "completed" }],
          testTargets: ["prisma/schema.prisma"],
          doneWhen: ['grep -q "model Ghost" prisma/schema.prisma'],
        },
      ],
    } as any);
    // Done-When gate exits non-zero.
    vi.mocked(execSync).mockImplementation(() => {
      const e: any = new Error("gate failed");
      e.status = 1;
      e.stdout = Buffer.from("");
      e.stderr = Buffer.from("grep: no match");
      throw e;
    });
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    expect(logs()).toContain("Done-When gate failed");
    // handleNoGo routes a NO-GO through DIAGNOSE before retry.
    expect(result.nextStage).toBe(ShipStage.DIAGNOSE);
  });

  it("test-less phase passes via its compiled task.gateScript (empty doneWhen — the real 004 shape)", async () => {
    // The canonical form: the fenced `#### Done When` compiled onto
    // task.gateScript; phase.doneWhen is EMPTY. This is exactly the real
    // data-dashboard shape that Fix B originally missed by reading doneWhen.
    const orch = new ShipOrchestrator(cfg as any);
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue([]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-1",
          tasks: [
            {
              id: "T1",
              title: "config+schema",
              status: "completed",
              gateScript:
                'grep -qE "^GITHUB_TOKEN=" .env.example\nmake config:inspect | tail -1 | grep -q PASSED',
            },
          ],
          // no doneWhen — the real gate lives in task.gateScript
        },
      ],
    } as any);
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    expect(logs()).toContain("Done-When gate passed");
    expect(logs()).not.toMatch(/scoped to:/);
    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });
});

describe("TR-005 (FR-005, US-004): ACTIVATE_TESTS scopes RED-liveness to test-driven phases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectProfile).mockResolvedValue({
      type: "gwrk-native",
      stack: { language: "javascript" },
      layout: "flat",
    } as any);
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [{ id: "phase-1", tasks: [{ id: "T1", status: "completed" }], doneWhen: [] }],
    } as any);
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
  });

  it("ACTIVATE_TESTS passes a test-less phase without RED-liveness", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue([]);
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageActivateTests();

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(logs()).toContain("no phase-scoped test files found");
  });

  it("ACTIVATE_TESTS NO-GOs a test-driven phase that runs 0 tests", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue(["src/foo.test.js"]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    // Tests activate (un-skip) so the RED suite actually runs.
    vi.mocked(activatePhaseTests).mockReturnValue({
      activated: 1,
      files: ["src/foo.test.js"],
    });
    collectLogs();

    // @ts-ignore - private
    const result = await orch.stageActivateTests();

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });
});

describe("TR-006 (SEAM, FR-001/FR-003/FR-004): the Run #2207 case end-to-end", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectProfile).mockResolvedValue({
      type: "gwrk-native",
      stack: { language: "javascript" },
      layout: "flat",
    } as any);
  });

  it("runs the real co-located test, not the config target", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    // getPhaseTestFiles runs for real over a controlled fs: the config target
    // (.env.example) MUST be dropped (Fix A) so it is never scoped as a test.
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 1,
      passed: 1,
      output: "1 passed",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-1",
          tasks: [
            {
              id: "T1",
              title: "config reader",
              description: "Create src/config/env.js",
              status: "completed",
            },
          ],
          testTargets: [".env.example"],
          doneWhen: [],
        },
      ],
    } as any);
    vi.mocked(fs.existsSync).mockImplementation((p: any) => {
      const s = String(p);
      return s.endsWith(".env.example") || s.endsWith("src/config/env.test.js");
    });
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    // The config file must never appear in the scoped suite.
    expect(logs()).not.toContain(".env.example");
    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });

  it("pure-schema phase passes via green Done-When gate", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue([]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [
        {
          id: "phase-1",
          tasks: [{ id: "T1", title: "migration", status: "completed" }],
          testTargets: ["prisma/migrations/001_init.sql"],
          doneWhen: ["pnpm config:inspect --check"],
        },
      ],
    } as any);
    vi.mocked(execSync).mockReturnValue(Buffer.from(""));
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    expect(logs()).toContain("Done-When gate passed");
    expect(logs()).not.toMatch(/scoped to:/);
    expect(result.success).toBe(true);
    expect(result.nextStage).toBe(ShipStage.CODE_REVIEW);
  });
});

describe("TR-007 (GUARD, FR-006): a real test suite that runs 0 tests still NO-GOs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(detectProfile).mockResolvedValue({
      type: "gwrk-native",
      stack: { language: "javascript" },
      layout: "flat",
    } as any);
    vi.mocked(stateUtils.loadTaskState).mockReturnValue({
      phases: [{ id: "phase-1", tasks: [{ id: "T1", status: "completed" }], doneWhen: [] }],
    } as any);
  });

  it("still NO-GOs a real test suite that runs 0 tests", async () => {
    const orch = new ShipOrchestrator(cfg as any);
    // A real *.test.* maps → the phase stays test-driven → liveness still fires.
    vi.spyOn(orch as any, "getPhaseTestFiles").mockResolvedValue(["src/engine/foo.test.js"]);
    vi.spyOn(orch as any, "runTestSuite").mockResolvedValue({
      failCount: 0,
      testsRun: 0,
      passed: 0,
      output: "",
    });
    const logs = collectLogs();

    // @ts-ignore - private
    const result = await orch.stageTestGate();

    expect(logs()).toContain("executed 0 tests");
    expect(result.nextStage).toBe(ShipStage.DIAGNOSE);

    // Discriminator: the real test still maps (non-empty) — the phase is
    // test-driven, so Fix B's test-less Done-When path is NOT taken here.
    // @ts-ignore - private
    const mapped = await orch.getPhaseTestFiles();
    expect(mapped.length).toBeGreaterThan(0);
  });
});
