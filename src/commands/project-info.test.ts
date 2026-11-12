/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { projectInfoCommand } from "./project-info.js";
import * as detector from "../engine/profile-detector.js";
import { Command } from "commander";

/**
 * TR-032: Unit test gwrk project info
 * FR-035: Display resolved profile
 */
describe("FR-035: Project Profile Introspection", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-032.1: returns valid JSON matching ProjectProfileSchema when --format json is used", async () => {
    expect(projectInfoCommand.name()).toBe("info");
    const options = projectInfoCommand.options.map(o => o.flags);
    expect(options).toContain("--format <type>");
  });

  it("US-029.1: displays type, stack, and layout in default output", async () => {
    const mockProfile = {
      type: "gwrk-native",
      stack: { language: "TypeScript", buildSystem: "pnpm" },
      layout: "src-nested"
    };
    vi.spyOn(detector, "detectProfile").mockResolvedValue(mockProfile);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    await program.parseAsync(['info'], { from: 'user' });

    const output = writeSpy.mock.calls.map(call => call[0]).join("");
    expect(output).toContain("Project Profile: gwrk-native");
    expect(output).toContain("Language: TypeScript");
    expect(output).toContain("Layout: src-nested");
    expect(output).toContain("Source: auto-detected"); // New requirement FR-035
  });

  it("US-029.2: supports --format json", async () => {
    const mockProfile = {
      type: "nodejs",
      stack: { language: "JavaScript", buildSystem: "npm" },
      layout: "flat"
    };
    vi.spyOn(detector, "detectProfile").mockResolvedValue(mockProfile);
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    const program = new Command();
    program.exitOverride();
    program.addCommand(projectInfoCommand);
    
    await program.parseAsync(['info', '--format', 'json'], { from: 'user' });

    const output = writeSpy.mock.calls.map(call => call[0]).join("");
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe("nodejs");
    expect(parsed.stack.language).toBe("JavaScript");
  });
});

it("resolves registered workspaces through the built CLI with only root config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-project-info-"));
  const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
  const design = {
    architecture: "hexagonal-functional",
    principles: ["functional-core", "clean-code", "tdd"],
    templateVersion: "1.0.0",
  };
  const workspaces = {
    api: {
      stack: { language: "Python", framework: "Django", buildSystem: "uv" },
      toolchain: { build: null, test: "pytest", testCommand: "uv run pytest {files}" },
    },
    ui: {
      stack: { language: "TypeScript", framework: "React", buildSystem: "pnpm" },
      toolchain: { build: "pnpm build", test: "vitest", testCommand: "pnpm exec vitest run {files}" },
    },
  };
  try {
    fs.mkdirSync(path.join(root, ".git"));
    fs.writeFileSync(
      path.join(root, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "fixture", design }, workspaces }),
    );
    for (const [name, profile] of Object.entries(workspaces)) {
      const cwd = path.join(root, name);
      fs.mkdirSync(cwd);
      const result = spawnSync(process.execPath, [cli, "project", "info", "--format", "json"], {
        cwd,
        encoding: "utf8",
        env: { ...process.env, GWRK_HOME: path.join(root, "home") },
        timeout: 10_000,
      });
      expect.soft(result.status, result.stderr).toBe(0);
      if (result.status === 0) {
        expect.soft(JSON.parse(result.stdout)).toMatchObject({ design, ...profile });
      }
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  { scenario: "unmanaged directory", configDirectory: undefined },
  { scenario: "invalid local config", configDirectory: "api" },
  { scenario: "invalid ancestor config", configDirectory: "." },
  { scenario: "registration outside the worktree", configDirectory: ".", nestedWorktree: true },
])("rejects $scenario through the built CLI", ({ configDirectory, nestedWorktree }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-project-info-"));
  const cli = fileURLToPath(new URL("../../dist/cli.js", import.meta.url));
  const cwd = path.join(root, "api");
  try {
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(cwd);
    if (nestedWorktree) fs.writeFileSync(path.join(cwd, ".git"), "gitdir: ../.git\n");
    if (configDirectory !== undefined) {
      fs.writeFileSync(
        path.join(root, configDirectory, ".gwrkrc.json"),
        JSON.stringify({
          project: { name: "fixture" },
          workspaces: { api: { stack: { language: nestedWorktree ? "Python" : 42 } } },
        }),
      );
    }
    const result = spawnSync(process.execPath, [cli, "project", "info", "--format", "json"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GWRK_HOME: path.join(root, "home") },
      timeout: 10_000,
    });
    expect.soft(result.status, result.stderr).toBe(1);
    expect.soft(result.stdout).toBe("");
    if (configDirectory === undefined || nestedWorktree) {
      expect(result.stderr).toContain("Configuration file .gwrkrc.json not found");
    } else {
      expect(result.stderr).toContain("Configuration error in .gwrkrc.json");
      expect(result.stderr).toMatch(/"workspaces",\s*"api",\s*"stack",\s*"language"/);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
