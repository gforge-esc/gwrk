/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initAction, type DetectedAgent } from "./init.js";
import { isSetupComplete, loadSetupState } from "../utils/setup-state.js";
import readline from "node:readline/promises";

vi.mock("node:readline/promises");
vi.mock("../engine/registry.js", () => ({
  syncRegistry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../plugins/seed.js", () => ({
  seedSkills: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../plugins/builtins/agents/index.js", () => ({
  BUILTIN_AGENTS: {
    agy: { name: "agy", isAvailable: vi.fn().mockResolvedValue(true) },
    claude: { name: "claude", isAvailable: vi.fn().mockResolvedValue(true) },
    codex: { name: "codex", isAvailable: vi.fn().mockResolvedValue(true) },
    gemini: { name: "gemini", isAvailable: vi.fn().mockResolvedValue(false) },
  },
}));

// Deterministic agent detection: agy, claude, codex installed; gemini not.
// Without this mock, `which` results depend on the host machine.
const installedAgents = new Set(["agy", "claude", "codex"]);
vi.mock("node:child_process", () => ({
  execSync: vi.fn((cmd: string, opts?: any) => {
    if (typeof cmd === "string" && cmd.startsWith("which ")) {
      const agent = cmd.replace("which ", "").trim();
      if (installedAgents.has(agent)) return Buffer.from(`/usr/local/bin/${agent}\n`);
      throw new Error(`${agent} not found`);
    }
    // gh auth status (detectWorkstation) — simulate success
    if (typeof cmd === "string" && cmd === "gh auth status") {
      return Buffer.from("");
    }
    // Everything else (extension detection) — simulate not found
    throw new Error(`command not found: ${cmd}`);
  }),
}));
vi.mock("../engine/extension-detector.js", () => ({
  detectExtensions: vi.fn().mockResolvedValue([]),
}));

describe("Init Command Tests", () => {
  let tempDir: string;
  let oldCwd: string;

  let gwrkHome: string;
  let oldGwrkHome: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-init-test-"));
    oldCwd = process.cwd();
    process.chdir(tempDir);
    // Redirect ~/.gwrk so setup.json writes never touch the real home dir.
    gwrkHome = fs.mkdtempSync(path.join(os.tmpdir(), "gwrk-home-"));
    oldGwrkHome = process.env.GWRK_HOME;
    process.env.GWRK_HOME = gwrkHome;
    vi.clearAllMocks();

    // Re-establish mock implementations cleared by clearAllMocks.
    const { BUILTIN_AGENTS } = await import("../plugins/builtins/agents/index.js");
    vi.mocked(BUILTIN_AGENTS.agy.isAvailable).mockResolvedValue(true);
    vi.mocked(BUILTIN_AGENTS.claude.isAvailable).mockResolvedValue(true);
    vi.mocked(BUILTIN_AGENTS.codex.isAvailable).mockResolvedValue(true);
    vi.mocked(BUILTIN_AGENTS.gemini.isAvailable).mockResolvedValue(false);

    const { detectExtensions } = await import("../engine/extension-detector.js");
    vi.mocked(detectExtensions).mockResolvedValue([]);

    const { execSync } = await import("node:child_process");
    vi.mocked(execSync).mockImplementation((cmd: any, opts?: any) => {
      if (typeof cmd === "string" && cmd.startsWith("which ")) {
        const agent = cmd.replace("which ", "").trim();
        if (installedAgents.has(agent)) return Buffer.from(`/usr/local/bin/${agent}\n`);
        throw new Error(`${agent} not found`);
      }
      if (typeof cmd === "string" && cmd === "gh auth status") {
        return Buffer.from("");
      }
      throw new Error(`command not found: ${cmd}`);
    });
  });

  afterEach(() => {
    process.chdir(oldCwd);
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(gwrkHome, { recursive: true, force: true });
    if (oldGwrkHome === undefined) delete process.env.GWRK_HOME;
    else process.env.GWRK_HOME = oldGwrkHome;
    vi.restoreAllMocks();
  });

  describe("FR-001: Unified Init Wizard", () => {
    it("US-001: should run interactive wizard when no flags provided", async () => {
      const mockRl = {
        question: vi.fn()
          .mockResolvedValueOnce("n")          // Is this machine the gwrk server? (device role)
          .mockResolvedValueOnce("my-project") // Project name
          .mockResolvedValueOnce("y")          // Profile correct
          .mockResolvedValueOnce("flat")       // Layout
          .mockResolvedValueOnce("Layered")    // Architecture
          .mockResolvedValueOnce("TDD")        // Conventions
          .mockResolvedValueOnce("y")          // Provision workstation
          .mockResolvedValueOnce("")           // Default agent (accept default)
          .mockResolvedValueOnce("")           // Fallback order (accept default)
          .mockResolvedValueOnce(""),          // Slack channel
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      await initAction({});

      expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.name).toBe("my-project");
      expect(config.project.architecture).toBe("Layered");
    });

    it("US-001: should auto-detect project type and present for confirmation", async () => {
      // Create package.json to trigger nodejs detection
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      const mockRl = {
        question: vi.fn()
          .mockResolvedValueOnce("n")                // Is this machine the gwrk server?
          .mockResolvedValueOnce("my-node-project") // Project name
          .mockResolvedValueOnce("y")               // Profile correct (nodejs)
          .mockResolvedValueOnce("src-nested")      // Layout
          .mockResolvedValueOnce("Hexagonal")       // Architecture
          .mockResolvedValueOnce("Functional")      // Conventions
          .mockResolvedValueOnce("n")               // Skip workstation
          .mockResolvedValueOnce("")                // Default agent (accept default)
          .mockResolvedValueOnce("")                // Fallback order (accept default)
          .mockResolvedValueOnce(""),               // Slack channel
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      await initAction({});

      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.type).toBe("nodejs");
      expect(config.project.architecture).toBe("Hexagonal");
    });

    it("US-001: should be idempotent and offer to update existing config", async () => {
      // Setup fake root config to trigger idempotency
      fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify({ project: { name: "root" } }));
      // Pre-seed device.json so machine setup is skipped
      fs.mkdirSync(gwrkHome, { recursive: true });
      fs.writeFileSync(
        path.join(gwrkHome, "device.json"),
        JSON.stringify({ id: "test-id", hostname: "test", role: "remote", createdAt: new Date().toISOString() }),
      );

      const mockRl = {
        question: vi.fn()
          .mockResolvedValueOnce("updated-project") // Project name
          .mockResolvedValueOnce("y")               // Profile correct
          .mockResolvedValueOnce("flat")            // Layout
          .mockResolvedValueOnce("Clean")           // Architecture
          .mockResolvedValueOnce("TDD")             // Conventions
          .mockResolvedValueOnce("n")               // Skip workstation
          .mockResolvedValueOnce("")                // Default agent (accept default)
          .mockResolvedValueOnce("")                // Fallback order (accept default)
          .mockResolvedValueOnce("#new-channel"),   // Slack channel
        close: vi.fn(),
      };
      vi.mocked(readline.createInterface).mockReturnValue(mockRl as any);

      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      await initAction({});
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining("gwrk is already initialized here"));
      
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.name).toBe("updated-project");
      expect(config.project.architecture).toBe("Clean");
      
      const local = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.local.json"), "utf-8"));
      expect(local.project.slack.channelId).toBe("#new-channel");
      
      stdoutSpy.mockRestore();
    });
  });

  describe("FR-001: --non-interactive mode", () => {
    it("should use auto-detection with zero prompts and write .gwrkrc.json", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));
      
      await initAction({ nonInteractive: true });

      expect(fs.existsSync(path.join(tempDir, ".gwrkrc.json"))).toBe(true);
      const config = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(config.project.type).toBe("nodejs");
      expect(readline.createInterface).not.toHaveBeenCalled();
    });
  });

  describe("non-destructive re-init / migration", () => {
    it("preserves existing project identity on --non-interactive re-run", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".gwrkrc.json"),
        JSON.stringify({
          project: {
            name: "data-dashboard",
            type: "unknown",
            stack: {},
            layout: "src-nested",
            architecture: "Layered",
            conventions: "TDD",
          },
        }),
      );

      await initAction({ nonInteractive: true });

      const config = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"),
      );
      expect(config.project.name).toBe("data-dashboard");
      expect(config.project.layout).toBe("src-nested");
      expect(config.project.architecture).toBe("Layered");
      expect(config.project.conventions).toBe("TDD");
    });

    it("migrates a legacy tracked agents block into the personal layer", async () => {
      fs.writeFileSync(
        path.join(tempDir, ".gwrkrc.json"),
        JSON.stringify({
          project: { name: "legacy", architecture: "Layered" },
          agents: {
            define: "claude",
            implement: "claude",
            registry: {
              claude: {
                name: "claude",
                type: "local-cli",
                command: "claude",
                discoveryMethod: "manual",
                quotaProbe: { method: "optimistic", cacheTTLMinutes: 5 },
                maxConcurrent: 1,
                models: [],
              },
            },
            fallbackOrder: ["claude"],
          },
        }),
      );

      await initAction({ nonInteractive: true });

      const tracked = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"),
      );
      const local = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.local.json"), "utf-8"),
      );
      // Agents must move out of the tracked file
      expect(tracked.agents).toBeUndefined();
      // Re-probed agents use auto-selection, not stale config
      expect(local.agents.define).toBeDefined();
      expect(local.agents.fallbackOrder).toBeDefined();
    });
  });

  describe("agent selection", () => {
    it("non-interactive: auto-selects first available agent in preference order", async () => {
      await initAction({ nonInteractive: true });

      const local = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.local.json"), "utf-8"),
      );
      // agy is first in preference order and mocked as available
      const available = ["agy", "claude", "codex"];
      expect(available).toContain(local.agents.define);
      expect(available).toContain(local.agents.implement);
      expect(local.agents.define).toBe(local.agents.implement);
    });

    it("excludes unavailable agents from fallback order and registry", async () => {
      await initAction({ nonInteractive: true });

      const local = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.local.json"), "utf-8"),
      );
      // gemini is mocked as unavailable (isAvailable returns false)
      expect(local.agents.fallbackOrder).not.toContain("gemini");
      expect(local.agents.registry.gemini).toBeUndefined();
    });

    it("re-init replaces stale agents config pointing at unavailable backend", async () => {
      // Seed a stale config that uses gemini (unavailable)
      fs.writeFileSync(
        path.join(tempDir, ".gwrkrc.local.json"),
        JSON.stringify({
          agents: {
            define: "gemini",
            implement: "gemini",
            registry: { gemini: { type: "local-cli" } },
            fallbackOrder: ["gemini"],
          },
        }),
      );
      fs.writeFileSync(
        path.join(tempDir, ".gwrkrc.json"),
        JSON.stringify({ project: { name: "stale" } }),
      );

      await initAction({ nonInteractive: true });

      const local = JSON.parse(
        fs.readFileSync(path.join(tempDir, ".gwrkrc.local.json"), "utf-8"),
      );
      // gemini was the default but is unavailable; re-probe selects an available backend
      expect(local.agents.define).not.toBe("gemini");
      expect(local.agents.implement).not.toBe("gemini");
    });
  });

  describe("workstation setup state (unblocks gwrk ship)", () => {
    it("writes a completed ~/.gwrk/setup.json so ship's preflight passes", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      await initAction({ nonInteractive: true });

      const state = loadSetupState();
      expect(state).not.toBeNull();
      expect(isSetupComplete(state)).toBe(true);
    });
  });

  describe("three-layer setup files", () => {
    it("gitignores the personal .gwrkrc.local.json it writes", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      await initAction({ nonInteractive: true });

      expect(fs.existsSync(path.join(tempDir, ".gwrkrc.local.json"))).toBe(true);
      const gitignore = fs.readFileSync(path.join(tempDir, ".gitignore"), "utf-8");
      expect(gitignore.split("\n").map((l) => l.trim())).toContain(
        ".gwrkrc.local.json",
      );
    });

    it("gitignores gwrk runtime artifacts (.runs/) so ship isn't blocked by its own output", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      await initAction({ nonInteractive: true });

      const lines = fs
        .readFileSync(path.join(tempDir, ".gitignore"), "utf-8")
        .split("\n")
        .map((l) => l.trim());
      expect(lines).toContain(".runs/");
    });

    it("does not duplicate an existing .gitignore entry", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));
      fs.writeFileSync(
        path.join(tempDir, ".gitignore"),
        "node_modules\n.gwrkrc.local.json\n",
      );

      await initAction({ nonInteractive: true });

      const occurrences = fs
        .readFileSync(path.join(tempDir, ".gitignore"), "utf-8")
        .split("\n")
        .filter((l) => l.trim() === ".gwrkrc.local.json").length;
      expect(occurrences).toBe(1);
    });

    it("writes a tracked .gwrkrc.local.json.example template without secrets", async () => {
      fs.writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "test" }));

      await initAction({ nonInteractive: true });

      const examplePath = path.join(tempDir, ".gwrkrc.local.json.example");
      expect(fs.existsSync(examplePath)).toBe(true);
      const example = JSON.parse(fs.readFileSync(examplePath, "utf-8"));
      expect(example.agents).toBeDefined();
      // The example is committed — it must never carry the personal Slack layer.
      expect(example.project?.slack).toBeUndefined();
    });
  });

  describe("FR-046: --agent mode", () => {
    it("should output structured JSON and exit 0", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      
      await initAction({ agent: true });

      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"status": "success"'));
      expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('"profile":'));
      stdoutSpy.mockRestore();
    });

    it("should skip human-dependent steps (TCC, SSH, Slack)", async () => {
      const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
      
      await initAction({ agent: true });

      expect(readline.createInterface).not.toHaveBeenCalled();
      stdoutSpy.mockRestore();
    });
  });

  describe("US-004: Workspace Append (020-polyglot-monorepo)", () => {
    it("should append workspace to existing config if in a subdirectory", async () => {
      // Setup root project
      const rootConfig = { project: { name: "root" } };
      fs.writeFileSync(path.join(tempDir, ".gwrkrc.json"), JSON.stringify(rootConfig, null, 2));

      // Setup workspace subdirectory
      const wsDir = path.join(tempDir, "packages/web");
      fs.mkdirSync(wsDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, "package.json"), JSON.stringify({ name: "web" }));
      
      process.chdir(wsDir);

      await initAction({ workspace: "web" });

      // Verify root config was updated
      const updatedConfig = JSON.parse(fs.readFileSync(path.join(tempDir, ".gwrkrc.json"), "utf-8"));
      expect(updatedConfig.workspaces).toBeDefined();
      expect(updatedConfig.workspaces["packages/web"]).toBeDefined();
      expect(updatedConfig.workspaces["packages/web"].type).toBe("nodejs");
    });
  });
});
