/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * One place decides which agent a command dispatches to.
 *
 * Nine call sites had repeated `loadConfig` plus `config.agents.<pillar>` plus
 * `resolveModelForTask`, and they disagreed. `define ontology` read no config at
 * all, so `agents.define: "claude"` was ignored and the dispatch fell through to
 * the hardcoded "agy" in agent.ts. `implement` and `ship` honoured `--agent`;
 * six define commands ignored it. Each divergence was found by a user hitting it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveAgent } from "./resolve-agent.js";
import * as configUtils from "./config.js";
import * as modelUtils from "./resolve-model.js";

const ROOT = "/repo";

beforeEach(() => {
  vi.restoreAllMocks();
  // A registry is present by default. Model resolution only runs when one is,
  // so the base fixture has to carry it for the model assertions to mean
  // anything. The no-registry case gets its own test below.
  vi.spyOn(configUtils, "loadConfig").mockReturnValue({
    agents: {
      define: "claude",
      implement: "codex",
      registry: {
        claude: { name: "claude", models: [] },
        codex: { name: "codex", models: [] },
        agy: { name: "agy", models: [] },
      },
      fallbackOrder: ["claude"],
    },
  } as never);
  vi.spyOn(modelUtils, "resolveModelForTask").mockReturnValue("opus-5");
});

describe("resolveAgent", () => {
  it("reads the define backend from config", () => {
    expect(resolveAgent("define", ROOT).backend).toBe("claude");
  });

  it("reads the implement backend from config", () => {
    expect(resolveAgent("implement", ROOT).backend).toBe("codex");
  });

  it("resolves the model for the pillar and the chosen backend", () => {
    const resolved = resolveAgent("define", ROOT);

    expect(resolved.model).toBe("opus-5");
    expect(vi.mocked(modelUtils.resolveModelForTask)).toHaveBeenCalledWith(
      "define",
      "claude",
      ROOT,
    );
  });

  it("loads config from the project root, never the working directory", () => {
    // `loadConfig` joins its argument with .gwrkrc.json and does not walk
    // parents, so a subdirectory must not reach it.
    resolveAgent("define", ROOT);

    expect(vi.mocked(configUtils.loadConfig)).toHaveBeenCalledWith(ROOT);
  });

  it("lets an explicit agent override the configured backend", () => {
    const resolved = resolveAgent("define", ROOT, { agent: "agy" });

    expect(resolved.backend).toBe("agy");
  });

  it("resolves the model for the overriding backend, not the configured one", () => {
    resolveAgent("define", ROOT, { agent: "agy" });

    expect(vi.mocked(modelUtils.resolveModelForTask)).toHaveBeenCalledWith(
      "define",
      "agy",
      ROOT,
    );
  });

  it("lets an explicit model override the registry", () => {
    expect(resolveAgent("define", ROOT, { model: "haiku" }).model).toBe("haiku");
  });

  it("ignores an empty agent override", () => {
    // Commander hands through an absent option as undefined, but a shell can
    // produce "". Neither may shadow the configured backend.
    expect(resolveAgent("define", ROOT, { agent: "" }).backend).toBe("claude");
  });

  it("returns an undefined model when the registry resolves none", () => {
    // A backend with `models: []` is legal. The dispatcher picks its own default.
    vi.mocked(modelUtils.resolveModelForTask).mockReturnValue(undefined);

    expect(resolveAgent("define", ROOT).model).toBeUndefined();
  });

  it("skips model resolution when the config declares no registry", () => {
    // `resolveModelForTask` reaches `loadRegistry`, which calls process.exit(1)
    // on a config with no `agents.registry`. process.exit is not throwable, so
    // its own try/catch cannot see it and `withSignal` never emits an exit line.
    // A project with no registry is legal; it just has no model to pick.
    vi.spyOn(configUtils, "loadConfig").mockReturnValue({
      agents: { define: "claude", implement: "claude" },
    } as never);

    const resolved = resolveAgent("define", ROOT);

    expect(resolved.backend).toBe("claude");
    expect(resolved.model).toBeUndefined();
    expect(vi.mocked(modelUtils.resolveModelForTask)).not.toHaveBeenCalled();
  });

  it("still resolves a model when a registry is present", () => {
    vi.spyOn(configUtils, "loadConfig").mockReturnValue({
      agents: {
        define: "claude",
        implement: "claude",
        registry: { claude: { name: "claude", models: [] } },
        fallbackOrder: ["claude"],
      },
    } as never);

    expect(resolveAgent("define", ROOT).model).toBe("opus-5");
  });
});
