/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { run } from "../utils/exec.js";

vi.mock("../engine/ship-orchestrator.js", () => ({
  ShipOrchestrator: vi.fn(() => ({
    on: vi.fn(),
    run: vi.fn().mockResolvedValue(0),
    getResult: vi.fn().mockReturnValue({}),
  })),
}));
vi.mock("../server/ship-bridge.js", () => ({ ShipBridge: vi.fn() }));
vi.mock("../engine/plan-store.js", () => ({ PlanStore: vi.fn() }));
vi.mock("../db/runs.js", () => ({
  startRun: vi.fn().mockReturnValue(1),
  finishRun: vi.fn(),
  recordHistory: vi.fn(),
}));
vi.mock("../utils/setup-state.js", () => ({
  loadSetupState: vi.fn(),
  isSetupComplete: () => true,
}));
vi.mock("../utils/exec.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/exec.js")>()),
  run: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../utils/manifest.js", () => ({
  writeManifest: vi.fn(),
  generateRunId: () => "fixture-run",
  assembleDigest: () => [],
}));
vi.mock("../utils/git.js", () => ({
  getCurrentCommit: () => "fixture-commit",
  getCurrentBranch: () => "fixture-branch",
  getDiffStats: () => ({ filesChanged: 0, linesAdded: 0, linesDeleted: 0 }),
  isWorkingTreeClean: () => true,
}));

const feature = "043-routing-fixture";

function backendConfig(name: string) {
  return {
    type: "local-cli",
    command: name,
    quotaProbe: { method: "optimistic", cacheTTLMinutes: 60 },
    maxConcurrent: 1,
    models: [
      {
        name: "primary",
        modelFlag: `${name}-primary`,
        tier: "fast",
        effort: "medium",
      },
      {
        name: "alternate",
        modelFlag: `${name}-alternate`,
        tier: "fast",
        effort: "low",
      },
      {
        name: "review",
        modelFlag: `${name}-review`,
        tier: "thinking",
        effort: "high",
      },
    ],
    reviewModel: `${name}-review`,
  };
}

function provider(name: string): AgentBackend {
  return {
    name,
    checkQuota: vi.fn().mockResolvedValue({ status: "available" }),
    dispatch: vi.fn(),
    isAvailable: vi.fn().mockResolvedValue(true),
    parseResult: vi.fn(),
    syncGovernance: vi.fn(),
  };
}

describe("ship with the real AgentPort router", () => {
  let root: string;
  let dbPath: string;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "ship-routing-"));
    dbPath = path.join(root, "routing.db");
    vi.stubEnv("GWRK_DB_PATH", dbPath);
    vi.stubEnv("GWRK_HOME", path.join(root, ".gwrk"));
    vi.stubEnv("HOME", root);
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = 0;

    const featureDir = path.join(root, "specs", feature);
    fs.mkdirSync(path.join(featureDir, ".gwrk"), { recursive: true });
    fs.mkdirSync(path.join(root, ".runs"));
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    fs.writeFileSync(path.join(root, "fixture.test.ts"), "");
    fs.writeFileSync(path.join(featureDir, "spec.md"), "# Routing fixture");
    fs.writeFileSync(
      path.join(featureDir, ".gwrk", "tasks.json"),
      JSON.stringify({
        featureId: feature,
        createdAt: new Date().toISOString(),
        phases: [
          {
            id: "phase-01",
            title: "Routing",
            testTargets: ["fixture.test.ts"],
            tasks: [
              {
                id: "T001",
                title: "Route",
                status: "open",
                description: "",
                gateScript: "",
              },
            ],
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "Routing fixture" },
        agents: {
          implement: "codex",
          fallbackOrder: ["codex", "claude"],
          registry: {
            codex: backendConfig("codex"),
            claude: backendConfig("claude"),
          },
        },
      }),
    );

    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    const providers = new Map(
      ["agy", "codex", "claude"].map((name) => [name, provider(name)]),
    );
    vi.spyOn(
      AgentBackendRegistry.prototype,
      "getAgentBackend",
    ).mockImplementation(async (name) => {
      const backend = providers.get(name);
      if (!backend) throw new Error(`Unavailable fixture backend: ${name}`);
      return backend;
    });
  });

  afterEach(async () => {
    const { closeDb } = await import("../db/index.js");
    closeDb();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
    process.exitCode = 0;
  });

  function seedQuota(codexPercent: number, claudePercent = 90) {
    const reading = (percent: number) => ({
      percent,
      resetsIn: "unknown",
      probedAt: new Date().toISOString(),
      status: "fresh",
    });
    fs.writeFileSync(
      path.join(root, ".runs", "quota-cache.json"),
      JSON.stringify({
        codex: reading(codexPercent),
        claude: reading(claudePercent),
      }),
    );
  }

  async function ship(...args: string[]) {
    const { createShipCommand } = await import("./ship.js");
    await createShipCommand().parseAsync([feature, "phase-01", ...args], {
      from: "user",
    });
    expect(process.exitCode).toBe(0);
  }

  async function decisions() {
    const { getDb } = await import("../db/index.js");
    return getDb().prepare("SELECT * FROM routing_decisions").all();
  }

  it("falls back from depleted Codex quota and records the Claude route once", async () => {
    seedQuota(0);

    await ship();

    expect(
      vi.mocked(ShipOrchestrator).mock.calls.map(([options]) => options),
    ).toMatchObject([
      {
        backend: "claude",
        selectedModel: "claude-primary",
        selectedEffort: "medium",
        reviewModel: "claude-review",
        reviewEffort: "high",
      },
    ]);
    expect(await decisions()).toMatchObject([
      {
        run_id: expect.stringMatching(/^ship-043-routing-fixture-/),
        feature,
        phase: "phase-01",
        selected_backend: "claude",
        selected_model: "claude-primary",
        task_classification: "fast",
        quota_percent: 90,
        probe_status: "cached",
        task_sp: 1,
        fallback_used: 1,
        model_failover_used: 0,
      },
    ]);
  });

  it("stops when every configured backend is depleted even if another CLI is installed", async () => {
    seedQuota(0, 0);
    const { createShipCommand } = await import("./ship.js");

    await createShipCommand().parseAsync([feature, "phase-01"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);
  });

  it("uses the alternate model during cooldown and records model failover", async () => {
    seedQuota(90);
    const { QuotaProber } = await import("../server/quota-prober.js");
    const probeQuota = QuotaProber.prototype.probeQuota;
    vi.spyOn(QuotaProber.prototype, "probeQuota").mockImplementation(function (
      this: QuotaProber,
      ...args
    ) {
      this.markModelFailure("codex", "codex-primary");
      return probeQuota.apply(this, args);
    });

    await ship();

    expect(
      vi.mocked(ShipOrchestrator).mock.calls.map(([options]) => options),
    ).toMatchObject([
      {
        backend: "codex",
        selectedModel: "codex-alternate",
        selectedEffort: "low",
        reviewModel: "codex-review",
      },
    ]);
    expect(await decisions()).toMatchObject([
      {
        selected_backend: "codex",
        selected_model: "codex-alternate",
        fallback_used: 0,
        model_failover_used: 1,
      },
    ]);
  });

  it("previews the explicit configured model without creating a routing database", async () => {
    expect(fs.existsSync(dbPath)).toBe(false);

    await ship("--dry-run", "--agent", "claude");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "backend: claude, model: claude-primary, effort: medium",
      ),
    );
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(fs.existsSync(path.join(root, ".runs", "quota-cache.json"))).toBe(
      false,
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
