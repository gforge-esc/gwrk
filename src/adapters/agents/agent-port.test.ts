/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { TaskClassification } from "../../domain/types.js";
import type { AgentBackendRegistry } from "../../plugins/agent-registry.js";
import { dispatchToAgent } from "../../utils/agent.js";
import { GwrkConfigSchema, loadConfig } from "../../utils/config.js";
import { createAgentPortAdapter } from "./index.js";
import { tryLoadRegistry } from "./registry-loader.js";

vi.mock("../../utils/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/config.js")>()),
  loadConfig: vi.fn(() => ({ agents: { fallbackOrder: ["fixture"] } })),
}));
vi.mock("../../db/plugins.js", () => ({ getRoutingHistory: () => [] }));
vi.mock("../../utils/project-id.js", () => ({
  resolveProjectId: () => "project",
}));
vi.mock("../../utils/agent.js", () => ({ dispatchToAgent: vi.fn() }));
vi.mock("../../server/quota-prober.js", () => ({
  QuotaProber: class {
    async probeQuota() {
      return { percent: 100, status: "fresh" };
    }
    isModelInCooldown() {
      return false;
    }
  },
}));
vi.mock("./registry-loader.js", () => ({
  tryLoadRegistry: vi.fn(() => ({
    ok: true,
    value: {
      fallbackOrder: ["fixture"],
      backends: {
        fixture: {
          name: "fixture",
          models: [
            {
              name: "definition",
              modelFlag: "provider-frontier",
              tier: TaskClassification.THINKING,
              effort: "high",
            },
          ],
        },
      },
    },
  })),
}));

describe("agent port adapter", () => {
  it("resolves the exact configured provider route and checks availability once", async () => {
    const isAvailable = vi.fn().mockResolvedValue(true);
    const registry = {
      getAgentBackend: vi
        .fn()
        .mockResolvedValue({ name: "fixture", isAvailable }),
      getBackends: vi.fn(),
    };
    const adapter = createAgentPortAdapter({
      registry: registry as unknown as AgentBackendRegistry,
    });

    expect(await adapter.selectRoute({ type: "define" })).toMatchObject({
      backend: "fixture",
      model: "provider-frontier",
      mode: "selected",
      effort: "high",
    });
    expect(isAvailable).toHaveBeenCalledTimes(1);
    expect(registry.getBackends).not.toHaveBeenCalled();
  });

  it("honors the configured implementation backend outside the model registry", async () => {
    const codex = {
      name: "codex",
      type: "local-cli" as const,
      command: "codex",
      quotaProbe: { method: "optimistic" as const, cacheTTLMinutes: 5 },
      maxConcurrent: 1,
      models: [
        {
          name: "fast",
          modelFlag: "codex-fast",
          tier: TaskClassification.FAST,
        },
      ],
    };
    vi.mocked(loadConfig).mockReturnValueOnce(
      GwrkConfigSchema.parse({
        project: { name: "Routing fixture" },
        agents: {
          implement: "agy",
          fallbackOrder: ["codex"],
          registry: { codex },
        },
      }),
    );
    vi.mocked(tryLoadRegistry).mockReturnValueOnce({
      ok: true,
      value: { fallbackOrder: ["codex"], backends: { codex } },
    });
    const registry = {
      getAgentBackend: vi.fn(async (name: string) => ({
        name,
        isAvailable: async () => true,
      })),
      getBackends: vi.fn(),
    };
    const adapter = createAgentPortAdapter({
      registry: registry as unknown as AgentBackendRegistry,
    });

    expect(await adapter.selectRoute({ type: "implement" })).toMatchObject({
      backend: "agy",
      model: "default",
      mode: "provider-default",
    });
    expect(registry.getAgentBackend).toHaveBeenCalledExactlyOnceWith("agy");
    expect(registry.getBackends).not.toHaveBeenCalled();
  });

  it("forwards the request and preserves the provider failure result", async () => {
    const request = {
      agent: "fixture",
      model: "provider-frontier",
      stdin: "complete payload",
    };
    const failed = {
      status: "failure" as const,
      exitCode: 1,
      stdout: "",
      stderr: "provider error",
      durationS: 1,
    };
    vi.mocked(dispatchToAgent).mockResolvedValueOnce(failed);

    expect(await createAgentPortAdapter().execute(request)).toEqual(failed);
    expect(dispatchToAgent).toHaveBeenCalledWith(request);
  });
});
