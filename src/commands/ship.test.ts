/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverGitIdentityFacts } from "../adapters/git/project-id.js";
import { getDb, getTestDb } from "../db/index.js";
import { normalizeRegistryRepo } from "../db/project-registry.js";
import * as runsModule from "../db/runs.js";
import { PlanStore } from "../engine/plan-store.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import {
  listRoutingDecisions,
  recordDecision,
} from "../server/routing-decisions.js";
import * as execModule from "../utils/exec.js";
import * as uiModule from "../utils/format.js";
import { resolveProjectId } from "../utils/project-id.js";
import * as stateModule from "../utils/state.js";
import {
  loadSetupState,
  isSetupComplete,
} from "../utils/setup-state.js";
import { shipCommand } from "./ship.js";

vi.mock("../db/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/index.js")>();
  return { ...actual, getDb: vi.fn() };
});

let routingDb: ReturnType<typeof getTestDb>;
beforeEach(() => {
  routingDb = getTestDb();
  vi.mocked(getDb).mockReturnValue(routingDb);
});
afterEach(() => routingDb.close());

// Mock dependencies
vi.mock("../utils/exec.js", () => ({
  run: vi.fn(),
  runGate: vi.fn(),
}));

// Command tests exercise orchestration arguments and output without running
// the orchestrator against the checkout that is running this suite.
vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    run: vi.fn().mockResolvedValue(0),
    getResult: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: vi.fn(),
  isSetupComplete: vi.fn().mockReturnValue(true),
}));

vi.mock("../server/slack-notify.js", () => ({
  notifySlack: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../engine/plan-store.js", () => ({
  PlanStore: vi.fn().mockImplementation(() => ({
    getPlanStatus: () => ({ features: [] }),
    markPhaseShipped: vi.fn(),
    reconcileFeatureStatus: vi.fn(),
  })),
}));

vi.mock("../utils/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/config.js")>();
  return {
    ...actual,
    loadConfig: vi.fn().mockReturnValue({
      project: {
        name: "test",
        slack: { channelId: "C123", channelName: "test" },
      },
      agents: {
        implement: "mock-agent",
        define: "mock-agent",
      },
      server: { port: 18790, host: "localhost" },
    }),
  };
});

vi.mock("../db/runs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/runs.js")>();
  return {
    ...actual,
    startRun: vi.fn().mockReturnValue(999),
    finishRun: vi.fn(),
    recordHistory: vi.fn(),
  };
});

vi.mock("../utils/format.js", () => ({
  fail: vi.fn(),
  success: vi.fn(),
  banner: vi.fn(),
  dryRun: vi.fn(),
  blocked: vi.fn(),
  color: {
    BOLD: "",
    DIM: "",
    CYAN: "",
    GREEN: "",
    YELLOW: "",
    RED: "",
    MAGENTA: "",
    RESET: "",
  },
}));

vi.mock("../utils/state.js", () => ({
  loadTaskState: vi.fn().mockReturnValue({
    phases: [
      {
        id: "phase-01",
        tasks: [{ id: "T001", title: "Task 1", status: "open" }],
      },
      {
        id: "phase-02",
        tasks: [{ id: "T002", title: "Task 2", status: "open" }],
      },
    ],
  }),
  markTaskComplete: vi.fn(),
  saveTaskState: vi.fn(),
}));

vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn().mockReturnValue("mock-run-id"),
  assembleDigest: vi.fn().mockReturnValue(["BRANCH_SETUP: created feat/004-ship-loop", "IMPLEMENT: agent completed"]),
}));

vi.mock("../utils/git.js", () => ({
  getCurrentCommit: vi.fn().mockReturnValue("mock-commit"),
  getCurrentBranch: vi.fn().mockReturnValue("mock-branch"),
  isDirty: vi.fn().mockResolvedValue(false),
  isWorkingTreeClean: vi.fn().mockReturnValue(true),
  createBranch: vi.fn().mockResolvedValue(undefined),
  syncBranch: vi.fn().mockResolvedValue(undefined),
  getDiffStats: vi
    .fn()
    .mockReturnValue({ filesChanged: 1, linesAdded: 1, linesDeleted: 1 }),
}));

// Default fs.existsSync to true so ship's pre-flight checks pass.
// Tests that need specific existsSync behavior override with their own spy.
vi.spyOn(fs, "existsSync").mockReturnValue(true);

describe("shipCommand", () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun = vi.mocked(execModule.run);

    program = new Command();
    program.addCommand(shipCommand);

    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("ship with phase should execute work-until-done.sh for that phase", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core", "7", "--legacy"]);

    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
    const [scriptPath, args] = wudCalls[0];

    expect(scriptPath).toContain("work-until-done.sh");
    expect(args).toEqual(["001-cli-core", "7"]);

    expect(runsModule.startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        command: "ship",
        workflow: "work-until-done",
      }),
    );
  });

  it("ship without phase should ship all phases from tasks.json", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core", "--legacy"]);

    // Should call work-until-done.sh twice (phase-01, phase-02 from mock)
    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(2);
    expect(wudCalls[0][1]).toEqual(["001-cli-core", "01"]);
    expect(wudCalls[1][1]).toEqual(["001-cli-core", "02"]);
  });

  it("ship should pass custom max-iterations", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "004-ship-loop",
      "1",
      "--max-iterations",
      "5",
      "--legacy",
    ]);

    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
    const [, , options] = wudCalls[0];
    expect(options.env.MAX_ITERATIONS).toBe("5");
  });

  it("ship should pass custom ci-timeout", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "004-ship-loop",
      "1",
      "--ci-timeout",
      "60",
      "--legacy",
    ]);

    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
    const [, , options] = wudCalls[0];
    expect(options.env.CI_TIMEOUT).toBe("60");
  });

  it("should stop on first phase failure", async () => {
    const errorWithCode = new Error("shell error");
    (errorWithCode as unknown as { code: number }).code = 127;
    // mockRun will fail when work-until-done is called. For any subsequent branch or git run it would also fail if called,
    // but the test asserts we fail fast. We use an implementation to conditionally throw.
    mockRun.mockImplementation(async (cmd) => {
      if (typeof cmd === "string" && cmd.includes("work-until-done.sh")) {
        throw errorWithCode;
      }
      return undefined;
    });

    process.exitCode = 0;
    // Ship without phase — should fail on phase-01 and not attempt phase-02
    await program.parseAsync(["node", "test", "ship", "001-cli-core", "--legacy"]);

    expect(process.exitCode).toBe(127);
    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
    expect(runsModule.finishRun).toHaveBeenCalledWith(
      999,
      expect.objectContaining({ exit_code: 127 }),
    );
    expect(uiModule.fail).toHaveBeenCalled();
  });

  it("should support dry-run mode", async () => {
    await program.parseAsync([
      "node",
      "test",
      "ship",
      "--dry-run",
      "001-cli-core",
      "1",
    ]);

    expect(execModule.run).not.toHaveBeenCalled();
    expect(uiModule.dryRun).toHaveBeenCalled();
  });

  it("should support dry-run mode for all phases", async () => {
    await program.parseAsync([
      "node",
      "test",
      "ship",
      "--dry-run",
      "001-cli-core",
    ]);

    expect(execModule.run).not.toHaveBeenCalled();
    // Should print dry-run for each phase
    expect(uiModule.dryRun).toHaveBeenCalledTimes(2);
  });

  it("FR-008, US-008: should exit 1 with BLOCKED message if no test files found for phase", async () => {
    // Modify loadTaskState mock to return a task with a source file but no tests
    const mockState = {
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            {
              id: "T001",
              title: "Implement src/commands/ship.ts",
              description: "test",
              status: "open",
              // Forgot-test phase: plan-to-tasks emits the unauthored placeholder
              // (a guaranteed-fail gate), which is NOT real verification, so
              // pre-flight must still block.
              gateScript:
                'echo "FAIL: no test maps to src/commands/ship.ts — author one (FR-001, ADR-005 §10)"; exit 1',
            },
          ],
          doneWhen: [],
        },
      ],
    };
    vi.mocked(stateModule.loadTaskState).mockReturnValueOnce(mockState as any).mockReturnValueOnce(mockState as any);

    // Ensure fs.existsSync returns false for the corresponding test file but true for others
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith(".test.ts")) return false;
      return true;
    });

    // Mock blocked() from uiModule
    const blockedSpy = vi.mocked(uiModule.blocked);

    process.exitCode = 0;
    // We expect process.exit(1)
    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]);

    expect(process.exitCode).toBe(1);
    expect(blockedSpy).toHaveBeenCalledWith(
      expect.stringContaining("[BLOCKED] No test files found for phase-01"),
    );

    existsSpy.mockRestore();
  });

  it("025 Path A (canonical): a phase whose task.gateScript is an authored Done-When proceeds past pre-flight", async () => {
    // The canonical shape: a source deliverable with NO discoverable test, whose
    // fenced `#### Done When` compiled onto task.gateScript (an inline, non-hollow
    // executable gate). phase.doneWhen is EMPTY — this is exactly the real
    // data-dashboard 004 phase-01 case that regressed. Pre-flight must read the
    // task gate and proceed.
    const mockState = {
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            {
              id: "T001",
              title: "Implement src/config/zzgateonly.js",
              description: "config reader",
              status: "open",
              gateScript:
                'grep -qE "^GITHUB_TOKEN=" .env.example\nmake config:inspect | tail -1 | grep -q "config:inspect PASSED"',
            },
          ],
          // Empty — the real gate lives in task.gateScript, not here.
        },
      ],
    };
    vi.mocked(stateModule.loadTaskState).mockReturnValue(mockState as any);

    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && (p.endsWith(".test.ts") || p.endsWith(".test.js"))) return false;
      return true;
    });

    const blockedSpy = vi.mocked(uiModule.blocked);
    mockRun.mockResolvedValue(undefined);

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1", "--legacy"]);

    expect(blockedSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("No test files found"),
    );
    const wudCalls = mockRun.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("work-until-done.sh"),
    );
    expect(wudCalls.length).toBe(1);

    existsSpy.mockRestore();
  });

  it("025 Path A (prose fallback): a phase whose only gate is a doneWhen prose bullet proceeds", async () => {
    // Legacy authoring: Done-When as prose bullets → phase.doneWhen. The task
    // gate is the unauthored placeholder (no fenced block), so the phase gate
    // comes from the doneWhen fallback.
    const mockState = {
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            {
              id: "T001",
              title: "Implement src/config/zzgateonly.js",
              description: "config reader",
              status: "open",
              gateScript:
                'echo "FAIL: no test maps to src/config/zzgateonly.js — author one (FR-001, ADR-005 §10)"; exit 1',
            },
          ],
          doneWhen: ['grep -q "model User" prisma/schema.prisma'],
        },
      ],
    };
    vi.mocked(stateModule.loadTaskState).mockReturnValue(mockState as any);

    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && (p.endsWith(".test.ts") || p.endsWith(".test.js"))) return false;
      return true;
    });

    const blockedSpy = vi.mocked(uiModule.blocked);
    mockRun.mockResolvedValue(undefined);

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1", "--legacy"]);

    expect(blockedSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("No test files found"),
    );
    const wudCalls = mockRun.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("work-until-done.sh"),
    );
    expect(wudCalls.length).toBe(1);

    existsSpy.mockRestore();
  });

  it("should exit 1 without side effects when feature spec.md does not exist", async () => {
    // Mock fs.existsSync: spec.md returns false, everything else returns true
    const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith("spec.md")) return false;
      return true;
    });

    // Mock readdirSync and statSync for the available-features listing
    const readdirSpy = vi
      .spyOn(fs, "readdirSync")
      .mockReturnValue([] as unknown as ReturnType<typeof fs.readdirSync>);

    process.exitCode = 0;
    await program.parseAsync([
      "node",
      "test",
      "ship",
      "nonexistent-feature",
      "1",
    ]);

    expect(process.exitCode).toBe(1);
    // No shell script should have been invoked
    expect(execModule.run).not.toHaveBeenCalled();
    // No DB recording either
    expect(runsModule.startRun).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    readdirSpy.mockRestore();
  });

  it("FR-022: should exit 1 with BLOCKED message if workstation setup is incomplete", async () => {
    vi.mocked(isSetupComplete).mockReturnValueOnce(false);
    const blockedSpy = vi.mocked(uiModule.blocked);

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "ship", "001-cli-core", "1"]);

    expect(process.exitCode).toBe(1);
    expect(blockedSpy).toHaveBeenCalledWith(
      expect.stringContaining("Run gwrk init first"),
    );
  });

  it("FR-009/T009: Agent config hierarchy: --agent override takes precedence", async () => {
    mockRun.mockResolvedValue(undefined);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "004-ship-loop",
      "1",
      "--agent",
      "claude",
      "--legacy",
    ]);

    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
    const [, , options] = wudCalls[0];
    // Should pass the agent to WUD via env or arg
    expect(options.env.AGENT_BACKEND).toBe("claude");
  });


});

vi.mock("../server/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/index.js")>();
  return {
    ...actual,
    getBackendSelector: vi.fn().mockReturnValue({
      selectBackend: vi.fn().mockResolvedValue({
        backend: "router-selected-agent",
        model: "router-selected-model",
        reason: "highest quota",
        quotaPercent: 99,
        probeStatus: "fresh",
        fallbackUsed: false,
        modelFailoverUsed: false,
      }),
    }),
  };
});

describe("BackendSelector Integration", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("should use selectBackend() when no --agent override is provided", async () => {
    const { getBackendSelector } = await import("../server/index.js");
    const mockSelector = getBackendSelector() as any;
    
    vi.mocked(execModule.run).mockResolvedValue(undefined);
    await program.parseAsync(["node", "test", "ship", "001-cli-core", "1", "--legacy"]);

    expect(mockSelector.selectBackend).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: resolveProjectId(process.cwd()) }),
    );
    
    const wudCalls = vi.mocked(execModule.run).mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls[0][2].env.AGENT_BACKEND).toBe("router-selected-agent");
    expect(wudCalls[0][2].env.GEMINI_MODEL).toBe("router-selected-model");
  });

  it("uses the verified checkout owner for routing and the run ledger", async () => {
    const { getBackendSelector } = await import("../server/index.js");
    const selector = getBackendSelector();
    const { startRun } =
      await vi.importActual<typeof runsModule>("../db/runs.js");
    const checkout = fs.realpathSync(
      fs.mkdtempSync(path.join(tmpdir(), "gwrk-ship-origin-")),
    );
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(checkout);
    const feature = "001-cli-core";
    try {
      execFileSync("git", ["init", "--quiet", checkout]);
      const spec = path.join(checkout, "specs", feature);
      fs.mkdirSync(spec, { recursive: true });
      fs.writeFileSync(path.join(spec, "spec.md"), "# Ship fixture\n");
      const localId = resolveProjectId(checkout);
      const priorRun = startRun(
        { feature_id: feature, command: "local" },
        routingDb,
      );
      execFileSync("git", [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        "https://github.com/org/alpha.git",
      ]);
      const remoteId = resolveProjectId(checkout);
      expect(remoteId).not.toBe(localId);

      const selectBackend = vi.mocked(selector.selectBackend);
      const select = selectBackend.getMockImplementation()!;
      selectBackend.mockImplementationOnce(async (context) => {
        const selection = await select(context);
        recordDecision(
          {
            ...context,
            selectedBackend: selection.backend,
            reason: selection.reason,
            probeStatus: selection.probeStatus,
          },
          routingDb,
        );
        return selection;
      });
      vi.mocked(runsModule.startRun).mockImplementationOnce(startRun);

      await program.parseAsync(["node", "test", "ship", feature, "1", "--legacy"]);

      const [selection] = selectBackend.mock.calls[0];
      const runs = runsModule.listRuns(feature, localId, routingDb);
      expect(runs).toMatchObject([
        { command: "ship", project_id: localId },
        { id: priorRun, command: "local", project_id: localId },
      ]);
      expect(listRoutingDecisions(localId, selection.runId, routingDb))
        .toMatchObject([{ projectId: localId, feature }]);
      expect(listRoutingDecisions(remoteId, selection.runId, routingDb))
        .toEqual([]);
    } finally {
      cwd.mockRestore();
      fs.rmSync(checkout, { recursive: true, force: true });
    }
  });

  it.each(["SQLITE_CANTOPEN", "SQLITE_CANTOPEN_ISDIR"])(
    "ships with the default backend when the ledger open fails with %s",
    async (code) => {
      const { getBackendSelector } = await import("../server/index.js");
      const selector = getBackendSelector();
      vi.mocked(getDb).mockImplementation(() => {
        throw Object.assign(new Error("unable to open database file"), { code });
      });
      process.exitCode = 0;

      await program.parseAsync(["node", "test", "ship", "001-cli-core", "7"]);

      expect(process.exitCode).toBe(0);
      expect(selector.selectBackend).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: resolveProjectId(process.cwd()),
          ledgerAvailable: false,
        }),
      );
      expect(
        vi.mocked(ShipOrchestrator).mock.results[0]?.value.run,
      ).toHaveBeenCalledOnce();
      expect(getDb).toHaveBeenCalledOnce();
      expect(runsModule.startRun).not.toHaveBeenCalled();
      expect(runsModule.finishRun).not.toHaveBeenCalled();
      expect(runsModule.recordHistory).not.toHaveBeenCalled();
      expect(PlanStore).not.toHaveBeenCalled();
    },
  );

  it.each([
    { backend: "default", agentArgs: [] },
    { backend: "explicit", agentArgs: ["--agent", "forced-agent"] },
  ])(
    "rejects conflicting checkout ownership with the $backend backend",
    async ({ agentArgs }) => {
      const { getBackendSelector } = await import("../server/index.js");
      const selector = getBackendSelector();
      const id = resolveProjectId(process.cwd());
      routingDb
        .prepare(
          "INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, '', ?)",
        )
        .run(id, "Different repository", "other.example/conflicting/repo");
      process.exitCode = 0;

      await program.parseAsync([
        "node", "test", "ship", "001-cli-core", "7", ...agentArgs,
      ]);

      expect(process.exitCode).toBe(1);
      expect(selector.selectBackend).not.toHaveBeenCalled();
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(runsModule.startRun).not.toHaveBeenCalled();
    },
  );

  it("forwards the canonical checkout ID in a dry run", async () => {
    const { getBackendSelector } = await import("../server/index.js");
    const selector = getBackendSelector();
    const { remoteOriginUrl } = discoverGitIdentityFacts(process.cwd());
    routingDb
      .prepare("INSERT INTO projects (id, name, path, github_repo) VALUES (?, ?, ?, ?)")
      .run("canonical", "Checkout", process.cwd(), normalizeRegistryRepo(remoteOriginUrl ?? null));
    routingDb
      .prepare("INSERT INTO project_aliases (alias_id, project_id) VALUES (?, ?)")
      .run(resolveProjectId(process.cwd()), "canonical");

    await program.parseAsync([
      "node", "test", "ship", "001-cli-core", "1", "--dry-run",
    ]);

    expect(selector.selectBackend).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "canonical" }),
    );
  });

  it("should skip selectBackend() when --agent override IS provided", async () => {
    const { getBackendSelector } = await import("../server/index.js");
    const mockSelector = getBackendSelector() as any;
    
    vi.mocked(execModule.run).mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core", "1", "--agent", "forced-agent", "--legacy"]);

    expect(mockSelector.selectBackend).not.toHaveBeenCalled();
    
    const wudCalls = vi.mocked(execModule.run).mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls[0][2].env.AGENT_BACKEND).toBe("forced-agent");
  });
});

describe("FR-014: Phase Skip", () => {
  let mockRun: ReturnType<typeof vi.fn>;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRun = vi.mocked(execModule.run);
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("US-009: should skip phase when all tasks have status 'completed'", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValueOnce({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [{ id: "T001", title: "Task 1", description: "test", status: "completed", gateScript: "gates/T001-gate.sh" }],
          doneWhen: [],
        },
      ],
    });

    process.exitCode = 0;
    const consoleSpy = vi.spyOn(console, "log");
    await program.parseAsync(["node", "test", "ship", "004-ship-loop"]);

    expect(execModule.run).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("all tasks complete — skipping"));
    consoleSpy.mockRestore();
  });

  it("US-009: should skip phase when all tasks are either 'completed' or 'cancelled'", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValueOnce({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "test", status: "completed", gateScript: "gates/T001-gate.sh" },
            { id: "T002", title: "Task 2", description: "test", status: "cancelled", gateScript: "gates/T002-gate.sh" }
          ],
          doneWhen: [],
        },
      ],
    });

    process.exitCode = 0;
    const consoleSpy = vi.spyOn(console, "log");
    await program.parseAsync(["node", "test", "ship", "004-ship-loop"]);

    expect(execModule.run).not.toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("all tasks complete — skipping"));
    consoleSpy.mockRestore();
  });

  it("US-009: should NOT skip phase if mixed open and completed tasks exist", async () => {
    vi.mocked(stateModule.loadTaskState).mockReturnValueOnce({
      featureId: "004-ship-loop",
      createdAt: new Date().toISOString(),
      generatedFrom: { plan: { hash: "abc", modifiedAt: "now" } },
      phases: [
        {
          id: "phase-01",
          title: "Phase 1",
          tasks: [
            { id: "T001", title: "Task 1", description: "test", status: "completed", gateScript: "gates/T001-gate.sh" },
            { id: "T002", title: "Task 2", description: "test", status: "open", gateScript: "gates/T002-gate.sh" }
          ],
          doneWhen: [],
        },
      ],
    });

    mockRun.mockResolvedValue(undefined);
    process.exitCode = 0;
    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1", "--legacy"]);

    const wudCalls = mockRun.mock.calls.filter(call => typeof call[0] === "string" && call[0].includes("work-until-done.sh"));
    expect(wudCalls.length).toBe(1);
  });
});

describe("FR-012, FR-017/T003: Execution Manifest Digest", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("US-007/T003: writeManifest receives a manifest object with digest array", async () => {
    vi.mocked(execModule.run).mockResolvedValueOnce(undefined);

    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]);

    const { writeManifest } = await import("../utils/manifest.js");
    const writeManifestMock = vi.mocked(writeManifest);

    expect(writeManifestMock).toHaveBeenCalled();
    // The second argument is the manifest object
    const manifest = writeManifestMock.mock.calls[0][1] as Record<string, unknown>;
    expect(manifest).toHaveProperty("digest");
    expect(Array.isArray(manifest.digest)).toBe(true);
  });

  it("FR-012/T003: Manifest schema includes digest field (negative: missing digest fails validation)", async () => {
    const actual = await vi.importActual<typeof import("../utils/manifest.js")>("../utils/manifest.js");
    const schemaDef = actual.ExecutionManifestSchema.shape;
    expect(schemaDef).toHaveProperty("digest");
  });
});

describe("FR-015/T008: Agent-Native [exit:N | Xs] wrapper", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("US-010/T008: ship command emits [exit:N | Xs] on stderr after completion", async () => {
    vi.mocked(execModule.run).mockResolvedValueOnce(undefined);

    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]);

    // ADR-004: structured signal on stderr
    const stderrOutput = stderrSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");
    expect(stderrOutput).toMatch(/\[exit:\d+ \| [\d.]+s\]/);

    stderrSpy.mockRestore();
  });
});

describe("FR-015/T009: --format json support", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("US-010/T009: --format json emits structured JSON to stdout", async () => {
    vi.mocked(execModule.run).mockResolvedValueOnce(undefined);

    const stdoutSpy = vi.spyOn(process.stdout, "write").mockReturnValue(true);

    await program.parseAsync([
      "node", "test", "ship", "004-ship-loop", "1", "--format", "json",
    ]);

    const stdoutOutput = stdoutSpy.mock.calls
      .map((call) => String(call[0]))
      .join("");

    // Should be valid JSON with required fields
    const parsed = JSON.parse(stdoutOutput);
    expect(parsed).toHaveProperty("feature");
    expect(parsed).toHaveProperty("exitCode");
    expect(parsed).toHaveProperty("durationS");

    stdoutSpy.mockRestore();
  });
});

describe("FR-009/T010: Agent config fail-fast", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
  });

  it("reports invalid config before recording a ship run", async () => {
    const configModule = await import("../utils/config.js");
    vi.mocked(configModule.loadConfig).mockImplementationOnce(() => {
      throw new Error("Invalid agent configuration");
    });

    process.exitCode = 0;
    await program.parseAsync(["node", "test", "ship", "004-ship-loop", "1"]);

    expect(process.exitCode).toBe(1);
    expect(runsModule.startRun).not.toHaveBeenCalled();
  });
});

describe("Push upstream tracking for new branches", () => {
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    program = new Command();
    program.addCommand(shipCommand);
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit unexpectedly called with "${code}"`);
    });
  });

  it("post-manifest push should use 'git push -u origin <branch>' for upstream tracking", async () => {
    const { getCurrentBranch, isWorkingTreeClean } = await import("../utils/git.js");
    vi.mocked(getCurrentBranch).mockReturnValue("feat/014-plugin-system");
    vi.mocked(isWorkingTreeClean).mockReturnValue(false);

    vi.mocked(execModule.run).mockResolvedValue(undefined);

    await program.parseAsync(["node", "test", "ship", "001-cli-core", "1", "--legacy"]);

    // Find the git push call in the run mock
    const pushCalls = vi.mocked(execModule.run).mock.calls.filter(
      (call) => call[0] === "git" && Array.isArray(call[1]) && call[1].includes("push")
    );

    // Should have at least one push call
    expect(pushCalls.length).toBeGreaterThanOrEqual(1);

    // The push call should include -u origin <branch>
    const pushArgs = pushCalls[0][1] as string[];
    expect(pushArgs).toContain("-u");
    expect(pushArgs).toContain("origin");
    expect(pushArgs).toContain("feat/014-plugin-system");
  });
});
