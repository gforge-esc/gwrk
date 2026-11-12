/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import os from "node:os";
import { describe, expect, it } from "vitest";
import { validateAgentRegistry } from "./agent-config.js";

const project = JSON.stringify({
  agents: {
    registry: {
      agy: {
        type: "local-cli",
        command: "agy",
        quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
        maxConcurrent: 1,
        models: [],
      },
    },
    fallbackOrder: ["agy"],
  },
});

describe("Registry validation from supplied layers", () => {
  it("merges valid layers with global precedence and injects backend keys", () => {
    const layers = {
      projectConfigRaw: project,
      localConfigRaw: '{"agents":{"registry":{"agy":{"maxConcurrent":2}}}}',
      globalConfigRaw: '{"agents":{"registry":{"agy":{"maxConcurrent":3}}}}',
    };
    const result = validateAgentRegistry(layers);
    expect(result).toMatchObject({
      ok: true,
      value: {
        backends: { agy: { name: "agy", command: "agy", maxConcurrent: 3 } },
        fallbackOrder: ["agy"],
      },
    });
    const cwd = process.cwd();
    try {
      process.chdir(os.tmpdir());
      expect(validateAgentRegistry(layers)).toEqual(result);
    } finally {
      process.chdir(cwd);
    }
  });

  it("ignores malformed optional layers", () => {
    const layers = { projectConfigRaw: project };
    expect(
      validateAgentRegistry({
        ...layers,
        localConfigRaw: "invalid JSON",
        globalConfigRaw: "[]",
      }),
    ).toEqual(validateAgentRegistry(layers));
  });

  it.each([
    [null, "MISSING_CONFIG_FILE"],
    ["invalid JSON", "INVALID_CONFIG_JSON"],
    ['{"agents":{"registry":{}}}', "MISSING_REGISTRY_CONFIG"],
    [
      project.replace('"maxConcurrent":1', '"maxConcurrent":0'),
      "INVALID_REGISTRY_SCHEMA",
    ],
  ])("returns a typed error for %s", (projectConfigRaw, code) => {
    expect(validateAgentRegistry({ projectConfigRaw })).toMatchObject({
      ok: false,
      error: { code },
    });
  });
});
