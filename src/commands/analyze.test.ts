/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DefineOrchestrator } from "../engine/define-orchestrator.js";
import { DefineStage } from "../engine/define-types.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as agent from "../utils/agent.js";

vi.mock("../utils/agent.js", async () => {
  const actual = await vi.importActual<any>("../utils/agent.js");
  return {
    ...actual,
    dispatchToAgent: vi.fn(),
  };
});

describe("analyze.test.ts (TR-009)", () => {
  let tempDir: string;
  const config = {
    featureId: "001-test",
    backend: "gemini",
    cwd: "",
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "analyze-test-"));
    config.cwd = tempDir;

    // Mock workflows
    const workflowsDir = path.join(tempDir, ".gwrk", "plugins", "workflows");
    const workflows = ["gwrk-specify", "gwrk-plan", "gwrk-plan-to-tasks", "gwrk-analyze", "gwrk-define-tests", "gwrk-checklist"];
    for (const w of workflows) {
      const dir = path.join(workflowsDir, w);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "manifest.yaml"), `name: ${w}\ntype: workflow`);
      fs.writeFileSync(path.join(dir, "PROMPT.md"), `Prompt for ${w}`);
    }

    vi.mocked(agent.dispatchToAgent).mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({ summary: "Success", intents: [] }),
      stderr: "",
      durationS: 1,
      logPath: "mock.log"
    });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("should execute ANALYZE stage in the full definition loop", async () => {
    const orchestrator = new DefineOrchestrator(config, {
      stage: DefineStage.ANALYZE,
      featureId: config.featureId,
      startedAt: new Date().toISOString(),
      runId: "test-run",
      backend: config.backend
    });

    const exitCode = await orchestrator.runLoop();
    expect(exitCode).toBe(0);
    expect(agent.dispatchToAgent).toHaveBeenCalledWith(expect.objectContaining({
      workflow: "gwrk-analyze"
    }));
  });

  it("should reject stubs during PLAN stage (TR-009 parity)", async () => {
    const featureDir = path.join(tempDir, "specs", config.featureId);
    fs.mkdirSync(featureDir, { recursive: true });
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Spec\n**Status:** Stub\n");

    const orchestrator = new DefineOrchestrator(config);
    // Should initialize with SPECIFY because spec is a stub
    expect((orchestrator as any).state.stage).toBe(DefineStage.SPECIFY);
  });
});
