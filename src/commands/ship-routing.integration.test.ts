/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShipOrchestrator } from "../engine/ship-orchestrator.js";
import type { AgentBackend } from "../plugins/agent-backend.js";
import { AgyAdapter } from "../plugins/builtins/agents/agy/adapter.js";
import { CodexAdapter } from "../plugins/builtins/agents/codex/adapter.js";
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

function backendConfig(name: string, primaryModel = `${name}-primary`) {
  return {
    type: "local-cli",
    command: name,
    quotaProbe: { method: "optimistic", cacheTTLMinutes: 60 },
    maxConcurrent: 1,
    models: [
      {
        name: "primary",
        modelFlag: primaryModel,
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
  let codex: AgentBackend;

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
    configureAgents();

    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    codex = provider("codex");
    const providers = new Map([
      ["agy", provider("agy")],
      ["codex", codex],
      ["claude", provider("claude")],
      ["goose", provider("goose")],
    ]);
    vi.spyOn(
      AgentBackendRegistry.prototype,
      "getAgentBackend",
    ).mockImplementation(async (name) => {
      const backend = providers.get(name);
      if (!backend) throw new Error(`Unavailable fixture backend: ${name}`);
      return backend;
    });
  });

  function configureAgents(
    implement = "codex",
    names = ["codex", "claude"],
    primaryModel?: string,
  ) {
    fs.writeFileSync(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify({
        project: { name: "Routing fixture" },
        agents: {
          implement,
          fallbackOrder: names,
          registry: Object.fromEntries(
            names.map((name) => [name, backendConfig(name, primaryModel)]),
          ),
        },
      }),
    );

  }

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

  it("ranks Claude first when Codex is depleted and records one route", async () => {
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
        fallback_used: 0,
        model_failover_used: 0,
      },
    ]);
  });

  it.each([
    { codexPercent: 10, implement: "codex", backend: "claude", quota: 90 },
    { codexPercent: 80, implement: "claude", backend: "codex", quota: 80 },
  ])(
    "selects $backend with Codex at $codexPercent percent and stronger Codex history",
    async ({ codexPercent, implement, backend, quota }) => {
      configureAgents(implement);
      seedQuota(codexPercent);
      const { getDb } = await import("../db/index.js");
      const insert = getDb().prepare(
        "INSERT INTO runs (feature_id, command, agent_backend, exit_code) VALUES (?, 'ship', ?, ?)",
      );
      insert.run(feature, "codex", 0);
      insert.run(feature, "claude", 1);

      await ship();

      expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          backend,
          selectedModel: `${backend}-primary`,
        }),
        undefined,
      );
      expect(await decisions()).toMatchObject([
        { selected_backend: backend, quota_percent: quota, fallback_used: 0 },
      ]);
    },
  );

  it("previews the backend with higher quota despite the configured role default", async () => {
    seedQuota(10);

    await ship("--dry-run");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("backend: claude, model: claude-primary"),
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);
  });

  it("labels automatic preview provisional when execution can select another backend", async () => {
    seedQuota(100, 50);
    vi.mocked(codex.checkQuota).mockResolvedValue({ status: "rate-limited" });

    await ship("--dry-run");

    const preview = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(preview).toContain(
      "Provisional route with backend: codex, model: codex-primary",
    );
    expect(preview).toContain(
      "Live quota checks can change the backend and model.",
    );
    expect(codex.checkQuota).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);

    await ship();

    expect(codex.checkQuota).toHaveBeenCalledOnce();
    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: "claude",
        selectedModel: "claude-primary",
      }),
      undefined,
    );
  });

  it("keeps an installed backend with positive configured quota and unknown native quota", async () => {
    configureAgents("codex", ["codex"]);
    seedQuota(100);
    vi.mocked(codex.checkQuota).mockResolvedValue({ status: "unknown" });

    await ship();

    expect(codex.isAvailable).toHaveBeenCalledOnce();
    expect(codex.checkQuota).toHaveBeenCalledOnce();
    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ backend: "codex", selectedModel: "codex-primary" }),
      undefined,
    );
    expect(await decisions()).toMatchObject([{
      selected_backend: "codex",
      selected_model: "codex-primary",
      quota_percent: 100,
    }]);
  });

  it("falls back when native backend availability stalls", async () => {
    seedQuota(100, 50);
    const claude = provider("claude");
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockImplementation(
      async (name) => (name === "codex" ? codex : claude),
    );
    let release!: (available: boolean) => void;
    const stalled = new Promise<boolean>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      vi.mocked(codex.isAvailable).mockImplementation(() => {
        resolve();
        return stalled;
      });
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const shipping = ship();
    try {
      await Promise.race([started, shipping]);
      await vi.advanceTimersByTimeAsync(4_999);
      expect(ShipOrchestrator).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          backend: "claude",
          selectedModel: "claude-primary",
        }),
        undefined,
      );
      expect(codex.checkQuota).not.toHaveBeenCalled();
      expect(claude.checkQuota).toHaveBeenCalledOnce();
      await shipping;
      expect(await decisions()).toMatchObject([
        {
          selected_backend: "claude",
          selected_model: "claude-primary",
          fallback_used: 1,
        },
      ]);
    } finally {
      vi.useRealTimers();
      release(false);
      await shipping;
    }
  });

  it("terminates the native availability subprocess when ship falls back", async () => {
    seedQuota(100, 50);
    const claude = provider("claude");
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    const nativeCodex = new CodexAdapter();
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockImplementation(
      async (name) => (name === "codex" ? nativeCodex : claude),
    );

    const binDir = path.join(root, "bin");
    const pidFile = path.join(root, "which.pid");
    fs.mkdirSync(binDir);
    fs.writeFileSync(
      path.join(binDir, "which"),
      '#!/bin/sh\ntrap "" TERM\nprintf "%s\\n" "$$" > "$FIXTURE_PID_FILE"\nexec /bin/sleep 30\n',
      { mode: 0o755 },
    );
    vi.stubEnv("FIXTURE_PID_FILE", pidFile);
    vi.stubEnv("PATH", `${binDir}${path.delimiter}${process.env.PATH}`);

    try {
      await ship();

      const childPid = Number(fs.readFileSync(pidFile, "utf8"));
      expect(childPid).toBeGreaterThan(0);
      expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          backend: "claude",
          selectedModel: "claude-primary",
        }),
        undefined,
      );
      await vi.waitFor(() => {
        expect(() => process.kill(childPid, 0)).toThrow(
          expect.objectContaining({ code: "ESRCH" }),
        );
      });
    } finally {
      const childPid = fs.existsSync(pidFile)
        ? Number(fs.readFileSync(pidFile, "utf8"))
        : 0;
      if (childPid > 0) {
        try {
          process.kill(childPid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
    }
  }, 10_000);

  it.each([false, true])(
    "reports a timed-out explicit backend as unavailable with dry-run=%s",
    async (dryRun) => {
      const { createShipCommand } = await import("./ship.js");
      const { AgentBackendRegistry } = await import(
        "../plugins/agent-registry.js"
      );
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      let release!: (available: boolean) => void;
      const stalled = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      const started = new Promise<void>((resolve) => {
        vi.mocked(codex.isAvailable).mockImplementation(() => {
          resolve();
          return stalled;
        });
      });

      const args = [feature, "phase-01", "--agent", "codex"];
      if (dryRun) args.push("--dry-run");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      const shipping = createShipCommand().parseAsync(args, { from: "user" });
      const finished = vi.fn();
      const completion = shipping.then(finished);
      try {
        await Promise.race([started, completion]);
        await vi.advanceTimersByTimeAsync(4_999);
        expect(finished).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        expect(finished).toHaveBeenCalledOnce();
        expect(process.exitCode).toBe(dryRun ? 0 : 1);
        if (dryRun) {
          const output = vi.mocked(console.log).mock.calls.flat().join("\n");
          expect(output).toContain("Could not select an implementation route");
          expect(output).toContain(`work-until-done.sh ${feature} 01`);
          expect(output).not.toContain("Would build with");
        } else {
          expect(stderr).toHaveBeenCalledWith(
            expect.stringContaining(
              "No available agent backends found for task type: implement",
            ),
          );
        }
        expect(
          AgentBackendRegistry.prototype.getAgentBackend,
        ).toHaveBeenCalledExactlyOnceWith("codex");
        expect(codex.checkQuota).not.toHaveBeenCalled();
        expect(ShipOrchestrator).not.toHaveBeenCalled();
        expect(fs.existsSync(dbPath)).toBe(false);
      } finally {
        vi.useRealTimers();
        release(false);
        await completion;
      }
    },
  );

  it("uses configured quota when the automatic native quota check stalls", async () => {
    seedQuota(100, 50);
    const claude = provider("claude");
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockImplementation(
      async (name) => (name === "codex" ? codex : claude),
    );
    let releaseQuota!: () => void;
    let quotaSignal: AbortSignal | undefined;
    const quotaStarted = new Promise<void>((resolve) => {
      vi.mocked(codex.checkQuota).mockImplementation((signal) => {
        quotaSignal = signal;
        resolve();
        return new Promise((resolveQuota, rejectQuota) => {
          releaseQuota = () => resolveQuota({ status: "unknown" });
          signal?.addEventListener("abort", () => rejectQuota(signal.reason), {
            once: true,
          });
        });
      });
    });

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const shipping = ship();
    try {
      await Promise.race([quotaStarted, shipping]);
      expect(codex.checkQuota).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(4_999);
      expect(ShipOrchestrator).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(quotaSignal?.aborted).toBe(true);
      expect(codex.isAvailable).toHaveBeenCalledOnce();
      expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          backend: "codex",
          selectedModel: "codex-primary",
        }),
        undefined,
      );
      expect(claude.checkQuota).not.toHaveBeenCalled();
      await shipping;
    } finally {
      vi.useRealTimers();
      releaseQuota?.();
      await shipping;
    }
  });

  it("previews an installed backend without calling its native quota hook", async () => {
    configureAgents("goose", ["goose"]);
    const goose = provider("goose");
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockResolvedValue(
      goose,
    );

    await ship("--dry-run");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("backend: goose, model: goose-primary"),
    );
    expect(goose.isAvailable).toHaveBeenCalledOnce();
    expect(goose.checkQuota).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);

    await ship();

    expect(goose.checkQuota).toHaveBeenCalledOnce();
    expect(await decisions()).toMatchObject([
      {
        selected_backend: "goose",
        selected_model: "goose-primary",
        quota_percent: 100,
      },
    ]);
  });

  it("falls back to Claude when the higher-quota Codex executable is missing", async () => {
    seedQuota(100, 50);
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    const codexAdapter = new CodexAdapter();
    vi.spyOn(codexAdapter, "isAvailable").mockResolvedValue(false);
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend)
      .mockResolvedValueOnce(codexAdapter);

    await ship();

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: "claude",
        selectedModel: "claude-primary",
      }),
      undefined,
    );
    expect(await decisions()).toMatchObject([
      {
        selected_backend: "claude",
        selected_model: "claude-primary",
        fallback_used: 1,
      },
    ]);
  });

  it("stops when every configured backend is depleted even if another CLI is installed", async () => {
    seedQuota(0, 0);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const { createShipCommand } = await import("./ship.js");

    await createShipCommand().parseAsync([feature, "phase-01"], { from: "user" });

    expect(process.exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("All backends quota-exhausted. Retry after reset."),
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);
  });

  it("previews phase commands when all configured quota is exhausted", async () => {
    seedQuota(0, 0);
    await ship("--dry-run");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("All backends quota-exhausted. Retry after reset."),
    );
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(`work-until-done.sh ${feature} 01`),
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);
  });

  it.each([false, true])(
    "stops at three automatic backend attempts with native refusal %s",
    async (nativeRefusal) => {
      configureAgents("codex", ["codex", "claude", "agy", "goose"]);
      const { QuotaProber } = await import("../server/quota-prober.js");
      const { AgentBackendRegistry } = await import("../plugins/agent-registry.js");
      const probe = QuotaProber.prototype.probeQuota;
      vi.spyOn(QuotaProber.prototype, "probeQuota").mockImplementation(function (
        this: QuotaProber,
        ...args
      ) {
        const { name } = args[0];
        if (name !== "goose" && (!nativeRefusal || name !== "codex")) {
          for (const suffix of ["primary", "alternate", "review"]) {
            this.markModelFailure(name, `${name}-${suffix}`);
          }
        }
        return probe.apply(this, args);
      });
      if (nativeRefusal) {
        vi.mocked(codex.checkQuota).mockResolvedValue({ status: "rate-limited" });
      }
      const { createShipCommand } = await import("./ship.js");

      await createShipCommand().parseAsync([feature, "phase-01"], { from: "user" });

      expect(process.exitCode).toBe(1);
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(AgentBackendRegistry.prototype.getAgentBackend).not.toHaveBeenCalledWith("goose");
      expect(await decisions()).toEqual([]);
    },
  );

  it.each([{ args: [] }, { args: ["--dry-run"] }])(
    "rejects automatic routing when agents.fallbackOrder is missing (%s)",
    async ({ args }) => {
      fs.writeFileSync(
        path.join(root, ".gwrkrc.json"),
        JSON.stringify({
          project: { name: "Routing fixture" },
          agents: {
            implement: "codex",
            registry: {
              codex: {
                ...backendConfig("codex"),
                models: [{ name: "fast", modelFlag: "codex-fast", tier: "fast" }],
              },
            },
          },
        }),
      );
      const { AgentBackendRegistry } = await import(
        "../plugins/agent-registry.js"
      );
      const getBackends = vi.spyOn(AgentBackendRegistry.prototype, "getBackends");
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const { createShipCommand } = await import("./ship.js");

      await createShipCommand().parseAsync([feature, "phase-01", ...args], { from: "user" });

      expect(process.exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(
          "Missing required config: agents.registry or agents.fallbackOrder",
        ),
      );
      expect(AgentBackendRegistry.prototype.getAgentBackend).not.toHaveBeenCalled();
      expect(getBackends).not.toHaveBeenCalled();
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(await decisions()).toEqual([]);
      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Would build with backend"));
    },
  );

  it("uses both models from an explicit backend without checking quota", async () => {
    seedQuota(0);
    vi.mocked(codex.checkQuota).mockResolvedValue({ status: "rate-limited" });
    const { QuotaProber } = await import("../server/quota-prober.js");
    const probeQuota = vi.spyOn(QuotaProber.prototype, "probeQuota");

    await ship("--agent", "codex");

    expect(codex.isAvailable).toHaveBeenCalled();
    expect(codex.checkQuota).not.toHaveBeenCalled();
    expect(probeQuota).not.toHaveBeenCalled();
    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: "codex",
        selectedModel: "codex-primary",
        reviewModel: "codex-review",
      }),
      undefined,
    );
  });

  it("ships with both explicit models when the routing ledger is unavailable", async () => {
    fs.mkdirSync(dbPath);

    await ship("--agent", "codex");

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: "codex",
        selectedModel: "codex-primary",
        reviewModel: "codex-review",
      }),
      undefined,
    );
  });

  it("previews the same environment model that an explicit unregistered backend dispatches", async () => {
    configureAgents("claude", ["claude"]);
    vi.stubEnv("CODEX_MODEL", "environment-model");
    const adapter = new CodexAdapter();
    vi.spyOn(adapter, "isAvailable").mockResolvedValue(true);
    const resolveModel = vi.spyOn(adapter, "resolveModel");
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend)
      .mockImplementation(async () => adapter);

    await ship("--dry-run", "--agent", "codex");

    const previewOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(resolveModel).toHaveBeenCalledTimes(1);

    await ship("--agent", "codex");

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ backend: "codex" }),
      undefined,
    );
    const [options] = vi.mocked(ShipOrchestrator).mock.calls[0];
    expect(await decisions()).toMatchObject([
      {
        selected_backend: options.backend,
        selected_model: options.selectedModel,
        reason: "adapter model default",
      },
    ]);
    expect(resolveModel).toHaveBeenCalledTimes(2);
    for (const [task, ambientEnv] of resolveModel.mock.calls) {
      expect(task.model).toBeUndefined();
      expect(task.env?.CODEX_MODEL).toBeUndefined();
      expect(ambientEnv?.CODEX_MODEL).toBe("environment-model");
    }
    const implementation = await adapter.dispatch({
      agent: options.backend,
      model: options.selectedModel,
    });
    const review = await adapter.dispatch({
      agent: options.backend,
      model: options.reviewModel,
      type: "review",
      env: {},
    });
    expect(options.selectedModel).toBe("environment-model");
    expect(options.reviewModel).toBe("environment-model");
    for (const { args } of [implementation, review]) {
      const modelFlag = args.indexOf("--model");
      expect(modelFlag).toBeGreaterThanOrEqual(0);
      expect(args[modelFlag + 1]).toBe("environment-model");
      expect(previewOutput).toContain(
        `backend: codex, model: ${args[modelFlag + 1]}, effort:`,
      );
    }
  });

  it.each([
    {
      reviewCooldown: false,
      reviewModel: "codex-review",
      reviewEffort: "high",
    },
    {
      reviewCooldown: true,
      reviewModel: "codex-primary",
      reviewEffort: "medium",
    },
  ])(
    "resolves both role models after one native quota check with review cooldown $reviewCooldown",
    async ({ reviewCooldown, reviewModel, reviewEffort }) => {
      seedQuota(100);
      vi.mocked(codex.checkQuota)
        .mockResolvedValueOnce({ status: "available" })
        .mockResolvedValue({ status: "rate-limited" });
      const { AgentBackendRegistry } = await import(
        "../plugins/agent-registry.js"
      );
      if (reviewCooldown) {
        const { QuotaProber } = await import("../server/quota-prober.js");
        const probeQuota = QuotaProber.prototype.probeQuota;
        vi.spyOn(QuotaProber.prototype, "probeQuota").mockImplementation(
          function (this: QuotaProber, ...args) {
            this.markModelFailure("codex", "codex-review");
            return probeQuota.apply(this, args);
          },
        );
      }

      await ship();

      expect(
        AgentBackendRegistry.prototype.getAgentBackend,
      ).toHaveBeenCalledExactlyOnceWith("codex");
      expect(codex.checkQuota).toHaveBeenCalledTimes(1);
      expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          backend: "codex",
          selectedModel: "codex-primary",
          selectedEffort: "medium",
          reviewModel,
          reviewEffort,
        }),
        undefined,
      );
    },
  );

  it.each([
    {
      backend: "agy",
      expectedModel: "configured-legacy-model",
      reason: "legacy model default",
    },
    { backend: "codex", expectedModel: "codex-primary" },
    { backend: "codex", expectedModel: "default" },
  ])(
    "previews and records $expectedModel passed to the legacy script for $backend",
    async ({ backend, expectedModel, reason }) => {
      vi.stubEnv("GEMINI_MODEL", "configured-legacy-model");
      if (expectedModel === "default") {
        fs.writeFileSync(
          path.join(root, ".gwrkrc.json"),
          JSON.stringify({
            project: { name: "Routing fixture" },
            agents: {
              implement: backend,
              fallbackOrder: [backend],
              registry: { [backend]: { ...backendConfig(backend), models: [] } },
            },
          }),
        );
      }
      await ship("--dry-run", "--legacy", "--agent", backend);

      const previewOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(run).not.toHaveBeenCalled();
      expect(fs.existsSync(dbPath)).toBe(false);

      await ship("--legacy", "--agent", backend);
      const call = vi.mocked(run).mock.calls.find(([command]) =>
        command.endsWith("/work-until-done.sh"),
      );
      expect(call?.[1]).toEqual([feature, "01"]);
      const scriptModel = call?.[2]?.env?.GEMINI_MODEL;
      expect(scriptModel).toBe(expectedModel);
      expect(previewOutput).toContain(
        `backend: ${backend}, model: ${scriptModel}, effort:`,
      );
      expect(await decisions()).toMatchObject([
        {
          selected_backend: backend,
          selected_model: scriptModel,
          ...(reason && { reason }),
        },
      ]);
    },
  );

  it("routes automatic legacy ship to a script-owned backend with quota", async () => {
    configureAgents("claude", ["claude", "legacy-wrapper"]);
    seedQuota(0, 0);
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    const lookup = vi.mocked(AgentBackendRegistry.prototype.getAgentBackend);
    lookup.mockRejectedValue(new Error("Unexpected native adapter lookup"));

    await ship("--dry-run", "--legacy");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "backend: legacy-wrapper, model: legacy-wrapper-primary",
      ),
    );
    expect(run).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(await decisions()).toEqual([]);

    await ship("--legacy");

    const scriptCalls = vi.mocked(run).mock.calls.filter(([command]) =>
      command.endsWith("/work-until-done.sh"),
    );
    expect(scriptCalls).toHaveLength(1);
    const [, args, options] = scriptCalls[0];
    expect(args).toEqual([feature, "01"]);
    expect(options?.env).toMatchObject({
      AGENT_BACKEND: "legacy-wrapper",
      GEMINI_MODEL: "legacy-wrapper-primary",
    });
    expect(await decisions()).toMatchObject([
      {
        selected_backend: "legacy-wrapper",
        selected_model: "legacy-wrapper-primary",
        quota_percent: 100,
      },
    ]);
    expect(lookup).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
  });

  it("previews and ships an explicit backend owned by the legacy script", async () => {
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    const lookup = vi.mocked(AgentBackendRegistry.prototype.getAgentBackend);
    lookup.mockRejectedValue(new Error("No native adapter for legacy-wrapper"));
    vi.stubEnv("GEMINI_MODEL", "legacy-wrapper-model");

    await ship("--dry-run", "--legacy", "--agent", "legacy-wrapper");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining(
        "backend: legacy-wrapper, model: legacy-wrapper-model",
      ),
    );
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(dbPath)).toBe(false);

    await ship("--legacy", "--agent", "legacy-wrapper");

    const scriptCalls = vi.mocked(run).mock.calls.filter(([command]) =>
      command.endsWith("/work-until-done.sh"),
    );
    expect(scriptCalls).toHaveLength(1);
    const [, args, options] = scriptCalls[0];
    expect(args).toEqual([feature, "01"]);
    expect(options?.env?.AGENT_BACKEND).toBe("legacy-wrapper");
    expect(options?.env?.GEMINI_MODEL).toBe("legacy-wrapper-model");
    expect(lookup).not.toHaveBeenCalled();
    expect(ShipOrchestrator).not.toHaveBeenCalled();
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

  it("previews and records provider default when Antigravity omits the registered model flag", async () => {
    const registeredModel = "gemini-2.0-flash";
    configureAgents("agy", ["agy"], registeredModel);
    vi.stubEnv("AGY_MODEL", undefined);
    const adapter = new AgyAdapter();
    vi.spyOn(adapter, "isAvailable").mockResolvedValue(true);
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockResolvedValue(
      adapter,
    );

    await ship("--dry-run", "--agent", "agy");

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("backend: agy, model: default, effort: medium"),
    );
    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
    expect(fs.existsSync(dbPath)).toBe(false);

    await ship("--agent", "agy");

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ backend: "agy", selectedModel: registeredModel }),
      undefined,
    );
    const [options] = vi.mocked(ShipOrchestrator).mock.calls[0];
    const { args } = await adapter.dispatch({
      agent: options.backend,
      model: options.selectedModel,
      env: { GWRK_EFFORT: options.selectedEffort ?? "" },
    });
    expect(args).not.toContain("--model");
    expect(await decisions()).toMatchObject([
      { selected_backend: "agy", selected_model: "default" },
    ]);
  });

  it("previews and ships the same explicit alternate model during cooldown", async () => {
    const { QuotaProber } = await import("../server/quota-prober.js");
    vi.spyOn(QuotaProber.prototype, "isModelInCooldown").mockImplementation(
      (backend, model) => backend === "codex" && model === "codex-primary",
    );
    const probeQuota = vi.spyOn(QuotaProber.prototype, "probeQuota");

    await ship("--dry-run", "--agent", "codex");

    expect(ShipOrchestrator).not.toHaveBeenCalled();
    expect(fs.existsSync(dbPath)).toBe(false);
    expect(codex.isAvailable).toHaveBeenCalledOnce();
    const previewOutput = vi.mocked(console.log).mock.calls.flat().join("\n");

    await ship("--agent", "codex");

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        backend: "codex",
        selectedModel: "codex-alternate",
        selectedEffort: "low",
      }),
      undefined,
    );
    expect(probeQuota).not.toHaveBeenCalled();
    expect(codex.checkQuota).not.toHaveBeenCalled();
    expect(previewOutput).toContain(
      "backend: codex, model: codex-alternate, effort: low",
    );
  });

  it("dispatches the selected project-local backend from a separate work directory", async () => {
    const backend = "fixture-project-agent";
    configureAgents(backend, [backend], "fixture-fast");
    const homeDir = path.join(root, "home");
    fs.mkdirSync(homeDir);
    vi.stubEnv("HOME", homeDir);
    vi.stubEnv("GWRK_HOME", path.join(homeDir, ".gwrk"));
    const { AgentBackendRegistry } = await import(
      "../plugins/agent-registry.js"
    );
    vi.mocked(AgentBackendRegistry.prototype.getAgentBackend).mockRestore();

    const pluginDir = path.join(root, ".gwrk", "plugins", "agents", backend);
    fs.mkdirSync(pluginDir, { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, "manifest.yaml"),
      `type: agent
name: ${backend}
version: 1.0.0
description: Project-local dispatch fixture
adapter: ./adapter.js
dispatchMode: local-cli
contextFileName: AGENTS.md
capabilities: []
models: {}
exitCodeMap: {}
`,
    );
    fs.writeFileSync(
      path.join(pluginDir, "adapter.js"),
      `module.exports = {
        name: ${JSON.stringify(backend)},
        async isAvailable() { return true; },
        async dispatch(task) {
          return { command: this.name, args: [], stdin: "fixture dispatch: " + task.model };
        },
        parseResult() { throw new Error("Dry run must not execute the adapter command"); }
      };`,
    );
    const workDir = path.join(root, "worktree");
    fs.mkdirSync(workDir);

    await ship("--agent", backend);

    expect(ShipOrchestrator).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ backend, selectedModel: "fixture-fast" }),
      undefined,
    );
    const [options] = vi.mocked(ShipOrchestrator).mock.calls[0];
    const { dispatchToAgent } = await import("../utils/agent.js");
    const result = await dispatchToAgent({
      agent: options.backend,
      model: options.selectedModel,
      workDir,
      dryRun: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("fixture dispatch: fixture-fast");
  });

  it.each(["missing", "unavailable"])(
    "reports an explicit %s native backend in preview and rejects it in execution",
    async (status) => {
      const backend = "fixture-backend-missing";
      configureAgents(backend, [backend], "fixture-fast");
      const { AgentBackendRegistry } = await import(
        "../plugins/agent-registry.js"
      );
      const lookup = vi.mocked(AgentBackendRegistry.prototype.getAgentBackend);
      const adapter = provider(backend);
      vi.mocked(adapter.isAvailable).mockResolvedValue(false);
      if (status === "missing") {
        lookup.mockRejectedValue(new Error(`No native adapter for ${backend}`));
      } else {
        lookup.mockResolvedValue(adapter);
      }
      const { QuotaProber } = await import("../server/quota-prober.js");
      const probeQuota = vi.spyOn(QuotaProber.prototype, "probeQuota");

      await ship("--dry-run", "--agent", backend);

      const previewOutput = vi.mocked(console.log).mock.calls.flat().join("\n");
      expect(previewOutput).toContain("Could not select an implementation route");
      expect(previewOutput).toContain(`work-until-done.sh ${feature} 01`);
      expect(previewOutput).not.toContain("Would build with");
      expect(lookup).toHaveBeenCalledExactlyOnceWith(backend);
      if (status === "unavailable") {
        expect(adapter.isAvailable).toHaveBeenCalledOnce();
      }
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(fs.existsSync(dbPath)).toBe(false);

      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const { createShipCommand } = await import("./ship.js");
      await createShipCommand().parseAsync(
        [feature, "phase-01", "--agent", backend],
        { from: "user" },
      );

      expect(process.exitCode).toBe(1);
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining(
          "No available agent backends found for task type: implement",
        ),
      );
      expect(probeQuota).not.toHaveBeenCalled();
      expect(adapter.checkQuota).not.toHaveBeenCalled();
      expect(ShipOrchestrator).not.toHaveBeenCalled();
      expect(await decisions()).toEqual([]);
    },
  );

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
