/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectProfile } from "../domain/types.js";
import { detectProfile } from "../engine/profile-detector.js";
import { type LoadedEnforcementCandidate, PluginLoader } from "../plugins/loader.js";
import { listPlugins } from "./plugin.js";

vi.mock("../plugins/loader.js");
vi.mock("../engine/profile-detector.js");

function candidate(
  name: string,
  source: LoadedEnforcementCandidate["source"],
  selectors: Partial<LoadedEnforcementCandidate["manifest"]> = {},
): LoadedEnforcementCandidate {
  return {
    name,
    source,
    path: `/plugins/${source}/${name}`,
    manifest: {
      name,
      type: "skill",
      tier: "enforcement",
      scope: "all",
      version: "1.0.0",
      description: name,
      ...selectors,
    },
  };
}

describe("plugin list --project", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(PluginLoader.prototype.listPlugins).mockResolvedValue([]);
  });

  it("filters enforcement skills by profile language", async () => {
    vi.mocked(detectProfile).mockResolvedValue({
      type: "python",
      stack: { language: "Python" },
    });
    vi.mocked(PluginLoader.prototype.listEnforcementCandidates).mockResolvedValue([
      candidate("typescript-standards", "builtin", { language: "TypeScript" }),
      candidate("python-standards", "builtin", { language: "Python" }),
    ]);

    const output = await listPlugins({ project: true, type: "skill" });
    expect(output).toContain("python-standards");
    expect(output).not.toContain("typescript-standards");
  });

  it("lists the compatible copy and applies project scope alongside framework and architecture selectors", async () => {
    const profile: ProjectProfile = {
      type: "nodejs",
      stack: { language: "TypeScript", framework: "Express" },
      design: {
        architecture: "hexagonal-functional",
        principles: ["functional-core"],
        templateVersion: "1.0.0",
      },
    };
    vi.mocked(detectProfile).mockResolvedValue(profile);
    vi.mocked(PluginLoader.prototype.listEnforcementCandidates).mockResolvedValue([
      candidate("legacy-standards", "global"),
      candidate("express-standards", "project-local", {
        language: "TypeScript",
        framework: "Express",
        architectures: ["layered"],
        version: "2.0.0",
      }),
      candidate("express-standards", "project-entry", {
        language: "TypeScript",
        framework: "Express",
        architectures: ["hexagonal-functional"],
      }),
      candidate("fastify-standards", "global", {
        language: "TypeScript",
        framework: "Fastify",
      }),
      candidate("gwrk-conventions", "builtin", { projectScope: "gwrk" }),
    ]);

    const options = { project: true, format: "json", tier: "enforcement" };
    const external = JSON.parse(await listPlugins(options));
    expect(external.map(({ name }: { name: string }) => name).sort()).toEqual([
      "express-standards",
      "legacy-standards",
    ]);
    expect(external).toContainEqual(expect.objectContaining({
      name: "express-standards",
      version: "1.0.0",
      status: "active",
    }));

    vi.mocked(detectProfile).mockResolvedValue({ ...profile, _isGwrk: true });
    expect(await listPlugins(options)).toContain("gwrk-conventions");
  });

  it("shows a disabled override without listing an active lower layer", async () => {
    vi.mocked(detectProfile).mockResolvedValue({ type: "unknown" });
    vi.mocked(PluginLoader.prototype.listEnforcementCandidates).mockResolvedValue([
      candidate("custom-policy", "project-local", { disabled: true, version: "2.0.0" }),
      candidate("custom-policy", "project-entry"),
    ]);

    const output = JSON.parse(await listPlugins({ project: true, format: "json" }));
    expect(output).toEqual([
      expect.objectContaining({
        name: "custom-policy",
        version: "2.0.0",
        status: "disabled",
      }),
    ]);
  });
});
