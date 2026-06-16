/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import * as fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadRegistry } from "./agent-registry";

vi.mock("node:fs");

describe("agent-registry", () => {
  const projectRoot = "/test/project";
  const configPath = "/test/project/.gwrkrc.json";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("TR-003: loads a valid registry", () => {
    const validConfig = {
      agents: {
        registry: {
          codex: {
            type: "local-cli",
            command: "codex exec --model {{model}}",
            discoveryMethod: "manual",
            quotaProbe: {
              method: "interactive-scrape",
              command: "codex",
              sendKeys: "/status",
              parseRegex: "(\\d+)% left",
              cacheTTLMinutes: 5,
            },
            maxConcurrent: 1,
            models: [
              { name: "gpt-5.4", tier: "thinking", modelFlag: "gpt-5.4" },
            ],
          },
        },
        fallbackOrder: ["codex"],
      },
    };

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRegistry(projectRoot);
    expect(registry.backends.codex).toBeDefined();
    expect(registry.backends.codex.name).toBe("codex"); // Verified injection
    expect(registry.backends.codex.type).toBe("local-cli");
    expect(registry.backends.codex.models[0].tier).toBe("thinking");
    expect(registry.fallbackOrder).toContain("codex");
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("TR-003: loads a registry with optimistic method and missing discoveryMethod", () => {
    const validConfig = {
      agents: {
        registry: {
          gemini: {
            type: "cloud",
            command: "gemini --model {{model}}",
            quotaProbe: {
              method: "optimistic",
              cacheTTLMinutes: 60,
            },
            maxConcurrent: 2,
            models: [{ name: "gemini-pro", tier: "thinking" }],
          },
        },
        fallbackOrder: ["gemini"],
      },
    };

    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(validConfig));

    const registry = loadRegistry(projectRoot);
    expect(registry.backends.gemini).toBeDefined();
    expect(registry.backends.gemini.name).toBe("gemini");
    expect(registry.backends.gemini.quotaProbe.method).toBe("optimistic");
    expect(registry.backends.gemini.discoveryMethod).toBeUndefined();
    expect(process.exit).not.toHaveBeenCalled();
  });

  it("TR-003: fails fast on missing .gwrkrc.json", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(false);

    loadRegistry(projectRoot);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Missing required config: agents.registry"),
    );
  });

  it("TR-003: fails fast on invalid JSON", () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue("invalid json");

    loadRegistry(projectRoot);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Configuration error: invalid JSON"),
    );
  });

  it("TR-003: fails fast on missing agents.registry or fallbackOrder", () => {
    const invalidConfig = { agents: { registry: {} } }; // Missing fallbackOrder
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(invalidConfig));

    loadRegistry(projectRoot);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Missing required config: agents.registry or agents.fallbackOrder",
      ),
    );
  });

  it("TR-003: fails fast on invalid registry schema", () => {
    const invalidConfig = {
      agents: {
        registry: {
          codex: {
            type: "invalid-type", // Invalid enum value
            command: "codex exec",
            quotaProbe: { method: "invalid-method" },
            maxConcurrent: 0,
            models: [],
          },
        },
        fallbackOrder: ["codex"],
      },
    };
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.spyOn(fs, "readFileSync").mockReturnValue(JSON.stringify(invalidConfig));

    loadRegistry(projectRoot);
    expect(process.exit).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Invalid agent registry entry"),
    );
  });
});
