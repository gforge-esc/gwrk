/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { GwrkConfigSchema, resolveEffortConfig, loadConfig, deepMerge } from "./config.js";

describe("deepMerge", () => {
  it("should merge flat objects", () => {
    const base = { a: 1, b: 2 };
    const overlay = { b: 3, c: 4 };
    expect(deepMerge(base, overlay)).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("should deep-merge nested objects", () => {
    const base = { agents: { define: "gemini", implement: "gemini" } };
    const overlay = { agents: { define: "claude" } };
    expect(deepMerge(base, overlay)).toEqual({
      agents: { define: "claude", implement: "gemini" },
    });
  });

  it("should replace arrays entirely (not concat)", () => {
    const base = { fallbackOrder: ["gemini", "claude"] };
    const overlay = { fallbackOrder: ["agy"] };
    expect(deepMerge(base, overlay)).toEqual({ fallbackOrder: ["agy"] });
  });

  it("should not modify the base object", () => {
    const base = { a: { b: 1 } };
    const overlay = { a: { b: 2 } };
    deepMerge(base, overlay);
    expect(base.a.b).toBe(1);
  });

  it("should handle overlay adding new nested keys", () => {
    const base = { project: { name: "test" } };
    const overlay = { project: { slack: { channelId: "C123" } } };
    expect(deepMerge(base, overlay)).toEqual({
      project: { name: "test", slack: { channelId: "C123" } },
    });
  });

  it("should handle null overlay values (replace with null)", () => {
    const base = { a: { b: 1 } };
    const overlay = { a: null };
    expect(deepMerge(base, overlay)).toEqual({ a: null });
  });
});

describe("Three-layer config loading", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-config-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const minimalProject = {
    project: { name: "test-project" },
    agents: { define: "gemini", implement: "gemini" },
  };

  it("should load project config only when no overlays exist", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify(minimalProject),
    );
    const config = loadConfig(tmpDir);
    expect(config.project.name).toBe("test-project");
    expect(config.agents.define).toBe("gemini");
  });

  it("should load a project-identity-only config (no agents) and default agents", () => {
    // The tracked .gwrkrc.json holds project identity only; agents live in the
    // gitignored .gwrkrc.local.json layer. A fresh clone must still load.
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "test-project" } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.project.name).toBe("test-project");
    expect(config.agents.define).toBe("gemini");
    expect(config.agents.implement).toBe("gemini");
  });

  it("should merge .gwrkrc.local.json over project config", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify(minimalProject),
    );
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.local.json"),
      JSON.stringify({ agents: { define: "claude", implement: "agy" } }),
    );
    const config = loadConfig(tmpDir);
    expect(config.project.name).toBe("test-project"); // from project
    expect(config.agents.define).toBe("claude");       // from local
    expect(config.agents.implement).toBe("agy");       // from local
  });

  it("should merge ~/.gwrk/config.json as highest precedence", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify(minimalProject),
    );

    // Use GWRK_HOME env var to point to a temp directory
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-home-"));
    fs.writeFileSync(
      path.join(fakeHome, "config.json"),
      JSON.stringify({
        project: { slack: { channelId: "C999", webhookUrl: "https://hooks.slack.com/services/SECRET" } },
      }),
    );

    const originalGwrkHome = process.env.GWRK_HOME;
    process.env.GWRK_HOME = fakeHome;

    try {
      const config = loadConfig(tmpDir);
      expect(config.project.slack?.channelId).toBe("C999");
    } finally {
      if (originalGwrkHome === undefined) {
        delete process.env.GWRK_HOME;
      } else {
        process.env.GWRK_HOME = originalGwrkHome;
      }
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  });

  it("should skip malformed overlay files gracefully", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify(minimalProject),
    );
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.local.json"),
      "{ invalid json",
    );
    // Should not throw — malformed overlay is skipped
    const config = loadConfig(tmpDir);
    expect(config.agents.define).toBe("gemini"); // falls back to project
  });

  it("ships a .gwrkrc.local.json.example that loads as a personal overlay", () => {
    // CONTRIBUTING.md tells contributors to `cp .gwrkrc.local.json.example
    // .gwrkrc.local.json`. Guard it against schema drift.
    const examplePath = path.resolve(
      process.cwd(),
      ".gwrkrc.local.json.example",
    );
    expect(fs.existsSync(examplePath), `Missing ${examplePath}`).toBe(true);

    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      JSON.stringify({ project: { name: "test-project" } }),
    );
    fs.copyFileSync(examplePath, path.join(tmpDir, ".gwrkrc.local.json"));

    const config = loadConfig(tmpDir);
    expect(config.agents.registry?.gemini?.name).toBe("gemini");
  });

  it("should throw if .gwrkrc.json is missing", () => {
    expect(() => loadConfig(tmpDir)).toThrow(
      "Configuration file .gwrkrc.json not found",
    );
  });

  it("should throw if .gwrkrc.json has invalid JSON", () => {
    fs.writeFileSync(
      path.join(tmpDir, ".gwrkrc.json"),
      "not json at all",
    );
    expect(() => loadConfig(tmpDir)).toThrow(
      "Configuration error: invalid JSON in .gwrkrc.json",
    );
  });
});

describe("FR-017: Three-layer Config Resolution", () => {
  it("should resolve using internal defaults when no config is provided", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
    });
    const effort = resolveEffortConfig(config);
    expect(effort.profile).toBe("TS");
    expect(effort.locRate).toBe(50);
    expect(effort.hoursPerSP).toBe(4);
  });

  it("should resolve using profile-specific defaults (Rust)", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
      effort: { profile: "Rust" },
    });
    const effort = resolveEffortConfig(config);
    expect(effort.profile).toBe("Rust");
    expect(effort.locRate).toBe(35);
    expect(effort.hoursPerSP).toBe(6); // RE multiplier
  });

  it("should allow explicit overrides to trump defaults", () => {
    const config = GwrkConfigSchema.parse({
      project: { name: "test-project" },
      agents: {},
      effort: {
        profile: "TS",
        locRates: { TS: 30 },
        roles: { TS: { hoursPerSP: 2 } },
      },
    });
    const effort = resolveEffortConfig(config);
    expect(effort.locRate).toBe(30);
    expect(effort.hoursPerSP).toBe(2);
  });

  it("TC-003: should validate effort section in GwrkConfigSchema", () => {
    const validEffort = {
      project: { name: "test-project" },
      agents: {},
      effort: {
        profile: "default",
        locRates: { TS: 50 },
      },
    };
    // DM-001: Effort profile schema verification
    expect(() => GwrkConfigSchema.parse(validEffort)).not.toThrow();
  });

  it("should throw error for invalid effort rate types", () => {
    const invalidEffort = {
      project: { name: "test-project" },
      agents: {},
      effort: {
        locRates: { TS: "fast" }, // Should be number
      },
    };
    expect(() => GwrkConfigSchema.parse(invalidEffort)).toThrow();
  });
});

describe("FR-001: Workspace Configuration Schema (020-polyglot-monorepo)", () => {
  it("US-001: should validate GwrkConfigSchema with valid workspaces", () => {
    const validConfig = {
      project: {
        name: "polyglot-project",
        type: "pnpm-monorepo",
        stack: { language: "TypeScript", packageManager: "pnpm" },
        layout: "monorepo"
      },
      agents: {},
      workspaces: {
        web: {
          stack: { language: "typescript" }
        },
        backend: {
          stack: { language: "rust" }
        }
      }
    };
    expect(() => GwrkConfigSchema.parse(validConfig)).not.toThrow();
  });

  it("FR-032: should validate GwrkConfigSchema with extended profile fields", () => {
    const validConfig = {
      project: {
        name: "extended-project",
        type: "gwrk-native",
        stack: {
          language: "TypeScript",
          framework: "React",
          buildSystem: "pnpm",
          testFramework: "vitest"
        },
        layout: "monorepo",
        architecture: "docs/architecture.md",
        conventions: "docs/conventions.md"
      },
      agents: {}
    };
    const parsed = GwrkConfigSchema.parse(validConfig);
    expect(parsed.project.type).toBe("gwrk-native");
    expect(parsed.project.stack?.testFramework).toBe("vitest");
    expect(parsed.project.architecture).toBe("docs/architecture.md");
  });

  it("TR-003 (021 FR-001): validates project.toolchain and rejects wrong types", () => {
    const valid = {
      project: {
        name: "js-project",
        stack: { language: "JavaScript" },
        toolchain: {
          test: "vitest",
          testCommand: "make test:auth",
          build: null,
          testExtension: ".test.js",
          sourceExtension: ".js",
        },
      },
      agents: {},
    };
    const parsed = GwrkConfigSchema.parse(valid);
    expect(parsed.project.toolchain?.testExtension).toBe(".test.js");
    expect(parsed.project.toolchain?.build).toBeNull();
    expect(parsed.project.toolchain?.test).toBe("vitest");
    expect(parsed.project.toolchain?.testCommand).toBe("make test:auth");

    // null test = skip is allowed
    expect(() =>
      GwrkConfigSchema.parse({
        project: { name: "p", toolchain: { test: null } },
        agents: {},
      }),
    ).not.toThrow();

    // wrong type rejected (ZodError, FR-024)
    expect(() =>
      GwrkConfigSchema.parse({
        project: { name: "p", toolchain: { build: 123 } },
        agents: {},
      }),
    ).toThrow();

    // unknown harness rejected (test is an enum, not a free string)
    expect(() =>
      GwrkConfigSchema.parse({
        project: { name: "p", toolchain: { test: "mocha" } },
        agents: {},
      }),
    ).toThrow();
  });

  it("021 FR-010: validates per-workspace toolchain", () => {
    const cfg = {
      project: { name: "mono" },
      agents: {},
      workspaces: {
        api: {
          stack: { language: "Python" },
          toolchain: { test: "pytest", testExtension: ".py" },
        },
      },
    };
    const parsed = GwrkConfigSchema.parse(cfg);
    expect(parsed.workspaces?.api.toolchain?.test).toBe("pytest");
  });

  it("US-001: should throw error for invalid workspace configuration", () => {
    const invalidConfig = {
      project: { name: "polyglot-project" },
      agents: {},
      workspaces: {
        web: {
          stack: "typescript" // Invalid, should be an object
        }
      }
    };
    expect(() => GwrkConfigSchema.parse(invalidConfig)).toThrow();
  });
});
