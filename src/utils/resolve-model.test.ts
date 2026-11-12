/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, vi } from "vitest";
import { resolveModelForTask } from "./resolve-model.js";

import { tryLoadRegistry } from "../adapters/agents/registry-loader.js";

vi.mock("../adapters/agents/registry-loader.js", () => ({
  tryLoadRegistry: vi.fn(() => ({
    ok: true,
    value: {
      backends: {
        gemini: {
          name: "gemini",
          type: "local-cli" as const,
          command: "gemini",
          quotaProbe: { method: "optimistic" as const, cacheTTLMinutes: 5 },
          maxConcurrent: 2,
          models: [
            { name: "gemini-3-flash-preview", tier: "fast" },
            { name: "gemini-3.1-pro-preview", tier: "thinking" },
            { name: "gemini-2.5-pro", tier: "high-context" },
          ],
        },
      },
      fallbackOrder: ["gemini"],
    },
  })),
}));

describe("resolveModelForTask", () => {
  it("selects a thinking-tier model for define tasks", () => {
    const model = resolveModelForTask("define", "gemini", "/fake/project");
    expect(model).toBe("gemini-3.1-pro-preview");
  });

  it("selects a fast-tier model for implement tasks", () => {
    const model = resolveModelForTask("implement", "gemini", "/fake/project");
    expect(model).toBe("gemini-3-flash-preview");
  });

  it("selects a thinking-tier model for review tasks", () => {
    const model = resolveModelForTask("review", "gemini", "/fake/project");
    expect(model).toBe("gemini-3.1-pro-preview");
  });

  it("selects a fast-tier model for remediation tasks", () => {
    const model = resolveModelForTask("remediation", "gemini", "/fake/project");
    expect(model).toBe("gemini-3-flash-preview");
  });

  it("returns the exact provider model ID instead of the registry label", () => {
    vi.mocked(tryLoadRegistry).mockReturnValueOnce({
      ok: true,
      value: {
        backends: {
          agy: {
            name: "agy",
            type: "local-cli",
            command: "agy",
            quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
            maxConcurrent: 2,
            models: [{
              name: "preferred-definition",
              modelFlag: "fixture-model-high",
              tier: "thinking",
            }],
          },
        },
        fallbackOrder: ["agy"],
      },
    });
    expect(resolveModelForTask("define", "agy", "/fake/project")).toBe("fixture-model-high");
  });

  it("falls back when registry validation fails", () => {
    vi.mocked(tryLoadRegistry).mockReturnValueOnce({
      ok: false,
      error: { code: "INVALID_CONFIG_JSON", message: "invalid config" },
    });
    expect(resolveModelForTask("define", "gemini", "/fake/project")).toBeUndefined();
  });

  it("returns undefined for unknown backend", () => {
    const model = resolveModelForTask("define", "nonexistent", "/fake/project");
    expect(model).toBeUndefined();
  });
});
