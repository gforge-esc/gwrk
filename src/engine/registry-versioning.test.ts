/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  computePluginDigest,
  doctorPlugins,
  generateRegistryIndex,
  installPlugin,
  parsePluginSpec,
  satisfiesSemver,
  updatePlugin,
} from "./registry.js";

describe("036-plugin-registry-versioning: SemVer, registry.json catalog, lockfile, and doctor", () => {
  let tempHome: string;
  let registryDir: string;

  beforeEach(async () => {
    tempHome = await fsp.mkdtemp(path.join(os.tmpdir(), "gwrk-reg-ver-"));
    vi.stubEnv("GWRK_HOME", path.join(tempHome, ".gwrk"));
    registryDir = path.join(tempHome, ".gwrk", "registry");
    await fsp.mkdir(path.join(registryDir, "skills", "fastapi-standards"), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(registryDir, "skills", "fastapi-standards", "manifest.yaml"),
      `type: skill
name: fastapi-standards
version: 1.0.0
description: FastAPI enforcement standards
tier: enforcement
scope: all
language: Python
framework: FastAPI
`,
    );
    await fsp.writeFile(
      path.join(registryDir, "skills", "fastapi-standards", "SKILL.md"),
      "# FastAPI Standards\n",
    );
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fsp.rm(tempHome, { recursive: true, force: true });
  });

  it("parses <name>@<version> specifiers and evaluates SemVer comparisons and ranges", () => {
    expect(parsePluginSpec("fastapi-standards")).toEqual({
      name: "fastapi-standards",
      versionSpec: undefined,
    });
    expect(parsePluginSpec("fastapi-standards@1.2.3")).toEqual({
      name: "fastapi-standards",
      versionSpec: "1.2.3",
    });
    expect(parsePluginSpec("fastapi-standards@^1.0.0")).toEqual({
      name: "fastapi-standards",
      versionSpec: "^1.0.0",
    });
    expect(parsePluginSpec("fastapi-standards@latest")).toEqual({
      name: "fastapi-standards",
      versionSpec: "latest",
    });

    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(compareSemver("1.0.0-beta.1", "1.0.0")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.9.9")).toBeGreaterThan(0);

    expect(satisfiesSemver("1.2.3", "1.2.3")).toBe(true);
    expect(satisfiesSemver("1.2.3", "^1.0.0")).toBe(true);
    expect(satisfiesSemver("2.0.0", "^1.0.0")).toBe(false);
    expect(satisfiesSemver("1.2.3", "~1.2.0")).toBe(true);
    expect(satisfiesSemver("1.3.0", "~1.2.0")).toBe(false);
    expect(satisfiesSemver("1.5.0", ">=1.2.0")).toBe(true);
    expect(satisfiesSemver("1.0.0", "latest")).toBe(true);
  });

  it("generates registry.json catalog with SHA-256 digests and verifies lockfile on install", async () => {
    const catalog = await generateRegistryIndex(registryDir);
    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.plugins["fastapi-standards"]).toBeDefined();
    expect(catalog.plugins["fastapi-standards"].latest).toBe("1.0.0");
    const entry = catalog.plugins["fastapi-standards"].versions["1.0.0"];
    expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.existsSync(path.join(registryDir, "registry.json"))).toBe(true);

    // Install with explicit version specifier
    const manifest = await installPlugin("fastapi-standards@^1.0.0");
    expect(manifest.name).toBe("fastapi-standards");
    expect(manifest.version).toBe("1.0.0");

    // Verify plugins-lock.json was written with version and sha256
    const lockPath = path.join(tempHome, ".gwrk", "plugins-lock.json");
    expect(fs.existsSync(lockPath)).toBe(true);
    const lock = JSON.parse(await fsp.readFile(lockPath, "utf-8"));
    expect(lock.plugins["fastapi-standards"]).toMatchObject({
      version: "1.0.0",
      sha256: entry.sha256,
    });

    // Rejects installing a version that does not satisfy the requested range
    await expect(
      installPlugin("fastapi-standards@^2.0.0", { force: true }),
    ).rejects.toThrow(/version/i);
  });

  it("skips up-to-date plugins during update when registry.json version matches, and updates when version bumps", async () => {
    await generateRegistryIndex(registryDir);
    await installPlugin("fastapi-standards@1.0.0");

    // Same version in registry.json -> no update needed
    const skippedUpdate = await updatePlugin("fastapi-standards");
    expect(skippedUpdate).toEqual([]);

    // Bump version in registry to 1.1.0 and regenerate index
    await fsp.writeFile(
      path.join(registryDir, "skills", "fastapi-standards", "manifest.yaml"),
      `type: skill
name: fastapi-standards
version: 1.1.0
description: FastAPI enforcement standards v1.1
tier: enforcement
scope: all
language: Python
framework: FastAPI
`,
    );
    await generateRegistryIndex(registryDir);

    const appliedUpdate = await updatePlugin("fastapi-standards");
    expect(appliedUpdate).toContain("fastapi-standards");

    const lock = JSON.parse(
      await fsp.readFile(path.join(tempHome, ".gwrk", "plugins-lock.json"), "utf-8"),
    );
    expect(lock.plugins["fastapi-standards"].version).toBe("1.1.0");
  });

  it("verifies installed plugin integrity via doctorPlugins and detects tampered files", async () => {
    await generateRegistryIndex(registryDir);
    await installPlugin("fastapi-standards@1.0.0");

    const healthyReport = await doctorPlugins();
    expect(healthyReport.healthy).toBe(true);
    expect(healthyReport.entries).toHaveLength(1);
    expect(healthyReport.entries[0].status).toBe("ok");

    // Tamper with installed SKILL.md
    const installedSkillMd = path.join(
      tempHome,
      ".gwrk",
      "plugins",
      "skills",
      "fastapi-standards",
      "SKILL.md",
    );
    await fsp.writeFile(installedSkillMd, "# Tampered content\n");

    const tamperedReport = await doctorPlugins();
    expect(tamperedReport.healthy).toBe(false);
    expect(tamperedReport.entries[0].status).toBe("integrity-mismatch");

    // Compute digest directly
    const digest = await computePluginDigest(path.dirname(installedSkillMd));
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});
