/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchPlugins, installPlugin, updatePlugin } from "./registry.js";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("Plugin Registry Engine", () => {
  let tempHome: string;
  let oldHome: string;
  let registryPath: string;
  let pluginsPath: string;

  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), "gwrk-registry-test-"));
    oldHome = os.homedir();
    
    // We need to mock os.homedir() if we want registry.ts to use our tempHome
    // But registry.ts imports os and defines constants at the top level.
    // This is tricky. Let's try to mock os.homedir.
    vi.spyOn(os, "homedir").mockReturnValue(tempHome);
    
    registryPath = path.join(tempHome, ".gwrk", "registry");
    pluginsPath = path.join(tempHome, ".gwrk", "plugins");
    
    await fsp.mkdir(path.join(registryPath, "skills", "test-skill"), { recursive: true });
    await fsp.writeFile(
      path.join(registryPath, "skills", "test-skill", "manifest.yaml"),
      `
type: skill
name: test-skill
version: 1.0.0
description: A test skill
tier: atomic
category: reasoning
prompt: test
interface:
  input: stdin
  output: stdout
runtime:
  preferredAgent: test
  preferredModel: test
      `
    );
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  describe("searchPlugins", () => {
    it("FR-041: should return matching plugins from registry", async () => {
      const results = await searchPlugins("test");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("test-skill");
    });

    it("should return empty array if no match", async () => {
      const results = await searchPlugins("nomatch");
      expect(results).toHaveLength(0);
    });
  });

  describe("installPlugin", () => {
    it("FR-042: should install from registry ID", async () => {
      const manifest = await installPlugin("test-skill");
      expect(manifest.name).toBe("test-skill");
      expect(fs.existsSync(path.join(pluginsPath, "skills", "test-skill", "manifest.yaml"))).toBe(true);
    });

    it("should install from local path", async () => {
      const localPath = await fsp.mkdtemp(path.join(os.tmpdir(), "local-plugin-"));
      await fsp.writeFile(
        path.join(localPath, "manifest.yaml"),
        `
type: agent
name: local-agent
version: 1.0.0
description: A local agent
dispatchMode: local-cli
contextFileName: context.md
capabilities: []
models: {}
exitCodeMap: {}
        `
      );
      
      const manifest = await installPlugin(localPath);
      expect(manifest.name).toBe("local-agent");
      expect(fs.existsSync(path.join(pluginsPath, "agents", "local-agent", "manifest.yaml"))).toBe(true);
      
      await fsp.rm(localPath, { recursive: true, force: true });
    });

    it("should throw error if plugin not found", async () => {
      await expect(installPlugin("non-existent")).rejects.toThrow("Plugin 'non-existent' not found");
    });
  });

  describe("updatePlugin", () => {
    it("FR-043: should run git pull for git-based plugins", async () => {
      const pluginDir = path.join(pluginsPath, "skills", "git-skill");
      await fsp.mkdir(path.join(pluginDir, ".git"), { recursive: true });
      await fsp.writeFile(path.join(pluginDir, "manifest.yaml"), "name: git-skill"); // Minimal, loader might fail but we just need it to exist for updatePlugin's dir scan
      
      const updated = await updatePlugin();
      expect(execSync).toHaveBeenCalledWith("git pull", expect.objectContaining({ cwd: pluginDir }));
      expect(updated).toContain("git-skill");
    });
  });
});
