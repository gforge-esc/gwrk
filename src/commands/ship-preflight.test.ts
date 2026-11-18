/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAgentPortAdapter } from "../adapters/agents/index.js";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { AgentPort } from "../ports/agent-port.js";

const { mockLoadSetupState, mockIsSetupComplete } = vi.hoisted(() => ({
  mockLoadSetupState: vi.fn(),
  mockIsSetupComplete: vi.fn(),
}));

vi.mock("../utils/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/config.js")>()),
  loadConfig: () => ({
    project: { name: "test", slack: {} },
    agents: { implement: "gemini" },
    parallelism: { local: { maxClones: 2 } },
  }),
}));

vi.mock("../adapters/agents/index.js", () => ({
  createAgentPortAdapter: vi.fn(),
}));

vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(() => ({
    on: vi.fn(),
    run: vi.fn().mockResolvedValue(0),
    getResult: vi.fn().mockReturnValue({}),
  })),
}));

vi.mock("../server/ship-bridge.js", () => ({ ShipBridge: vi.fn() }));
vi.mock("../engine/plan-store.js", () => ({ PlanStore: vi.fn() }));
vi.mock("../utils/exec.js", () => ({ run: vi.fn(async () => undefined) }));
vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: vi.fn(),
  assembleDigest: vi.fn(),
}));
vi.mock("../utils/git.js", () => ({
  getCurrentCommit: () => "fixture-commit",
  getCurrentBranch: () => "fixture-branch",
  getDiffStats: () => ({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
  isWorkingTreeClean: () => true,
}));

vi.mock("../utils/resolve-feature.js", () => ({
  resolveFeature: vi.fn().mockImplementation((f: string) => f),
}));

vi.mock("../db/runs.js", () => ({
  startRun: vi.fn(() => 999),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));

vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: mockLoadSetupState,
  isSetupComplete: mockIsSetupComplete,
  saveSetupState: vi.fn(),
}));

import { resolveFeature } from "../utils/resolve-feature.js";
import { createShipCommand } from "./ship.js";

const selectRoute = vi.fn<AgentPort["selectRoute"]>(async () => ({
  backend: "gemini",
  model: "fixture-model",
  effort: "medium",
  mode: "selected",
  reason: "fixture route",
  fallbackUsed: false,
  modelFailoverUsed: false,
}));

describe("gwrk ship: Pre-flight Setup Check (Phase 10)", () => {
  let tempDir: string;
  let program: Command;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAgentPortAdapter).mockReturnValue({
      execute: vi.fn(),
      selectRoute,
    });
    process.exitCode = 0;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ship-preflight-test-"));

    const featureDir = path.join(tempDir, "specs", "test-feature");
    const gwrkDir = path.join(featureDir, ".gwrk");
    fs.mkdirSync(gwrkDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec");
    fs.writeFileSync(path.join(tempDir, "fixture.test.ts"), "");
    fs.writeFileSync(
      path.join(gwrkDir, "tasks.json"),
      JSON.stringify({
        featureId: "test-feature",
        createdAt: new Date().toISOString(),
        phases: [
          {
            id: "phase-01",
            title: "Phase 1",
            testTargets: ["fixture.test.ts"],
            tasks: [
              {
                id: "T001",
                title: "Task 1",
                status: "open",
                description: "Desc",
                gateScript: "gates/T001-gate.sh",
              },
            ],
            sp_estimate: 0,
          },
        ],
      }),
    );

    program = new Command();
    program.addCommand(createShipCommand());

    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resolveFeature).mockReturnValue("test-feature");
    mockLoadSetupState.mockReset();
    mockIsSetupComplete.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it("US-021: SHOULD reject ship if setup.json is missing", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);
    await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Run gwrk init first"),
    );
    expect(selectRoute).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
  });

  it("rejects ship when workstation setup is incomplete", async () => {
    mockLoadSetupState.mockReturnValue({
      steps: { tcc: false, ssh: false, gh: false, verification: false },
    });
    mockIsSetupComplete.mockReturnValue(false);

    await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);

    expect(process.exitCode).toBe(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Run gwrk init first"),
    );
    expect(selectRoute).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
  });

  it("previews routing without workstation setup", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "test-feature",
      "1",
      "--dry-run",
    ]);

    expect(process.exitCode).toBe(0);
    expect(mockIsSetupComplete).not.toHaveBeenCalled();
    expect(selectRoute).toHaveBeenCalledOnce();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
  });

  it("reports the fixture route in dry-run", async () => {
    mockLoadSetupState.mockReturnValue(null);
    mockIsSetupComplete.mockReturnValue(false);

    await program.parseAsync([
      "node",
      "test",
      "ship",
      "test-feature",
      "1",
      "--dry-run",
    ]);

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "backend: gemini, model: fixture-model, effort: medium",
      ),
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
  });

  it("runs the orchestrator when workstation setup is complete", async () => {
    mockLoadSetupState.mockReturnValue({
      steps: { tcc: true, ssh: true, gh: true, verification: true },
    });
    mockIsSetupComplete.mockReturnValue(true);

    await program.parseAsync(["node", "test", "ship", "test-feature", "1"]);

    expect(ShipOrchestrator).toHaveBeenCalledOnce();
    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });
});
