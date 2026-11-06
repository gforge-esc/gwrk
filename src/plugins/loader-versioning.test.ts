/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PluginLoader } from "./loader.js";

describe("036-plugin-registry-versioning: AGY-style plugin state and discovery in PluginLoader", () => {
  let tempHome: string;
  let globalPluginsDir: string;
  let projectDir: string;

  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), "gwrk-loader-ver-"));
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    globalPluginsDir = path.join(tempHome, ".gwrk", "plugins");
    projectDir = path.join(tempHome, "project");
    await fsp.mkdir(path.join(projectDir, ".gwrk"), { recursive: true });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it("respects manifest disabled: true default unless explicitly enabled in user or project config", async () => {
    const skillDir = path.join(globalPluginsDir, "skills", "opt-in-skill");
    await fsp.mkdir(skillDir, { recursive: true });
    await fsp.writeFile(
      path.join(skillDir, "manifest.yaml"),
      `type: skill
name: opt-in-skill
version: 1.0.0
description: Opt-in skill disabled by default
tier: enforcement
scope: all
disabled: true
`,
    );

    const loader = new PluginLoader({
      globalDir: globalPluginsDir,
      projectDir,
    });

    // Disabled by default when includeDisabled is true
    const allWithDisabled = await loader.listPlugins({ includeDisabled: true });
    const foundDisabled = allWithDisabled.find((p) => p.name === "opt-in-skill");
    expect(foundDisabled?.status).toBe("disabled");

    // Excluded from activeOnly list
    const activeList = await loader.listPlugins({ activeOnly: true });
    expect(activeList.find((p) => p.name === "opt-in-skill")).toBeUndefined();

    // Enable in ~/.gwrk/config.json -> becomes active without modifying manifest.yaml
    await fsp.writeFile(
      path.join(tempHome, ".gwrk", "config.json"),
      JSON.stringify({
        plugins: {
          "opt-in-skill": { enabled: true },
        },
      }),
    );

    const activeAfterGlobalEnable = await loader.listPlugins({ activeOnly: true });
    expect(
      activeAfterGlobalEnable.find((p) => p.name === "opt-in-skill")?.status,
    ).toBe("active");

    // Project .gwrk/plugins.json can override global enable back to disabled
    await fsp.writeFile(
      path.join(projectDir, ".gwrk", "plugins.json"),
      JSON.stringify({
        plugins: {
          "opt-in-skill": { enabled: false },
        },
      }),
    );

    const activeAfterProjectDisable = await loader.listPlugins({ activeOnly: true });
    expect(
      activeAfterProjectDisable.find((p) => p.name === "opt-in-skill"),
    ).toBeUndefined();
    await expect(loader.resolvePlugin("opt-in-skill")).rejects.toThrow(/disabled/i);
  });

  it("supports .gwrk/plugins.json entries discovery and inherits: false isolation", async () => {
    // 1. Global skill
    const globalSkillDir = path.join(globalPluginsDir, "skills", "global-skill");
    await fsp.mkdir(globalSkillDir, { recursive: true });
    await fsp.writeFile(
      path.join(globalSkillDir, "manifest.yaml"),
      `type: skill
name: global-skill
version: 1.0.0
description: Global skill
tier: enforcement
scope: all
`,
    );

    // 2. Custom external entry directory referenced by .gwrk/plugins.json
    const customPackDir = path.join(tempHome, "custom-pack");
    await fsp.mkdir(path.join(customPackDir, "skills", "pack-skill"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(customPackDir, "skills", "pack-skill", "manifest.yaml"),
      `type: skill
name: pack-skill
version: 2.1.0
description: Custom pack skill
tier: enforcement
scope: all
`,
    );

    await fsp.writeFile(
      path.join(projectDir, ".gwrk", "plugins.json"),
      JSON.stringify({
        inherits: false,
        entries: [customPackDir],
      }),
    );

    const loader = new PluginLoader({
      globalDir: globalPluginsDir,
      projectDir,
    });

    const list = await loader.listPlugins();
    // pack-skill from entries is loaded
    expect(list.find((p) => p.name === "pack-skill")?.version).toBe("2.1.0");
    // global-skill is skipped because inherits: false
    expect(list.find((p) => p.name === "global-skill")).toBeUndefined();
  });
});
