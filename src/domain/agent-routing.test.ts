/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it } from "vitest";
import type { AgentBackendConfig } from "./agent-config.js";
import { selectAgentRoute } from "./agent-routing.js";
import { TaskClassification } from "./types.js";

function backend(name: string): AgentBackendConfig {
  return {
    name,
    type: "local-cli",
    command: name,
    quotaProbe: { method: "optimistic", cacheTTLMinutes: 0 },
    maxConcurrent: 1,
    models: [
      {
        name: "definition",
        modelFlag: "fixture-frontier",
        tier: TaskClassification.THINKING,
        effort: "high",
      },
      {
        name: "coding",
        modelFlag: "fixture-fast",
        tier: TaskClassification.FAST,
      },
    ],
  };
}

const registry = {
  backends: { first: backend("first"), second: backend("second") },
  fallbackOrder: ["first", "second"],
};

describe("agent route policy", () => {
  it("uses an explicit backend and the role's exact model and effort", () => {
    expect(
      selectAgentRoute(
        { type: "define" },
        { explicitBackend: "second", registry },
      ),
    ).toMatchObject({
      backend: "second",
      model: "fixture-frontier",
      effort: "high",
      mode: "selected",
    });
  });

  it("does not silently replace an explicit model in cooldown", () => {
    expect(() =>
      selectAgentRoute(
        { type: "define" },
        {
          explicitBackend: "first",
          explicitModel: "fixture-frontier",
          registry,
          cooledDownModels: { first: ["definition"] },
        },
      ),
    ).toThrow(/fixture-frontier/);
  });

  it("fails over from an exhausted backend and preserves the selected role", () => {
    expect(
      selectAgentRoute(
        { type: "implement" },
        {
          registry,
          pillarConfig: { implement: "first" },
          quotas: {
            first: { percent: 0, probeStatus: "fresh" },
            second: { percent: 70, probeStatus: "cached" },
          },
        },
      ),
    ).toMatchObject({
      backend: "second",
      model: "fixture-fast",
      fallbackUsed: true,
      quotaPercent: 70,
    });
  });

  it("distinguishes a provider default from a selected model", () => {
    expect(
      selectAgentRoute({ type: "review" }, { defaultBackend: "fixture" }),
    ).toMatchObject({
      backend: "fixture",
      model: "default",
      mode: "provider-default",
    });
  });

  it("requires evidence that an explicitly selected backend is available", () => {
    expect(() =>
      selectAgentRoute(
        { type: "define" },
        {
          explicitBackend: "missing",
          registry,
        },
      ),
    ).toThrow(/missing/);
  });
});
