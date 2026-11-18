/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fsp from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader } from "./loader.js";
import { resolveEnforcementSkills } from "./skill-runtime.js";

vi.mock("node:fs/promises");
vi.mock("./loader.js");

const sources = ["builtin", "global", "project-local"] as const;

describe.each(sources)("enforcement selectors from %s", (source) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    "matching",
    "foreign language",
    "foreign framework",
    "foreign workflow",
  ])("applies the shared selection rules for %s", async (scenario) => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      {
        name: "fixture-rules",
        source,
        path: "/fixture/rules",
        manifest: {
          name: "fixture-rules",
          type: "skill",
          tier: "enforcement",
          version: "1.0.0",
          description: "Fixture rules",
          scope: "review",
          language: "TypeScript",
          framework: "React",
        },
      },
    ]);
    vi.mocked(fsp.readFile).mockResolvedValue("# Fixture Rules");
    const rendered = await resolveEnforcementSkills(
      "/fixture",
      scenario === "foreign workflow" ? "implementation" : "review",
      {
        type: "nodejs",
        stack: {
          language: scenario === "foreign language" ? "Python" : "TypeScript",
          framework: scenario === "foreign framework" ? "Vue" : "React",
        },
      },
    );
    expect(rendered.includes("# Fixture Rules")).toBe(scenario === "matching");
    expect(
      PluginLoader.prototype.listEnforcementCandidates,
    ).toHaveBeenCalledOnce();
    if (scenario !== "matching") expect(fsp.readFile).not.toHaveBeenCalled();
  });

  it("preserves an unscoped legacy review skill", async () => {
    vi.mocked(
      PluginLoader.prototype.listEnforcementCandidates,
    ).mockResolvedValue([
      {
        name: "legacy-review",
        source,
        path: "/fixture/legacy",
        manifest: {
          name: "legacy-review",
          type: "skill",
          tier: "enforcement",
          version: "1.0.0",
          description: "Legacy review",
          scope: "review",
        },
      },
    ]);
    vi.mocked(fsp.readFile).mockResolvedValue("# Legacy Review");
    expect(
      await resolveEnforcementSkills("/fixture", "review", {
        type: "python",
        stack: { language: "Python" },
      }),
    ).toContain("# Legacy Review");
  });
});
